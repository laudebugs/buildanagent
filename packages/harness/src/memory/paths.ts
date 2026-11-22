/**
 * The memory tool's path check. A path must already be canonical: relative to the project root, or absolute under it,
 * with no `.` or `..` segment, no percent sign, no backslash and no control character, inside `.agents/memory/`. Each
 * name in it is plain ASCII that does not start with a dot, so no path can name a file the extension keeps for itself,
 * reach a hidden file, or look like another path. A check on the text alone can't see a link, so the file store checks
 * real paths as well.
 */

/** The memory folder, relative to the project root. */
export const MEMORY_DIR = ".agents/memory";

/** How many folders deep a record may sit under the memory folder. */
const MAX_DEPTH = 4;
const MAX_PATH = 512;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

/** A path the tool may use: the memory folder itself (`name` is `""`), or a name under it. */
export type MemoryPath = { readonly name: string } | { readonly refused: string };

/**
 * Whether `name`, relative to the memory folder, is one the tool may name: plain segments, at most `MAX_DEPTH` folders
 * deep. The empty name is the folder itself.
 */
export function isMemoryName(name: string): boolean {
  if (name === "") return true;
  const segments = name.split("/");
  return segments.length <= MAX_DEPTH + 1 && segments.every((segment) => SEGMENT.test(segment));
}

/** The name under the memory folder that `path` gives, or why the tool refuses it. `root` is the project root. */
export function memoryPath(root: string, path: unknown): MemoryPath {
  if (typeof path !== "string" || path === "") return { refused: "Pass the path as a non-empty string." };
  const shown = JSON.stringify(path.slice(0, 200));
  if (path.length > MAX_PATH) return { refused: `The path ${shown}... is longer than ${MAX_PATH} characters.` };
  if (/[\p{Cc}\p{Cf}\\%]/u.test(path)) {
    return {
      refused: `The path ${shown} holds a control character, a backslash or a percent sign, so it is refused unread.`,
    };
  }
  const base = root.endsWith("/") ? root : `${root}/`;
  const relative = path.startsWith("/") ? (path.startsWith(base) ? path.slice(base.length) : undefined) : path;
  const trimmed = relative?.endsWith("/") ? relative.slice(0, -1) : relative;
  if (trimmed === undefined || (trimmed !== MEMORY_DIR && !trimmed.startsWith(`${MEMORY_DIR}/`))) {
    return { refused: `The path ${shown} is outside ${MEMORY_DIR}/, the only folder the memory tool reaches.` };
  }
  const name = trimmed.slice(MEMORY_DIR.length + 1);
  if (!isMemoryName(name)) {
    return {
      refused: `The path ${shown} is not a plain path under ${MEMORY_DIR}/: each name is letters, digits, "_", "-" and ".", does not start with "." and is at most ${MAX_DEPTH} folders deep.`,
    };
  }
  return { name };
}

/** The path the model sees for a name under the memory folder. */
export const shownPath = (name: string): string => (name === "" ? `${MEMORY_DIR}/` : `${MEMORY_DIR}/${name}`);
