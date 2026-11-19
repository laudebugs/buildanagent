import { createRequire } from "node:module";
import type ts from "typescript-api";

let loaded: typeof ts | undefined;

/**
 * The compiler the inline-code check reads code with, typescript 6.0.3 as `typescript-api`, loaded on first use. It
 * is a large module, so a process that renders no chapter, such as `book:switch-report`, never loads it. A build
 * loads it once the book has a file listing, even with no inline code, because `renderDependencies` reads each listed
 * file's imports.
 */
export function typescript(): typeof ts {
  loaded ??= createRequire(import.meta.url)("typescript-api") as typeof ts;
  return loaded;
}
