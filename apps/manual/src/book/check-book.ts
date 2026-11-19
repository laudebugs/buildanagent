import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { markdownConfigDefaults, parseFrontmatter, unified } from "@astrojs/markdown-remark";
import { markdownOptionsFor } from "../markdown/options.js";
import { renderedBody } from "./book-index.js";
import { type BookInputs, loadBook } from "./load.js";
import { BookError, type Problem } from "./problems.js";

interface VFileMessageLike {
  readonly reason?: string;
  readonly line?: number;
  readonly file?: string;
}

/** Turns a failed render into a problem with the chapter's file and, when known, its line. */
function renderProblem(error: unknown, file: string): Problem {
  const message = error as VFileMessageLike;
  const reason = message.reason ?? (error instanceof Error ? error.message : String(error));
  return message.line ? { file, line: message.line, message: reason } : { file, message: reason };
}

/**
 * Runs every rule the build applies, without building: it loads the book, which checks the outline, the three
 * registers and every chapter's numbered blocks, then renders each written chapter through the same remark and rehype
 * plugins the build uses. It returns every problem found; an empty list means the build's content rules pass.
 */
export async function checkBook(inputs?: BookInputs): Promise<readonly Problem[]> {
  let book: ReturnType<typeof loadBook>;
  try {
    book = loadBook(inputs);
  } catch (error) {
    if (error instanceof BookError) return error.problems;
    throw error;
  }
  const { syntaxHighlight, shikiConfig } = markdownConfigDefaults;
  const renderer = await unified(markdownOptionsFor(book)).createRenderer({ syntaxHighlight, shikiConfig });
  const problems: Problem[] = [];
  for (const { file } of book.index.written.values()) {
    if (!existsSync(file)) continue;
    // The same text Astro renders: the body without its front matter, trimmed. The plugins add the body's line offset
    // from the book index, so a problem's line is the file's own line.
    const text = readFileSync(file, "utf8");
    const { frontmatter } = parseFrontmatter(text);
    try {
      await renderer.render(renderedBody(text).body, { frontmatter, fileURL: pathToFileURL(file) });
    } catch (error) {
      problems.push(renderProblem(error, relative(book.inputs.repoRoot, file)));
    }
  }
  return problems;
}
