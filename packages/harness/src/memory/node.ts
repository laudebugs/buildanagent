/**
 * `@buildanagent/harness/memory/node`: the memory folder on disk. It needs Node's file system; the extension itself is
 * in the portable `@buildanagent/harness/memory`.
 */
import { randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { HarnessError } from "../errors.js";
import type { MemoryFiles } from "./files.js";
import { isMemoryName, MEMORY_DIR } from "./paths.js";
import { MEMORY_RECORD_MAX_BYTES } from "./record.js";

// The extension's own files, which no tool path can name because they start with a dot.
const RESERVED = /^\.[a-z-]+\.json$/;
// The bookkeeping files hold one line per tool call that touched a record, so they may grow past one record's size.
const MAX_RESERVED_BYTES = 16 * 1024 * 1024;
const MAX_LIST_DEPTH = 8;

const refuse = (message: string): never => {
  throw new HarnessError("memory_path_refused", message);
};

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** The name's segments, once it is known to be a name the extension may pass. */
function segmentsOf(name: string): string[] {
  if (name === "" || !(isMemoryName(name) || RESERVED.test(name)))
    refuse(`${JSON.stringify(name)} is not a memory name`);
  return name.split("/");
}

/** The status of `path` without following a link, or `undefined` when nothing is there. */
const lstatOf = (path: string) =>
  lstat(path).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));

/** Checks that `path` is a folder and not a link, making it first when it is missing and `make` is set. */
async function folder(path: string, make: boolean): Promise<boolean> {
  let info = await lstatOf(path);
  if (info === undefined) {
    if (!make) return false;
    await mkdir(path).catch((error: unknown) =>
      (error as NodeJS.ErrnoException).code === "EEXIST" ? undefined : Promise.reject(error),
    );
    info = await lstat(path);
  }
  if (info.isSymbolicLink()) refuse(`${path} is a link, and the memory folder follows none`);
  if (!info.isDirectory()) refuse(`${path} is not a folder`);
  return true;
}

/**
 * The path of `dirs` under the memory folder, from the project's real root, with each folder on the way checked to be
 * a folder and not a link. `undefined` when one is missing and `make` is false.
 */
async function walk(root: string, dirs: readonly string[], make: boolean): Promise<string | undefined> {
  let at = await realpath(root).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));
  if (at === undefined) return make ? refuse(`the project root ${root} does not exist`) : undefined;
  for (const part of [...MEMORY_DIR.split("/"), ...dirs]) {
    at = join(at, part);
    if (!(await folder(at, make))) return undefined;
  }
  return at;
}

/** The file's path once its folders are checked, or `undefined` when a folder is missing and `make` is false. */
async function pathOf(root: string, name: string, make: boolean): Promise<string | undefined> {
  const segments = segmentsOf(name);
  const dir = await walk(root, segments.slice(0, -1), make);
  return dir === undefined ? undefined : join(dir, segments.at(-1) as string);
}

/** Whether a file is at `path`, without following a link; a link or anything but a regular file is refused. */
async function isFile(path: string): Promise<boolean> {
  const info = await lstatOf(path);
  if (info === undefined) return false;
  if (info.isSymbolicLink()) refuse(`${path} is a link, and the memory folder follows none`);
  if (!info.isFile()) refuse(`${path} is not a regular file`);
  return true;
}

/** Adds every regular file under `dir` to `found`, by name relative to the memory folder. A link is not followed. */
async function listInto(dir: string, prefix: string, depth: number, found: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  for (const entry of entries) {
    // A link is neither followed nor listed, so a record can't be a link to a file outside the folder.
    if (entry.isFile()) found.push(`${prefix}${entry.name}`);
    else if (entry.isDirectory() && depth < MAX_LIST_DEPTH)
      await listInto(join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1, found);
  }
}

/** The file's text, read without following a link, refused past its size limit. */
async function readNoFollow(path: string, limit: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) refuse(`${path} is not a regular file`);
    if (info.size > limit) refuse(`${path} is longer than ${limit} bytes, so it is not read`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** Writes `text` to a new temp file beside `path`, opened without following links, and renames it over `path`. */
async function writeNoFollow(path: string, text: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path).catch(async (error: unknown) => {
    await rm(temp, { force: true });
    throw error;
  });
}

/**
 * The memory folder on disk under `root`, `.agents/memory/`. Every call walks the path from the project's real root one
 * folder at a time and refuses a link anywhere on the way, the record itself included, so neither a link in the
 * project nor one the model makes with another tool can send a read or a write outside the folder. A folder that is
 * missing is made one level at a time on a write, never through a link. A write goes to a temp file beside the record,
 * opened without following links, and is renamed over it. A record longer than `MEMORY_RECORD_MAX_BYTES` is not read.
 * The walk and the open are two steps, so a link swapped in between them by another process is not caught: the check
 * is against the model's mistakes and against links already in a cloned project, not against a process racing it.
 * Every call with the same `root` returns the same object, so `clearPurgeMarks()` waits for the extension's calls.
 * Throws a `HarnessError` with code `memory_path_refused` for a link, a name that is not a memory name or a file that
 * is too long, and with code `invalid_memory_options` for a `root` that is not absolute.
 */
export function fileMemoryFiles(root: string): MemoryFiles {
  if (typeof root !== "string" || !isAbsolute(root)) {
    throw new HarnessError("invalid_memory_options", "fileMemoryFiles() needs an absolute project root");
  }
  // One object per root, so the extension and a later `clearPurgeMarks()` share the queue that keeps their writes of
  // the purge list apart.
  const held = stores.get(root);
  if (held !== undefined) return held;
  const files = diskFiles(root);
  stores.set(root, files);
  return files;
}

const stores = new Map<string, MemoryFiles>();

function diskFiles(root: string): MemoryFiles {
  return {
    async list() {
      const dir = await walk(root, [], false);
      const found: string[] = [];
      if (dir !== undefined) await listInto(dir, "", 0, found);
      return found;
    },
    async read(name) {
      const path = await pathOf(root, name, false);
      if (path === undefined || !(await isFile(path))) return undefined;
      return readNoFollow(path, RESERVED.test(name) ? MAX_RESERVED_BYTES : MEMORY_RECORD_MAX_BYTES);
    },
    async write(name, text) {
      const path = (await pathOf(root, name, true)) as string;
      await isFile(path);
      await writeNoFollow(path, text);
    },
    async remove(name) {
      const path = await pathOf(root, name, false);
      if (path === undefined || !(await isFile(path))) return;
      await unlink(path).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));
    },
    async rename(from, to) {
      const source = await pathOf(root, from, false);
      if (source === undefined || !(await isFile(source))) refuse(`${from} does not exist`);
      const target = (await pathOf(root, to, true)) as string;
      if (await isFile(target)) refuse(`${to} already exists`);
      await rename(source as string, target);
    },
  };
}
