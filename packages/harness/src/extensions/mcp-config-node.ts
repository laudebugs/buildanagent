/**
 * MCP servers a project supplies in its `.mcp.json`. A stdio server runs on the host, outside any sandbox, as the
 * harness's user, so a project's config is code the project chooses to run: it starts nothing unless the project is
 * trusted and each server's config matches its pin in the lock file. Node-only: it reads the project's files.
 *
 * The file is `.mcp.json` at the project root, in the shape Claude Code and Pi read, `{ "mcpServers": { "<name>": {
 * "command", "args", "env" } } }`. Only stdio servers load from it; a remote entry is skipped with a notice.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { canonicalInputHash } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import { checkServerConfig } from "../mcp/connection.js";
import type { McpServerConfig } from "../mcp/types.js";
import { protectedNameReason } from "../sandbox/spawn-env.js";
import { canonicalPath, projectTrusted } from "./load.js";
import { parseObject, readCapped, readMcpConfigPins, writeMcpConfigPin } from "./lock.js";
import { isInside } from "./project-dirs.js";
import type { TrustStore } from "./types.js";

/** The project MCP config's file name, at the project root. */
export const PROJECT_MCP_CONFIG = ".mcp.json";

/** Where the config and its pins are. */
export interface ProjectMcpFiles {
  /** The config file. Default `<root>/.mcp.json`. */
  readonly configFile?: string;
  /** The lock file that holds each server's config pin, under `mcp.<server>.config`. Default `<root>/.agents/extensions.lock.json`. */
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
   * let a project pick which of the host's secrets reach its program. Without it, a server that names a variable does not
   * start.
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
   * The SHA-256 of each file inside the project that the command or an argument names, by its path relative to the
   * root, so a change to a script the command runs asks again. Files the named script loads are not covered.
   */
  readonly files: Readonly<Record<string, string>>;
  /** The pin of this config: `sha256:` and the hash of the canonical JSON of the command, args, env and files. */
  readonly hash: string;
  /**
   * `pinned` when the lock file holds this hash, `new` when it holds none for the server, `changed` when it holds
   * another. In a project that is not trusted every server is `new`, since the project's own lock file approves nothing.
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

const REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
// Control and format characters, such as a newline or a right-to-left override, would let a project make the notice
// that shows its command read as another command.
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
const STDIO_KEYS = new Set(["type", "command", "args", "env"]);
const REMOTE_TYPES = new Set(["http", "sse", "streamable-http"]);
const HASH_CHUNK = 64 * 1024;

const refuse = (file: string, message: string) => new HarnessError("invalid_mcp_config", `${file}: ${message}`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stdio entry before its files are hashed. */
interface Entry {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

function checkText(file: string, server: string, field: string, value: string): void {
  if (HIDDEN.test(value)) throw refuse(file, `the MCP server "${server}" has a control character in its ${field}`);
  // Other clients expand `${NAME}` from their environment; the harness never does, so the text would not mean what the
  // author meant, and expanding it would let the project read any of the host's variables.
  if (value.includes("${")) {
    throw refuse(file, `the MCP server "${server}" uses \${…} in its ${field}, which only an env value may hold`);
  }
}

/** The `env` member: each variable set from a reference the host resolves, and never from a value in the file. */
function envOf(file: string, server: string, env: unknown): Record<string, string> {
  if (env === undefined) return {};
  if (!isObject(env)) throw refuse(file, `the MCP server "${server}" has an env that is not an object`);
  const references: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const reason = protectedNameReason(name);
    if (reason !== undefined)
      throw refuse(file, `the MCP server "${server}" can't set ${JSON.stringify(name)}: ${reason}`);
    const match = typeof value === "string" ? REFERENCE.exec(value) : null;
    // The value is never quoted back: it may be the very secret the file should not hold.
    if (match === null) {
      throw refuse(
        file,
        `the MCP server "${server}" sets ${JSON.stringify(name)} to a value; a project config never holds a value, only the name of one the host supplies, as "\${NAME}"`,
      );
    }
    Object.defineProperty(references, name, { value: match[1], enumerable: true, writable: true, configurable: true });
  }
  return references;
}

/** One `mcpServers` member as a stdio entry, or `undefined` for a remote one, which a project config does not load. */
function entryOf(file: string, name: string, raw: unknown): Entry | undefined {
  // The name is checked first, and not quoted, since every refusal below quotes it.
  if (HIDDEN.test(name) || name.includes("${"))
    throw refuse(file, "an MCP server's name has a control character or ${");
  if (!isObject(raw)) throw refuse(file, `the MCP server "${name}" is not an object`);
  if (raw.url !== undefined || (typeof raw.type === "string" && REMOTE_TYPES.has(raw.type))) return undefined;
  const unknown = Object.keys(raw).find((key) => !STDIO_KEYS.has(key));
  if (unknown !== undefined)
    throw refuse(file, `the MCP server "${name}" has a member ${JSON.stringify(unknown)} this harness does not read`);
  if (raw.type !== undefined && raw.type !== "stdio") {
    throw refuse(file, `the MCP server "${name}" has a type that is not stdio, http or sse`);
  }
  const args = raw.args ?? [];
  if (typeof raw.command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw refuse(file, `the MCP server "${name}" needs a command and a list of string args`);
  }
  checkText(file, name, "command", raw.command);
  for (const arg of args) checkText(file, name, "args", arg);
  const env = envOf(file, name, raw.env);
  // The checks `createMcpManager()` makes, on the config with empty values, before any value is asked for.
  checkServerConfig(stdioConfig({ name, command: raw.command, args, env }, "/", () => ""));
  return { name, command: raw.command, args, env };
}

/** The stdio entries of a config file's text, in file order, and a notice for each remote entry skipped. */
function parseConfig(file: string, text: string): { entries: Entry[]; notices: string[] } {
  const servers = parseObject(text, file).mcpServers;
  if (!isObject(servers)) throw refuse(file, `it has no "mcpServers" object`);
  const entries: Entry[] = [];
  const notices: string[] = [];
  const names = new Set<string>();
  for (const [name, raw] of Object.entries(servers)) {
    if (names.has(name.toLowerCase()))
      throw refuse(file, `two MCP servers are named ${JSON.stringify(name)}, in some letter case`);
    names.add(name.toLowerCase());
    const entry = entryOf(file, name, raw);
    if (entry === undefined) {
      notices.push(
        `the MCP server ${JSON.stringify(name)} in ${file} is skipped: a project config loads stdio servers only`,
      );
    } else entries.push(entry);
  }
  return { entries, notices };
}

/** The SHA-256 of a regular file, read through one handle, or `undefined` when the path is not a regular file. */
async function fileHash(path: string): Promise<string | undefined> {
  let handle: import("node:fs/promises").FileHandle;
  try {
    // Non-blocking, so a pipe named as an argument is never waited on.
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return undefined;
  }
  try {
    if (!(await handle.stat()).isFile()) return undefined;
    const hash = createHash("sha256");
    const buffer = new Uint8Array(HASH_CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
}

/**
 * The files inside the project that the command line names, each by its path relative to the root and its hash. The
 * command counts only when it is a path, since a bare name is looked up on `PATH`, not in the project.
 */
async function namedFiles(root: string, entry: Entry): Promise<Record<string, string>> {
  const candidates = [
    ...(entry.command.includes("/") || entry.command.includes(sep) ? [entry.command] : []),
    ...entry.args,
  ];
  const files: Record<string, string> = {};
  for (const candidate of candidates) {
    if (candidate === "") continue;
    const path = resolve(root, candidate);
    if (path === root || !isInside(root, path)) continue;
    const hash = await fileHash(path);
    if (hash === undefined) continue;
    const key = relative(root, path).split(sep).join("/");
    Object.defineProperty(files, key, { value: hash, enumerable: true, writable: true, configurable: true });
  }
  return files;
}

async function declaredOf(root: string, entry: Entry, pins: ReadonlyMap<string, string>): Promise<ProjectMcpServer> {
  const files = await namedFiles(root, entry);
  const { name, command, args, env } = entry;
  const hash = `sha256:${await canonicalInputHash({ command, args, env, files })}`;
  const pin = pins.get(name);
  const state = pin === undefined ? "new" : pin === hash ? "pinned" : "changed";
  return { name, command, args, cwd: root, env, files, hash, state };
}

/** The stdio config a declared server starts with, its variables set to what `value` gives for each reference. */
function stdioConfig(entry: Entry, cwd: string, value: (reference: string) => string): McpServerConfig {
  const setEnv: Record<string, string> = {};
  for (const [name, reference] of Object.entries(entry.env)) setEnv[name] = value(reference);
  return { name: entry.name, transport: { kind: "stdio", command: entry.command, args: entry.args, cwd, setEnv } };
}

/** One line naming a server and what it would run, exactly, for a notice. */
export function describeProjectMcpServer(server: ProjectMcpServer): string {
  const vars = Object.entries(server.env).map(([name, reference]) => `${name} from the host's ${reference}`);
  const env = vars.length === 0 ? "" : `, with ${vars.join(", ")}`;
  return `the MCP server ${JSON.stringify(server.name)} runs ${JSON.stringify([server.command, ...server.args])} in ${JSON.stringify(server.cwd)}${env}`;
}

const places = (base: string, options: ProjectMcpFiles) => ({
  file: options.configFile ?? join(base, PROJECT_MCP_CONFIG),
  lock: options.lockFile ?? join(base, ".agents", "extensions.lock.json"),
});

/** Every stdio server the config at `file` declares, with its hash; none when there is no file. */
async function readDeclared(
  base: string,
  file: string,
  pins: ReadonlyMap<string, string>,
): Promise<{ declared: ProjectMcpServer[]; notices: string[] } | undefined> {
  const text = await readCapped(file, "invalid_mcp_config");
  if (text === undefined) return undefined;
  const { entries, notices } = parseConfig(file, text);
  const declared: ProjectMcpServer[] = [];
  for (const entry of entries) declared.push(await declaredOf(base, entry, pins));
  return { declared, notices };
}

/** The config a pinned server starts with, or why it does not: a variable the host does not supply. */
async function startable(
  server: ProjectMcpServer,
  secrets: ProjectMcpOptions["secrets"],
): Promise<McpServerConfig | string> {
  const values = new Map<string, string>();
  for (const reference of new Set(Object.values(server.env))) {
    const value = secrets === undefined ? undefined : await secrets(reference, server.name);
    if (value === undefined) return `the host supplies no value for ${reference}`;
    values.set(reference, value);
  }
  const config = stdioConfig(server, server.cwd, (reference) => values.get(reference) as string);
  checkServerConfig(config);
  return config;
}

/**
 * Reads a project's `.mcp.json` and returns the servers that may start, every server it declares and why any did not
 * start. Nothing in the file runs here: the manager starts the returned configs.
 *
 * A server starts only when the run is not headless (or `loadInHeadless` is set), the trust store trusts the project,
 * and the server's config hashes to its pin in the lock file. Every other declared server is returned in `declared`,
 * with its exact command and args and a notice, so the host can show what would run and ask; `pinProjectMcpServer()`
 * records the person's yes. A headless run without `loadInHeadless` reads nothing and starts nothing.
 *
 * A config never holds a variable's value. Each `env` member names the host value it is set from, as `"${NAME}"`, and
 * `secrets` resolves it; a member with any other value is refused with `invalid_mcp_config`, and so is one that sets a
 * variable `spawnEnv()` sets itself or one that changes what a program loads, such as `NODE_OPTIONS`. A config can't
 * name parent variables to copy, so a project server gets `spawnEnv()`'s cleared environment and the values the host
 * supplied, nothing more. A file that is a link, not JSON, over 1 MiB, or holds an entry the checks refuse, is refused
 * whole with `invalid_mcp_config`, and nothing of it starts.
 *
 * The pin covers the command, args, variable names and the files inside the project the command line names, such as
 * `server.mjs` in `node server.mjs`. It does not cover what that script imports, a package a command such as `npx`
 * fetches, or a file changed between this check and the start. The lock file sits in the project, so anyone who can
 * commit to the project can pin their own change: the pin asks again on a change nobody meant, and trust is the
 * decision about who holds the project.
 */
export async function loadProjectMcpServers(root: string, options: ProjectMcpOptions): Promise<ProjectMcpServers> {
  const base = await canonicalPath(root);
  const { file, lock } = places(base, options);
  const result: ProjectMcpServers = { servers: [], declared: [], notices: [] };
  if (options.headless && options.loadInHeadless !== true) {
    // Only whether the file exists is looked at: nobody can answer, so there is nothing to show.
    if (await exists(file)) result.notices.push(`the MCP servers in ${file} are skipped: this run is headless`);
    return result;
  }
  const trusted = await projectTrusted(options.trust, root);
  const read = await readDeclared(base, file, trusted ? await readMcpConfigPins(lock) : new Map());
  if (read === undefined) return result;
  result.declared.push(...read.declared);
  result.notices.push(...read.notices);
  for (const server of read.declared) {
    const outcome = trusted ? await outcomeOf(server, options.secrets) : "the project is not trusted";
    if (typeof outcome === "string") {
      result.notices.push(`${describeProjectMcpServer(server)}; it is not started: ${outcome}`);
    } else result.servers.push(outcome);
  }
  return result;
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** In a trusted project: the config a server starts with, or why it does not start. */
async function outcomeOf(
  server: ProjectMcpServer,
  secrets: ProjectMcpOptions["secrets"],
): Promise<McpServerConfig | string> {
  if (server.state === "new") return "its config is not pinned, so it waits for approval";
  if (server.state === "changed") return "its config changed since it was pinned, so it waits for approval";
  return startable(server, secrets);
}

/**
 * Pins one server of a project's `.mcp.json` in the lock file, by the hash `loadProjectMcpServers()` showed, so it
 * starts from the next load in a trusted project. A person's approval runs it. Throws `invalid_mcp_config` when the
 * config declares no such server, or when its config now hashes differently, so a pin never covers a command the person
 * did not see. It starts nothing.
 */
export async function pinProjectMcpServer(
  root: string,
  server: string,
  hash: string,
  options: ProjectMcpFiles = {},
): Promise<void> {
  const base = await canonicalPath(root);
  const { file, lock } = places(base, options);
  const read = await readDeclared(base, file, new Map());
  const found = read?.declared.find((declared) => declared.name === server);
  if (found === undefined) throw refuse(file, `it declares no stdio MCP server named ${JSON.stringify(server)}`);
  if (found.hash !== hash) {
    throw refuse(
      file,
      `the MCP server ${JSON.stringify(server)} changed since its config was shown, so it was not pinned`,
    );
  }
  await writeMcpConfigPin(lock, server, hash);
}
