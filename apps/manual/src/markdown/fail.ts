import { readFileSync } from "node:fs";
import type { Node } from "unist";
import type { VFile } from "vfile";

/**
 * How many lines the file on disk has before the text being rendered. Astro renders a chapter's body with its front
 * matter removed and the blank lines after it trimmed, so a position in the body is that many lines above the same
 * place in the file. `check:book` blanks the front matter line for line instead, and then the offset is 0.
 */
function lineOffset(file: VFile): number {
  if (!file.path) return 0;
  let disk: string;
  try {
    disk = readFileSync(file.path, "utf8");
  } catch {
    return 0;
  }
  const value = String(file.value);
  const text = value.trim();
  const at = disk.lastIndexOf(text);
  if (text === "" || at === -1) return 0;
  const linesBefore = (part: string): number => part.split("\n").length - 1;
  return linesBefore(disk.slice(0, at)) - linesBefore(value.slice(0, value.indexOf(text)));
}

/**
 * Fails the render with a message at a node's line in the chapter file, so the build and `check:book` both name the
 * file and the line to fix.
 */
export function failAt(file: VFile, message: string, node?: Node): never {
  const position = node?.position;
  if (!position) return file.fail(message);
  const offset = lineOffset(file);
  return file.fail(message, {
    start: { ...position.start, line: position.start.line + offset },
    end: { ...position.end, line: position.end.line + offset },
  });
}
