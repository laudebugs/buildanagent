import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { markdownConfigDefaults, parseFrontmatter, unified } from "@astrojs/markdown-remark";
import { type Book, type BookInputs, loadBook } from "../src/book/load.js";
import type { Outline } from "../src/book/outline-types.js";
import { markdownOptionsFor } from "../src/markdown/options.js";

/**
 * The committed fixture book: two written chapters and one planned one, with small registers. The directory is also
 * its own repository root, with a workspace of one harness, `verify/demo-sdk`, whose example a listing shows.
 */
export const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/book/", import.meta.url));

/** The fixture's outline: `first` and `second` are written, `third` is planned. */
export const FIXTURE_OUTLINE: Outline = [
  {
    title: "Part A",
    chapters: [
      { slug: "first", title: "The first chapter", opening: "scenario" },
      { slug: "second", title: "The second chapter", opening: "code" },
    ],
  },
  { title: "Part B", chapters: [{ slug: "third", title: "The third chapter", opening: "question" }] },
];

/** The inputs for a fixture book in `dir`, which is its own repository root for `verifiedIn` paths. */
export function fixtureInputs(dir: string = FIXTURE_DIR, outline: Outline = FIXTURE_OUTLINE): BookInputs {
  return {
    outline,
    outlineFile: join(dir, "outline.ts"),
    chaptersDir: join(dir, "chapters"),
    factChecksDir: join(dir, "apps/manual/fact-checks"),
    sourcesFile: join(dir, "sources.json"),
    glossaryFile: join(dir, "glossary.json"),
    analogiesFile: join(dir, "analogies.json"),
    harnessesFile: join(dir, "harnesses.json"),
    repoRoot: dir,
  };
}

/** Copies the fixture book to a fresh temporary directory, applies `change` and returns the directory. */
export function mutatedFixture(change: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "book-fixture-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  change(dir);
  return dir;
}

/**
 * Resets `dir` to a fresh copy of the fixture book and applies `change`. Cases that run one after another can reuse
 * one directory this way, so the coverage check's programs, keyed by each tsconfig's real path and its extends chain,
 * are listed once for every case that leaves the harness's tsconfig alone.
 */
export function resetFixture(dir: string, change: (dir: string) => void): string {
  rmSync(dir, { recursive: true, force: true });
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  change(dir);
  return dir;
}

/** Removes a directory `mutatedFixture` made. */
export const removeFixture = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** Rewrites one file of a fixture copy. */
export function edit(dir: string, path: string, change: (text: string) => string): void {
  const file = join(dir, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
}

/** Rewrites one JSON file of a fixture copy. */
export function editJson(dir: string, path: string, change: (data: Record<string, unknown>[]) => unknown): void {
  edit(dir, path, (text) => JSON.stringify(change(JSON.parse(text)), null, 2));
}

/**
 * Renders one chapter the way `astro build` does: through `unified()` with the book's options and Astro's default
 * shared options, given the body with its front matter removed and the file's URL.
 */
export async function renderLikeAstro(book: Book, slug: string): Promise<string> {
  const { syntaxHighlight, shikiConfig } = markdownConfigDefaults;
  const renderer = await unified(markdownOptionsFor(book)).createRenderer({ syntaxHighlight, shikiConfig });
  const file = join(book.inputs.chaptersDir, `${slug}.md`);
  const text = readFileSync(file, "utf8");
  // Astro renders the body with its front matter removed and the rest trimmed (its Markdown entry type).
  const { content, frontmatter } = parseFrontmatter(text);
  const { code } = await renderer.render(content.trim(), { frontmatter, fileURL: pathToFileURL(file) });
  return code;
}

/**
 * What the build does with a book: load it, which is what importing the Markdown options does, then render every
 * written chapter. Returns the build's error, with the file and line when it has them, or undefined when the build's
 * content rules pass.
 */
export async function buildError(inputs: BookInputs): Promise<string | undefined> {
  try {
    const book = loadBook(inputs);
    for (const slug of book.index.written.keys()) await renderLikeAstro(book, slug);
    return undefined;
  } catch (error) {
    // A failed render carries the chapter's path and line, as Astro prints them; a failed load names its file in the
    // message.
    const { file, line } = error as { file?: string; line?: number };
    const message = error instanceof Error ? error.message : String(error);
    return file && line ? `${file}:${line}: ${message}` : message;
  }
}
