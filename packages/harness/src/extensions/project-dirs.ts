/** Where a project's own files are looked for: the folders from the working directory up to the repository root. Node-only. */
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Whether `path` exists, without following a link. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The folders from `cwd` up to the repository root, nearest first. The root is the first folder that holds a `.git`
 * file or folder. A `cwd` inside no repository gives only itself, so a stray file in a parent such as `/tmp` or a home
 * folder is never read as the project's.
 */
export async function projectDirs(cwd: string): Promise<string[]> {
  const start = resolve(cwd);
  const dirs: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (await exists(join(dir, ".git"))) return dirs;
    if (dirname(dir) === dir) return [start];
  }
}

/** Whether `path` is `root` or inside it, once both are real paths. */
export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** The most continuation bytes one UTF-8 character has: a cut moves back at most this far. */
const MAX_CONTINUATION = 3;

/** `cut` moved back to the start of the UTF-8 character it falls inside, so a cut never splits a character. */
function characterStart(bytes: Uint8Array, cut: number): number {
  let start = cut;
  // A continuation byte is 10xxxxxx: the character it belongs to started before it.
  while (start > 0 && cut - start < MAX_CONTINUATION && ((bytes[start] as number) & 0xc0) === 0x80) start--;
  return ((bytes[start] as number) & 0xc0) === 0x80 ? cut : start;
}

/** At most `limit` bytes from the start of the open file. */
async function readStart(handle: import("node:fs/promises").FileHandle, limit: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let length = 0;
  while (length < limit) {
    const { bytesRead } = await handle.read(buffer, length, limit - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buffer.subarray(0, length);
}

/**
 * The text of a project file and its real path, or why it was not read. A file whose real path leaves `root` is
 * refused: a link in a cloned repository must not pull a file such as `~/.ssh/id_rsa` into a prompt. A missing file, a
 * folder or anything else that is not a regular file is not an error and gives `undefined`. At most `maxBytes` and one
 * more are read, however long the file is: a longer file is cut at the start of the character that crosses `maxBytes`,
 * so `text` never ends in half a character, and `bytes` holds exactly the bytes `text` was decoded from.
 */
export async function readProjectFile(
  root: string,
  path: string,
  maxBytes: number,
): Promise<{ text: string; bytes: Uint8Array; real: string; truncated: boolean } | { notice: string } | undefined> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return undefined;
  }
  if (!isInside(await realpath(root), real)) {
    return { notice: `${path} is skipped: it is a link to ${real}, outside ${root}` };
  }
  try {
    // Opening a pipe would wait for a writer, so only a regular file is opened.
    if (!(await stat(real)).isFile()) return undefined;
    const handle = await open(real, "r");
    try {
      const start = await readStart(handle, maxBytes + 1);
      const truncated = start.length > maxBytes;
      const bytes = truncated ? start.subarray(0, characterStart(start, maxBytes)) : start;
      return { text: new TextDecoder().decode(bytes), bytes, real, truncated };
    } finally {
      await handle.close();
    }
  } catch {
    // A file that cannot be read is not a project file.
    return undefined;
  }
}
