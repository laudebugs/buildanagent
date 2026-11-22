/** Where a project's own files are looked for: the folders from the working directory up to the repository root. Node-only. */
import { lstat, readFile, realpath } from "node:fs/promises";
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

/**
 * The text of a project file and its real path, or why it was not read. A file whose real path leaves `root` is
 * refused: a link in a cloned repository must not pull a file such as `~/.ssh/id_rsa` into a prompt. A missing file is
 * not an error. Only the first `maxBytes` are read.
 */
export async function readProjectFile(
  root: string,
  path: string,
  maxBytes: number,
): Promise<{ text: string; real: string; truncated: boolean } | { notice: string } | undefined> {
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
    const bytes = await readFile(real);
    const truncated = bytes.length > maxBytes;
    return { text: new TextDecoder().decode(truncated ? bytes.subarray(0, maxBytes) : bytes), real, truncated };
  } catch {
    // A folder, or a file that cannot be read, is not a project file.
    return undefined;
  }
}
