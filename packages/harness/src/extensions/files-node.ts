/**
 * Reading and hashing a project's files without following a link out of them or waiting on a pipe. Each function
 * throws a `FileRefusal` that says what was wrong, and its caller turns that into its own error, so the extension
 * loader and the MCP config loader each keep their own code and wording. Node-only.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, opendir } from "node:fs/promises";
import { join } from "node:path";

/** Why a file was refused: it is a link, not a regular file, or over the bytes or files allowed. */
export type RefusalKind = "link" | "not_file" | "too_big";

/** A file refused by the reader or a hash. The caller words the error; `path` is the file it is about. */
export class FileRefusal extends Error {
  readonly kind: RefusalKind;
  readonly path: string;

  constructor(kind: RefusalKind, path: string) {
    super(`${path}: ${kind}`);
    this.kind = kind;
    this.path = path;
  }
}

/**
 * `value` as a JSON string with everything outside printable ASCII escaped, so a name or path a project chose can't
 * change how a notice or an error reads, whatever it holds.
 */
export function quote(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Sets `key` as an own member of `target`. Defined, not assigned, so a key such as `__proto__` from a parsed file is a
 * plain member and never the prototype.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Opens a regular file through one handle: the open refuses a link in the last part of the path and does not wait on a
 * pipe, and the handle must be a regular file. `undefined` when there is no such file.
 */
async function openRegular(path: string): Promise<FileHandle | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return undefined;
    if (code === "ELOOP") throw new FileRefusal("link", path);
    throw error;
  }
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new FileRefusal("not_file", path);
  }
  return handle;
}

/**
 * Reads at most `maxBytes` of a file and refuses a longer one, or gives `undefined` when there is none. The file is
 * checked and read through one handle, so one swapped in between the two is never read, and no more than the cap and
 * one byte is ever read.
 */
export async function readCapped(file: string, maxBytes: number): Promise<string | undefined> {
  const handle = await openRegular(file);
  if (handle === undefined) return undefined;
  try {
    if ((await handle.stat()).size > maxBytes) throw new FileRefusal("too_big", file);
    const buffer = new Uint8Array(maxBytes + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > maxBytes) throw new FileRefusal("too_big", file);
    }
    return new TextDecoder().decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

/**
 * What a hash may still read: files and folders, and bytes, in all, and the most bytes one file may hold. Each
 * hashed file takes its share, and running out refuses the file as `too_big`.
 */
export interface HashBudget {
  files: number;
  bytes: number;
  readonly fileBytes: number;
}

const CHUNK = 64 * 1024;

/** Takes one file or folder from `budget`, and refuses `path` once none is left. */
function charge(budget: HashBudget | undefined, path: string): void {
  if (budget === undefined) return;
  budget.files -= 1;
  if (budget.files < 0) throw new FileRefusal("too_big", path);
}

/** The hex SHA-256 of a regular file read through one handle, charged to `budget` when one is given. */
export async function hashFile(path: string, budget?: HashBudget): Promise<string | undefined> {
  const handle = await openRegular(path);
  if (handle === undefined) return undefined;
  try {
    charge(budget, path);
    return await digestOf(handle, path, budget);
  } finally {
    await handle.close();
  }
}

/** The hex SHA-256 of an open file, its bytes charged to `budget`. */
async function digestOf(handle: FileHandle, path: string, budget: HashBudget | undefined): Promise<string> {
  const hash = createHash("sha256");
  const buffer = new Uint8Array(CHUNK);
  let read = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    read += bytesRead;
    if (budget !== undefined) {
      budget.bytes -= bytesRead;
      if (budget.bytes < 0 || read > budget.fileBytes) throw new FileRefusal("too_big", path);
    }
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

/**
 * Every file under `dir`, as paths relative to it with `/` separators, in sorted order. A link refuses the folder.
 * Each entry, a folder or a file, is charged to `budget` as it is read, so a tree too large to pin stops the walk
 * there, before it is listed whole.
 */
async function filesUnder(dir: string, budget: HashBudget | undefined, prefix = ""): Promise<string[]> {
  const entries: import("node:fs").Dirent[] = [];
  for await (const entry of await opendir(join(dir, prefix))) {
    charge(budget, join(dir, prefix, entry.name));
    entries.push(entry);
  }
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(dir, budget, relative)));
    else if (entry.isFile()) found.push(relative);
    // A link or a device file is not hashed but would still be followed by whatever runs the folder.
    else throw new FileRefusal(entry.isSymbolicLink() ? "link" : "not_file", join(dir, relative));
  }
  return found;
}

/**
 * The hash of a folder: `sha256:` and the digest over each file's path and content digest, in sorted order, so a
 * changed, added, removed or renamed file changes it. A link or special file anywhere in it refuses the folder.
 */
export async function hashTree(dir: string, budget?: HashBudget): Promise<string> {
  const total = createHash("sha256");
  for (const file of await filesUnder(dir, budget)) {
    // Each file was charged as it was listed, so only its bytes are charged now. A file swapped for a link between
    // the listing and the open is refused by the open itself.
    const handle = await openRegular(join(dir, file));
    if (handle === undefined) throw new FileRefusal("not_file", join(dir, file));
    try {
      total.update(`${file}\0${await digestOf(handle, join(dir, file), budget)}\n`);
    } finally {
      await handle.close();
    }
  }
  return `sha256:${total.digest("hex")}`;
}
