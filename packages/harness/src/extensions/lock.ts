/**
 * Content-hash pins for project extensions and MCP tools. An extension is a folder; its hash covers every file in it, in
 * sorted order, each by its path and its own SHA-256, so a changed, added, removed or renamed file changes the hash.
 * The lock file, `extensions.lock.json`, holds one hash per extension folder under `extensions`, and under `mcp` the
 * approved definition hash of each tool of each MCP server:
 *
 * ```json
 * { "version": 1, "extensions": { "audit": "sha256:…" }, "mcp": { "docs": { "tools": { "search": "sha256:…" } } } }
 * ```
 *
 * Each writer keeps the other's member. A file with no `extensions` member pins no extension, so writing MCP pins
 * alone leaves a project's extensions unpinned rather than refused. Node-only: it reads and writes files.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "../errors.js";

const LOCK_VERSION = 1;

/** Every file under `dir`, as paths relative to it with `/` separators, in sorted order. */
async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(dir, relative)));
    else if (entry.isFile()) found.push(relative);
    // A link or a device file is not hashed but would still be followed by an import, so it cannot be pinned.
    else
      throw new HarnessError(
        "invalid_extension",
        `${join(dir, relative)} is a link or a special file, which an extension may not contain`,
      );
  }
  return found;
}

/** The hash of an extension folder: `sha256:` and the digest over each file's path and content digest, in sorted order. */
export async function hashExtensionDir(dir: string): Promise<string> {
  const total = createHash("sha256");
  for (const file of await filesUnder(dir)) {
    const content = createHash("sha256")
      .update(await readFile(join(dir, file)))
      .digest("hex");
    total.update(`${file}\0${content}\n`);
  }
  return `sha256:${total.digest("hex")}`;
}

/** Parses JSON that must be an object, or throws `invalid_extension` naming the file. */
export function parseObject(text: string, file: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HarnessError("invalid_extension", `${file} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError("invalid_extension", `${file} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

type LockBody = { version?: unknown; extensions?: unknown; mcp?: unknown };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The lock file's parsed body, checked for its version and the shape of both members, or `undefined` without one. */
async function readBody(file: string): Promise<LockBody | undefined> {
  let text: string;
  try {
    // A pipe or a device would hang or never end, so only a regular file is read.
    if (!(await stat(file)).isFile()) throw new HarnessError("invalid_extension", `${file} is not a regular file`);
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = parseObject(text, file) as LockBody;
  const badMember = (value: unknown) => value !== undefined && !isObject(value);
  if (parsed.version !== LOCK_VERSION || badMember(parsed.extensions) || badMember(parsed.mcp)) {
    throw new HarnessError("invalid_extension", `the lock file ${file} is not an extensions.lock.json of version 1`);
  }
  return parsed;
}

/**
 * The pins in a lock file, by extension folder name, or `undefined` when there is no lock file or it pins no
 * extension, because it holds MCP pins alone.
 */
export async function readLock(file: string): Promise<ReadonlyMap<string, string> | undefined> {
  const body = await readBody(file);
  if (body?.extensions === undefined) return undefined;
  const pins = new Map<string, string>();
  for (const [name, hash] of Object.entries(body.extensions as Record<string, unknown>)) {
    if (typeof hash !== "string")
      throw new HarnessError("invalid_extension", `the lock file pins "${name}" to no hash`);
    pins.set(name, hash);
  }
  return pins;
}

const sorted = (entries: Iterable<readonly [string, unknown]>) =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Writes the lock file for these extension pins, keeping its MCP pins, and replaces the old file in one step. */
export async function writeLock(file: string, pins: ReadonlyMap<string, string>): Promise<void> {
  const before = await readBody(file);
  await writeBody(file, {
    version: LOCK_VERSION,
    extensions: sorted(pins),
    ...(before?.mcp === undefined ? {} : { mcp: before.mcp }),
  });
}

/** The MCP pins of one server in a lock file, by tool name, or `undefined` when it holds none for the server. */
export async function readMcpPins(file: string, server: string): Promise<Readonly<Record<string, string>> | undefined> {
  const body = await readBody(file);
  const servers = (body?.mcp ?? {}) as Record<string, unknown>;
  if (!Object.hasOwn(servers, server)) return undefined;
  const entry = servers[server];
  if (!isObject(entry) || !isObject(entry.tools)) {
    throw new HarnessError("invalid_extension", `the lock file ${file} holds no tool pins for "${server}"`);
  }
  const pins: Record<string, string> = {};
  for (const [name, hash] of Object.entries(entry.tools)) {
    if (typeof hash !== "string") throw new HarnessError("invalid_extension", `the lock file pins a tool to no hash`);
    Object.defineProperty(pins, name, { value: hash, enumerable: true, writable: true, configurable: true });
  }
  return pins;
}

/** Replaces the MCP pins of one server in a lock file, keeping every other member. */
export async function writeMcpPins(
  file: string,
  server: string,
  pins: Readonly<Record<string, string>>,
): Promise<void> {
  const before = await readBody(file);
  const servers = { ...((before?.mcp ?? {}) as Record<string, unknown>) };
  Object.defineProperty(servers, server, {
    value: { tools: sorted(Object.entries(pins)) },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  await writeBody(file, {
    version: LOCK_VERSION,
    ...(before?.extensions === undefined ? {} : { extensions: before.extensions }),
    mcp: sorted(Object.entries(servers)),
  });
}

/** Writes a lock file's body, replacing the old one in one step. */
async function writeBody(file: string, body: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${globalThis.crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
