/**
 * Content-hash pins for project extensions and MCP tools. An extension is a folder; its hash covers every file in it, in
 * sorted order, each by its path and its own SHA-256, so a changed, added, removed or renamed file changes the hash.
 * The lock file, `extensions.lock.json`, holds one hash per extension folder under `extensions`, and under `mcp` the
 * approved definition hash of each tool of each MCP server and, for a server a project's `.mcp.json` declares, the
 * hash of its config:
 *
 * ```json
 * { "version": 1, "extensions": { "audit": "sha256:…" }, "mcp": { "docs": { "config": "sha256:…", "tools": { "search": "sha256:…" } } } }
 * ```
 *
 * Each writer keeps the other's member, and every write to one path in this process runs after the one before it. A
 * file with no `extensions` member pins no extension, so writing MCP pins alone leaves a project's extensions unpinned
 * rather than refused. `writeLock()` replaces a file it can't read; `writeMcpPins()` refuses one. Node-only: it reads
 * and writes files.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors.js";

const LOCK_VERSION = 1;
const MAX_LOCK_BYTES = 1024 * 1024;

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

/**
 * A capped file's text, such as the lock file's, or `undefined` when there is none; a refusal carries `code`. It is checked and read through one handle, so a file
 * swapped in between the two is never read: the open refuses a link and does not wait on a pipe, the handle must be a
 * regular file within the cap, and no more than the cap and one byte is ever read.
 */
export async function readCapped(
  file: string,
  code: "invalid_extension" | "invalid_mcp_config" = "invalid_extension",
): Promise<string | undefined> {
  let handle: import("node:fs/promises").FileHandle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const why = (error as { code?: string }).code;
    if (why === "ENOENT") return undefined;
    if (why === "ELOOP") throw new HarnessError(code, `${file} is a link, which this file may not be`);
    throw error;
  }
  try {
    const found = await handle.stat();
    // A pipe or a device would hang or never end, so only a regular file is read.
    if (!found.isFile()) throw new HarnessError(code, `${file} is not a regular file`);
    const tooBig = () => new HarnessError(code, `${file} is over ${MAX_LOCK_BYTES} bytes, which no such file needs`);
    if (found.size > MAX_LOCK_BYTES) throw tooBig();
    const buffer = new Uint8Array(MAX_LOCK_BYTES + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > MAX_LOCK_BYTES) throw tooBig();
    }
    return new TextDecoder().decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

/** The lock file's parsed body, checked for its version and the shape of both members, or `undefined` without one. */
async function readBody(file: string): Promise<LockBody | undefined> {
  const text = await readCapped(file);
  if (text === undefined) return undefined;
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

// The writes waiting on each lock file, by its resolved path, so every writer in this process, `writeLock()` and every
// `fileMcpPinStore()` alike, reads and replaces the file one after another and none loses another's change.
const queues = new Map<string, Promise<unknown>>();

/** Runs `work` after every earlier write to the same file in this process has settled. */
function serially<T>(file: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(file);
  const run = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = run.catch(() => {});
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}

/** The lock file's body, or `undefined` when there is none or it can't be read as a lock file. */
async function readBodyOrNone(file: string): Promise<LockBody | undefined> {
  try {
    return await readBody(file);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "invalid_extension") return undefined;
    throw error;
  }
}

/**
 * Writes the lock file for these extension pins, keeping its MCP pins, and replaces the old file in one step. A lock
 * file that can't be read as one, such as one left with merge-conflict markers, is replaced whole, so a person can
 * repin a broken file; its MCP pins go with it, and their tools wait for approval again.
 */
export function writeLock(file: string, pins: ReadonlyMap<string, string>): Promise<void> {
  return serially(file, async () => {
    const before = await readBodyOrNone(file);
    await writeBody(file, {
      version: LOCK_VERSION,
      extensions: sorted(pins),
      ...(before?.mcp === undefined ? {} : { mcp: before.mcp }),
    });
  });
}

/** The MCP pins of one server in a lock file, by tool name, or `undefined` when it holds none for the server. */
export async function readMcpPins(file: string, server: string): Promise<Readonly<Record<string, string>> | undefined> {
  const body = await readBody(file);
  const servers = (body?.mcp ?? {}) as Record<string, unknown>;
  if (!Object.hasOwn(servers, server)) return undefined;
  const entry = servers[server];
  // A project server's config pin may stand alone, before any of its tools is approved.
  if (isObject(entry) && entry.tools === undefined) return undefined;
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

/**
 * Replaces the MCP pins of one server in a lock file, keeping every other member. It throws `invalid_extension` for a
 * lock file it can't read, rather than replace it: a file without its extension pins would let unpinned extensions load.
 */
export function writeMcpPins(file: string, server: string, pins: Readonly<Record<string, string>>): Promise<void> {
  return serially(file, async () => {
    const before = await readBody(file);
    await writeServerMember(file, before, server, "tools", sorted(Object.entries(pins)));
  });
}

/**
 * The config pins in a lock file, by server name: the hash of each project MCP server's config as a person approved it,
 * under `mcp.<server>.config`. A server with no config pin is left out.
 */
export async function readMcpConfigPins(file: string): Promise<ReadonlyMap<string, string>> {
  const body = await readBody(file);
  const pins = new Map<string, string>();
  for (const [server, entry] of Object.entries((body?.mcp ?? {}) as Record<string, unknown>)) {
    if (!isObject(entry) || entry.config === undefined) continue;
    if (typeof entry.config !== "string") {
      throw new HarnessError("invalid_extension", `the lock file pins the config of "${server}" to no hash`);
    }
    pins.set(server, entry.config);
  }
  return pins;
}

/**
 * Sets one server's config pin in a lock file, keeping its tool pins and every other member. Like `writeMcpPins()`, it
 * refuses a lock file it can't read rather than replace it.
 */
export function writeMcpConfigPin(file: string, server: string, hash: string): Promise<void> {
  return serially(file, async () => writeServerMember(file, await readBody(file), server, "config", hash));
}

/** Writes the lock file with one member of one server's `mcp` entry replaced, keeping the rest of the file. */
async function writeServerMember(
  file: string,
  before: LockBody | undefined,
  server: string,
  member: "tools" | "config",
  value: unknown,
): Promise<void> {
  const servers = { ...((before?.mcp ?? {}) as Record<string, unknown>) };
  const old = Object.hasOwn(servers, server) && isObject(servers[server]) ? servers[server] : {};
  // Defined, not assigned, so a server named `__proto__` is an own member and not the prototype.
  Object.defineProperty(servers, server, {
    value: sorted(Object.entries({ ...old, [member]: value })),
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
