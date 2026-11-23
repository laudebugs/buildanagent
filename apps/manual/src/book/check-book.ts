import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { markdownConfigDefaults, parseFrontmatter, unified } from "@astrojs/markdown-remark";
import { markdownOptionsFor } from "../markdown/options.js";
import { renderedBody } from "./book-index.js";
import { type Book, type BookInputs, loadBook } from "./load.js";
import { isPaperUrl, mentionLine, paperUses } from "./papers.js";
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
  return (await checkBookReport(inputs)).problems;
}

/** What `check:book` finds: the problems that fail it, and the notes it prints for reviewers whether or not it fails. */
export interface BookReport {
  readonly problems: readonly Problem[];
  readonly notes: readonly string[];
}

/** `checkBook`, plus the notes `check:book` prints: the papers still pending and every `[[paper:id described]]`. */
export async function checkBookReport(inputs?: BookInputs): Promise<BookReport> {
  let book: Book;
  try {
    book = loadBook(inputs);
  } catch (error) {
    if (error instanceof BookError) return { problems: error.problems, notes: [] };
    throw error;
  }
  return { problems: await renderProblems(book), notes: paperNotes(book) };
}

/**
 * The paper notes a reviewer reads: how many papers still wait for a short name and blurb, which of them link no
 * paper page yet, and each `[[paper:id described]]`, whose sentence must describe the paper because no blurb is shown.
 */
export function paperNotes(book: Book): string[] {
  const pending = [...book.papers.pending].sort();
  const notes = [`${pending.length} paper(s) pending a short name and blurb in ${book.names.papersPending}`];
  const badUrls = pending.filter((id) => {
    const url = book.sources.get(id)?.url;
    return url !== undefined && !isPaperUrl(url);
  });
  if (badUrls.length > 0) notes.push(`pending papers whose url is not a paper's own page yet: ${badUrls.join(", ")}`);
  const described: { file: string; line: number; id: string }[] = [];
  for (const [id, uses] of paperUses(book.index.written.values(), book.papers, book.sources)) {
    for (const { chapter, mentions } of uses) {
      for (const mention of mentions) {
        if (mention.kind !== "described") continue;
        const file = relative(book.inputs.repoRoot, book.index.written.get(chapter.slug)?.file ?? chapter.slug);
        described.push({ file, line: mentionLine(mention) ?? 0, id });
      }
    }
  }
  notes.push(`${described.length} paper mention(s) marked described, whose sentence must describe the paper:`);
  // By file, then by line as a number, so line 9 comes before line 120.
  described.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  notes.push(...described.map(({ file, line, id }) => `  ${file}:${line}: [[paper:${id} described]]`));
  return notes;
}

async function renderProblems(book: Book): Promise<Problem[]> {
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
