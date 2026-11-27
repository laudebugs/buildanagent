/**
 * MCP servers a project supplies in its `.mcp.json`. A stdio server runs on the host, outside any sandbox, as the
 * harness's user, so a project's config is code the project chooses to run: it starts nothing unless the project is
 * trusted and each server's config matches its pin in the lock file. Node-only: it reads the project's files.
 *
 * The file is `.mcp.json` at the project root, in the shape Claude Code and Pi read, `{ "mcpServers": { "<name>": {
 * "command", "args", "env" } } }`. Only stdio servers load from it; a remote entry is skipped with a notice.
 */
import { realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalInputHash } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import { checkServerConfig } from "../mcp/connection.js";
import { isRecord as isObject } from "../mcp/content.js";
import type { McpServerConfig } from "../mcp/types.js";
import { protectedNameReason } from "../sandbox/spawn-env.js";
import { FileRefusal, type HashBudget, hashFile, hashTree, quote, readCapped, setOwn } from "./files-node.js";
import { canonicalPath, exists, projectTrusted } from "./load.js";
import { defaultLockFile, jsonObject, readMcpConfigPins, writeMcpConfigPin } from "./lock.js";
import { isInside } from "./project-dirs.js";
import type { TrustStore } from "./types.js";

/** The project MCP config's file name, at the project root. */
export const PROJECT_MCP_CONFIG = ".mcp.json";

/** Where the config and its pins are. */
export interface ProjectMcpFiles {
  /** The config file. Default `<root>/.mcp.json`. */
  readonly configFile?: string;
  /**
   * The lock file that holds each server's config pin, under `mcp.<server>.config`. Default
   * `<root>/.agents/extensions.lock.json`, which is refused when `.agents` is a link out of the project.
   */
  readonly lockFile?: string;
}

/** What `loadProjectMcpServers()` needs to decide. */
export interface ProjectMcpOptions extends ProjectMcpFiles {
  readonly trust: TrustStore;
  /** True for a run nobody can answer: no project server starts unless `loadInHeadless` is set. */
  readonly headless: boolean;
  /** Lets a headless run start the pinned servers of a project the trust store already trusts. Default false. */
  readonly loadInHeadless?: boolean;
  /**
   * Supplies the value of a variable a server's `env` names as `"${NAME}"`, given `NAME` and the server's name, or
   * `undefined` when the host has none for it, and then that server does not start. It is asked only for a server that
   * is about to start: the project is trusted and the server's config matches its pin. The host decides which names it
   * answers, such as only those the person configured for this project; reading `process.env[name]` for any name would
   * let a project pick which of the host's secrets reach its program. Without it, a server that names a variable does
   * not start.
   */
  readonly secrets?: (reference: string, server: string) => string | undefined | Promise<string | undefined>;
}

/** A stdio server the project's config declares, as it would run: show this to the person before they trust it. */
export interface ProjectMcpServer {
  readonly name: string;
  /** The program, exactly as the config gives it. It runs without a shell, found on `PATH` unless it is a path. */
  readonly command: string;
  /** Its arguments, exactly as the config gives them. */
  readonly args: readonly string[];
  /** The folder it starts in: the project root. */
  readonly cwd: string;
  /** Each variable the server gets, by the name of the host's value it is set from, never the value itself. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * The hash of each file or folder inside the project that the command line names, by its real path relative to the
   * root, so two spellings of one file are one entry: a file as `sha256:` and its SHA-256, a folder as the hash of
   * every file in it. A path counts when it is the command (if it is a path), an argument, or the value of an
   * `--option=value` argument, and its real path is inside the project, however it is spelled. What the named code
   * loads by other means is not covered.
   */
  readonly files: Readonly<Record<string, string>>;
  /** The pin of this config: `sha256:` and the hash of the canonical JSON of the command, args, env and files. */
  readonly hash: string;
  /**
   * `pinned` when the project's lock file holds this hash, `new` when it holds none for the server, `changed` when it
   * holds another. The state is the same whether or not the project is trusted: a `pinned` server of a project that is
   * not trusted needs no further question once the project is trusted, because the project's own lock file pins it, and
   * its notice says so. It then starts as any pinned server does: in a run that is not headless or sets
   * `loadInHeadless`, and when `secrets` supplies every variable it names.
   */
  readonly state: "pinned" | "new" | "changed";
}

/** What a project's MCP config gave: the servers to start, every server it declares, and why any did not start. */
export interface ProjectMcpServers {
  /** The configs to pass to `createMcpManager()`: trusted, pinned and with every variable supplied. */
  readonly servers: McpServerConfig[];
  /** Every stdio server the config declares, with its exact command and args, whether or not it starts. */
  readonly declared: ProjectMcpServer[];
  /** One line for each server that does not start, or for the whole file when it is skipped, for the host to show. */
  readonly notices: string[];
}

const MAX_CONFIG_BYTES = 1024 * 1024;
const REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
// Text that would let a project make the notice showing its command read as another command: control and format
// characters (a newline, a right-to-left override), line and paragraph separators, combining marks, and every space
// but the ASCII one.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Mn}\p{Me}]|[^\P{Zs} ]/u;
// The most a notice shows of one server: longer text is refused, not cut, so the notice is always the whole command.
const MAX_FIELD = 1024;
const MAX_ARGS = 64;
const MAX_ENV = 32;
// What hashing the paths of one load may read. Past it the config is refused: name the script, not a large folder.
const HASH_LIMITS = { files: 4096, bytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024 } as const;
const STDIO_KEYS = new Set(["type", "command", "args", "env"]);
const REMOTE_TYPES = new Set(["http", "sse", "streamable-http"]);
// `--import=./preload.mjs` names a file as much as `./preload.mjs` does.
const OPTION_VALUE = /^--?[A-Za-z0-9][A-Za-z0-9._-]*=(.+)$/s;

const refuse = (file: string, message: string, cause?: unknown) =>
  new HarnessError("invalid_mcp_config", `${quote(file)}: ${message}`, cause === undefined ? undefined : { cause });

/** A stdio entry before its paths are hashed. */
interface Entry {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

function checkText(file: string, server: string, field: string, value: string): void {
  const where = `the MCP server ${quote(server)}`;
  if (value.length > MAX_FIELD) throw refuse(file, `${where} has a ${field} over ${MAX_FIELD} characters`);
  if (HIDDEN.test(value)) throw refuse(file, `${where} has a hidden or look-alike character in its ${field}`);
  // Other clients expand `${NAME}` from their environment; the harness never does, so the text would not mean what the
  // author meant, and expanding it would let the project read any of the host's variables.
  if (value.includes("${")) throw refuse(file, `${where} uses \${…} in its ${field}, which only an env value may hold`);
}

/** The `env` member: each variable set from a reference the host resolves, and never from a value in the file. */
function envOf(file: string, server: string, env: unknown): Record<string, string> {
  const where = `the MCP server ${quote(server)}`;
  if (env === undefined) return {};
  if (!isObject(env)) throw refuse(file, `${where} has an env that is not an object`);
  if (Object.keys(env).length > MAX_ENV) throw refuse(file, `${where} sets more than ${MAX_ENV} variables`);
  const references: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const reason = protectedNameReason(name);
    if (reason !== undefined) throw refuse(file, `${where} can't set ${quote(name)}: ${reason}`);
    const match = typeof value === "string" ? REFERENCE.exec(value) : null;
    // The value is never quoted back: it may be the very secret the file should not hold.
    if (match === null) {
      throw refuse(
        file,
        `${where} sets ${quote(name)} to a value; a project config never holds a value, only the name of one the host supplies, as "\${NAME}"`,
      );
    }
    setOwn(references, name, match[1]);
  }
  return references;
}

/** `checkServerConfig()`'s refusal, under the file's name like every other refusal of the file. */
function checked(file: string, config: McpServerConfig): void {
  try {
    checkServerConfig(config);
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error;
    throw new HarnessError("invalid_mcp_config", `${quote(file)}: ${error.message}`, { cause: error });
  }
}

/** One `mcpServers` member as a stdio entry, or `undefined` for a remote one, which a project config does not load. */
function entryOf(file: string, name: string, raw: unknown): Entry | undefined {
  checkText(file, name, "name", name);
  const where = `the MCP server ${quote(name)}`;
  if (!isObject(raw)) throw refuse(file, `${where} is not an object`);
  if (raw.url !== undefined || (typeof raw.type === "string" && REMOTE_TYPES.has(raw.type))) return undefined;
  const unknown = Object.keys(raw).find((key) => !STDIO_KEYS.has(key));
  if (unknown !== undefined) throw refuse(file, `${where} has a member ${quote(unknown)} this harness does not read`);
  if (raw.type !== undefined && raw.type !== "stdio") throw refuse(file, `${where} has a type that is not stdio`);
  const args = raw.args ?? [];
  if (typeof raw.command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw refuse(file, `${where} needs a command and a list of string args`);
  }
  if (args.length > MAX_ARGS) throw refuse(file, `${where} has more than ${MAX_ARGS} args`);
  checkText(file, name, "command", raw.command);
  for (const arg of args) checkText(file, name, "args", arg);
  const env = envOf(file, name, raw.env);
  // The checks `createMcpManager()` makes, now, so a bad config is refused before anything is hashed or asked for.
  // No value exists yet, so each variable is checked by its name with an empty value, and the folder is a stand-in:
  // the real root is set when the server is about to start, and the check reads neither.
  checked(
    file,
    stdioConfig({ name, command: raw.command, args, env }, "/", () => ""),
  );
  return { name, command: raw.command, args, env };
}

/** The stdio entries of a config file's text, in file order, and a notice for each remote entry skipped. */
function parseConfig(file: string, text: string): { entries: Entry[]; notices: string[] } {
  const parsed = jsonObject(text);
  if (typeof parsed === "string") throw refuse(file, `it ${parsed}`);
  const servers = parsed.mcpServers;
  if (!isObject(servers)) throw refuse(file, `it has no "mcpServers" object`);
  const entries: Entry[] = [];
  const notices: string[] = [];
  const names = new Set<string>();
  for (const [name, raw] of Object.entries(servers)) {
    const entry = entryOf(file, name, raw);
    if (names.has(name.toLowerCase()))
      throw refuse(file, `two MCP servers are named ${quote(name)}, in some letter case`);
    names.add(name.toLowerCase());
    if (entry === undefined) {
      notices.push(
        `the MCP server ${quote(name)} in ${quote(file)} is skipped: a project config loads stdio servers only`,
      );
    } else entries.push(entry);
  }
  return { entries, notices };
}

/** The paths a command line names: the command when it is a path, each argument, and each `--option=value` value. */
function candidatesOf(entry: Entry): string[] {
  const found = entry.command.includes("/") || entry.command.includes(sep) ? [entry.command] : [];
  for (const arg of entry.args) {
    found.push(arg);
    const value = OPTION_VALUE.exec(arg)?.[1];
    if (value !== undefined) found.push(value);
  }
  return found;
}

/** The real path of `path`, or `undefined` when nothing is there. */
const realOrNone = (path: string): Promise<string | undefined> => realpath(path).catch(() => undefined);

/**
 * Where a path the command line wrote leads: its real path inside the project, `undefined` when it names nothing in
 * the project, or a refusal when it is written inside the project and leads out of it. A path is written inside when,
 * as written, it is under the root as the caller gave it or under the root's real path, so `lib/x.mjs` counts whichever
 * part of it is a link; it is also written inside when the real path of its folder is in the project, so a link out
 * reached through another spelling of the project is refused too. Such a path must have its real path in the project.
 * A path whose real path is in the project is pinned however it is spelled, such as `/var/…` for `/private/var/…` on
 * macOS. Anything else, such as `/usr/bin/node`, or a path where nothing is, names nothing in the project and is
 * skipped. Nothing out of the project is read.
 */
async function projectPath(file: string, roots: Roots, path: string): Promise<string | undefined> {
  const root = roots.base;
  const real = await realOrNone(path);
  if (real === root) return undefined;
  if (real !== undefined && isInside(root, real)) return real;
  if (real === undefined) return undefined;
  const written = isInside(roots.given, path) || isInside(root, path);
  const folder = written ? undefined : await realOrNone(dirname(path));
  if (written || (folder !== undefined && isInside(root, folder))) {
    const shown = written
      ? relative(isInside(root, path) ? root : roots.given, path)
      : relative(folder as string, path);
    throw refuse(file, `it names ${quote(shown)}, which leads through a link to a path outside the project`);
  }
  return undefined;
}

/** The project's root: its real path, which every check compares with, and the spelling the caller gave. */
interface Roots {
  readonly base: string;
  readonly given: string;
}

/** The hash of the file or folder at `real`, a real path inside the project, or `undefined` for anything else. */
async function pathHash(real: string, budget: HashBudget): Promise<string | undefined> {
  const found = await stat(real);
  if (found.isDirectory()) return hashTree(real, budget);
  if (!found.isFile()) return undefined;
  const hash = await hashFile(real, budget);
  return hash === undefined ? undefined : `sha256:${hash}`;
}

const PATH_REFUSALS = {
  link: "is a link, or holds one, which a pinned path may not",
  not_file: "holds a special file, which a pinned path may not",
  too_big: `is over what a pin covers: ${HASH_LIMITS.files} files, ${HASH_LIMITS.bytes} bytes in all or ${HASH_LIMITS.fileBytes} bytes in one file; name the script itself`,
} as const;

/**
 * The files and folders inside the project that the command line names, each once, by its real path relative to the
 * root, with its hash. Keying by the real path means `s.mjs`, `./s.mjs` and, on a file system that ignores case,
 * `S.MJS` are one entry, read once.
 */
async function namedPaths(file: string, roots: Roots, entry: Entry, budget: HashBudget) {
  const root = roots.base;
  const paths: Record<string, string> = {};
  for (const candidate of candidatesOf(entry)) {
    if (candidate === "") continue;
    const real = await projectPath(file, roots, resolve(root, candidate));
    if (real === undefined) continue;
    const key = relative(root, real).split(sep).join("/");
    if (Object.hasOwn(paths, key)) continue;
    try {
      const hash = await pathHash(real, budget);
      if (hash !== undefined) setOwn(paths, key, hash);
    } catch (error) {
      if (!(error instanceof FileRefusal)) throw error;
      throw refuse(
        file,
        `the MCP server ${quote(entry.name)} names ${quote(key)}, which ${PATH_REFUSALS[error.kind]}`,
        error,
      );
    }
  }
  return paths;
}

async function declaredOf(
  file: string,
  roots: Roots,
  entry: Entry,
  pins: ReadonlyMap<string, string>,
  budget: HashBudget,
): Promise<ProjectMcpServer> {
  const files = await namedPaths(file, roots, entry, budget);
  const { name, command, args, env } = entry;
  const hash = `sha256:${await canonicalInputHash({ command, args, env, files })}`;
  const pin = pins.get(name);
  const state = pin === undefined ? "new" : pin === hash ? "pinned" : "changed";
  return { name, command, args, cwd: roots.base, env, files, hash, state };
}

/** The stdio config a declared server starts with, its variables set to what `value` gives for each reference. */
function stdioConfig(entry: Entry, cwd: string, value: (reference: string) => string): McpServerConfig {
  const setEnv: Record<string, string> = {};
  for (const [name, reference] of Object.entries(entry.env)) setEnv[name] = value(reference);
  return { name: entry.name, transport: { kind: "stdio", command: entry.command, args: entry.args, cwd, setEnv } };
}

/**
 * One line naming a server and what it would run, exactly, for a notice. Every string in it is quoted with everything
 * outside printable ASCII escaped, so the line reads the same whatever the project wrote.
 */
export function describeProjectMcpServer(server: ProjectMcpServer): string {
  const list = (values: readonly string[]) => `[${values.map(quote).join(",")}]`;
  const vars = Object.entries(server.env).map(
    ([name, reference]) => `${quote(name)} from the host's ${quote(reference)}`,
  );
  const env = vars.length === 0 ? "" : `, with ${vars.join(", ")}`;
  return `the MCP server ${quote(server.name)} runs ${list([server.command, ...server.args])} in ${quote(server.cwd)}${env}`;
}

/** The project's config file: `configFile`, or `.mcp.json` at the root. */
const configPath = (base: string, options: ProjectMcpFiles): string =>
  options.configFile ?? join(base, PROJECT_MCP_CONFIG);

/**
 * The config and lock file of the project at `base`. A default lock file whose folder is a link out of the project,
 * or a link that leads nowhere, is refused.
 */
async function places(base: string, options: ProjectMcpFiles) {
  const file = configPath(base, options);
  const lock = options.lockFile ?? defaultLockFile(base);
  if (options.lockFile === undefined) {
    // The open refuses a link only in the last part of the path, so a linked `.agents` would read and write elsewhere.
    const folder = dirname(lock);
    const real = await realOrNone(folder);
    if (real !== undefined && !isInside(base, real)) {
      throw refuse(lock, "its folder is a link to a path outside the project, so it pins nothing");
    }
    // Nothing resolves, but something is there: a link that leads nowhere, which a write would follow.
    if (real === undefined && (await exists(folder))) {
      throw refuse(lock, "its folder is a link that leads nowhere, so it pins nothing");
    }
  }
  return { file, lock };
}

/** A lock file's refusal, as `invalid_mcp_config` like every other refusal here. */
async function asConfigError<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof HarnessError) || error.code !== "invalid_extension") throw error;
    throw new HarnessError("invalid_mcp_config", error.message, { cause: error });
  }
}

const CONFIG_REFUSALS = {
  link: "it is a link, which a project MCP config may not be",
  not_file: "it is not a regular file",
  too_big: `it is over ${MAX_CONFIG_BYTES} bytes, which no project MCP config needs`,
} as const;

/** Every stdio server the config at `file` declares, with its hash; none when there is no file. */
async function readDeclared(
  roots: Roots,
  file: string,
  pins: ReadonlyMap<string, string>,
): Promise<{ declared: ProjectMcpServer[]; notices: string[] } | undefined> {
  let text: string | undefined;
  try {
    text = await readCapped(file, MAX_CONFIG_BYTES);
  } catch (error) {
    if (!(error instanceof FileRefusal)) throw error;
    throw refuse(file, CONFIG_REFUSALS[error.kind], error);
  }
  if (text === undefined) return undefined;
  const { entries, notices } = parseConfig(file, text);
  const budget: HashBudget = { ...HASH_LIMITS };
  const declared: ProjectMcpServer[] = [];
  for (const entry of entries) declared.push(await declaredOf(file, roots, entry, pins, budget));
  return { declared, notices };
}

/** The config a pinned server starts with, or why it does not: a variable the host does not supply. */
async function startable(
  file: string,
  server: ProjectMcpServer,
  secrets: ProjectMcpOptions["secrets"],
): Promise<McpServerConfig | string> {
  const values = new Map<string, string>();
  for (const reference of new Set(Object.values(server.env))) {
    const value = secrets === undefined ? undefined : await secrets(reference, server.name);
    if (value === undefined) return `the host supplies no value for ${quote(reference)}`;
    values.set(reference, value);
  }
  const config = stdioConfig(server, server.cwd, (reference) => values.get(reference) as string);
  checked(file, config);
  return config;
}

/** The config a server starts with, or why it does not start. */
async function outcomeOf(
  file: string,
  server: ProjectMcpServer,
  trusted: boolean,
  secrets: ProjectMcpOptions["secrets"],
): Promise<McpServerConfig | string> {
  if (!trusted) {
    return server.state === "pinned"
      ? "the project is not trusted; its own lock file pins this config, so once the project is trusted it starts without a further question in a run that is not headless (or sets loadInHeadless), when the host supplies every variable it names"
      : "the project is not trusted";
  }
  if (server.state === "new") return "its config is not pinned, so it waits for approval";
  if (server.state === "changed") return "its config changed since it was pinned, so it waits for approval";
  return startable(file, server, secrets);
}

/**
 * Reads a project's `.mcp.json` and returns the servers that may start, every server it declares and why any did not
 * start. Nothing in the file runs here: the manager starts the returned configs.
 *
 * A server starts only when the run is not headless (or `loadInHeadless` is set), the trust store trusts the project,
 * and the server's config hashes to its pin in the lock file. Every other declared server is returned in `declared`,
 * with its exact command and args and a notice, so the host can show what would run and ask; `pinProjectMcpServer()`
 * records the person's yes. A headless run without `loadInHeadless` only checks that the file exists. In a project
 * that is not trusted the config and the lock file are read, and the files the command line names are hashed, all
 * inside the project, so the notice can show the state; nothing outside it is read.
 *
 * A config never holds a variable's value. Each `env` member names the host value it is set from, as `"${NAME}"`, and
 * `secrets` resolves it; a member with any other value is refused, and so is one that sets a variable `spawnEnv()` sets
 * itself or one that changes what a program loads or how it is configured, such as `NODE_OPTIONS` or a `DYLD_` name. A
 * config can't name parent variables to copy, so a project server gets `spawnEnv()`'s cleared environment and the
 * values the host supplied, nothing more. A name, command or argument over 1,024 characters, with a control, format,
 * combining or non-ASCII space character, or holding `${`, is refused, and the notice escapes everything outside
 * printable ASCII. Every refusal, of the config file, an entry, a named path or the lock file, is a `HarnessError` with
 * code `invalid_mcp_config` whose message starts with the file's name, and nothing of the file starts.
 *
 * The pin covers the command, args, variable names, and the files and folders inside the project that
 * the command line names, as `server.mjs` in `node server.mjs`, `./p.mjs` in `--import=./p.mjs`, or
 * `./server` as a whole folder. A path is resolved to its real path first, so any spelling of a project
 * file counts. A path inside the project whose real path leaves it, or a folder holding a link, refuses
 * the config. One load hashes at most 4,096 files and folders and 64 MiB. The pin does
 * not cover a module named by name (`pkg` in `python -m pkg`), what the named code imports from
 * elsewhere, a package that `npx` fetches, the project root itself (`node .`) or a file changed between
 * this check and the start. The lock file sits in the project, so a change that brings its own pin, as a
 * pull can, starts without asking: the pin asks again only for a change nobody pinned.
 */
export async function loadProjectMcpServers(root: string, options: ProjectMcpOptions): Promise<ProjectMcpServers> {
  const base = await canonicalPath(root);
  const result: ProjectMcpServers = { servers: [], declared: [], notices: [] };
  if (options.headless && options.loadInHeadless !== true) {
    const file = configPath(base, options);
    // Only whether the file exists is looked at: nobody can answer, so there is nothing to show.
    if (await exists(file)) result.notices.push(`the MCP servers in ${quote(file)} are skipped: this run is headless`);
    return result;
  }
  const { file, lock } = await places(base, options);
  const trusted = await projectTrusted(options.trust, root);
  const read = await readDeclared({ base, given: resolve(root) }, file, await asConfigError(readMcpConfigPins(lock)));
  if (read === undefined) return result;
  result.declared.push(...read.declared);
  result.notices.push(...read.notices);
  for (const server of read.declared) {
    const outcome = await outcomeOf(file, server, trusted, options.secrets);
    if (typeof outcome === "string") {
      result.notices.push(`${describeProjectMcpServer(server)}; it is not started: ${outcome}`);
    } else result.servers.push(outcome);
  }
  return result;
}

/**
 * Pins one server of a project's `.mcp.json` in the lock file, by the hash `loadProjectMcpServers()` showed, so it
 * starts from the next load in a trusted project. It throws `invalid_mcp_config` when the config declares no such
 * server, when the config now hashes differently from `hash` (so a pin never covers a command the person did not
 * see), or for any refusal the loader makes. It starts nothing.
 */
export async function pinProjectMcpServer(
  root: string,
  server: string,
  hash: string,
  options: ProjectMcpFiles = {},
): Promise<void> {
  const base = await canonicalPath(root);
  const { file, lock } = await places(base, options);
  const read = await readDeclared({ base, given: resolve(root) }, file, new Map());
  const found = read?.declared.find((declared) => declared.name === server);
  if (found === undefined) throw refuse(file, `it declares no stdio MCP server named ${quote(server)}`);
  if (found.hash !== hash) {
    throw refuse(file, `the MCP server ${quote(server)} changed since its config was shown, so it was not pinned`);
  }
  await asConfigError(writeMcpConfigPin(lock, server, hash));
}
