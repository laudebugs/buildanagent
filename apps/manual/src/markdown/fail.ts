import type { Position } from "unist";
import type { VFile } from "vfile";
import { fileData } from "./chapter-file.js";

/**
 * Fails the render with a message at a node's line in the chapter file, so the build and `check:book` both name the
 * file and the line to fix. The rendered text starts below the front matter, so the line adds the chapter's body
 * offset, which the chapter-contract plugin takes from the book index; nothing here reads the file again.
 */
export function failAt(file: VFile, message: string, node?: { readonly position?: Position | undefined }): never {
  const position = node?.position;
  if (!position) return file.fail(message);
  const offset = fileData(file).lineOffset ?? 0;
  return file.fail(message, {
    start: { ...position.start, line: position.start.line + offset },
    end: { ...position.end, line: position.end.line + offset },
  });
}
