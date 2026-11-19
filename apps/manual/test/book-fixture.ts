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
    figuresDir: join(dir, "figures"),
    sourcesFile: join(dir, "sources.json"),
    glossaryFile: join(dir, "glossary.json"),
    analogiesFile: join(dir, "analogies.json"),
    harnessesFile: join(dir, "harnesses.json"),
    repoRoot: dir,
  };
}

/**
 * The fixture's interactive listings, which `withInteractive` adds to the second chapter after its file listing on
 * line 18: a listing with three notes and a replay (lines 20–24), and two tabs from two harnesses (lines 26–29).
 * They stay out of the committed chapter, so each of T4's failing fixtures still breaks exactly one listing.
 */
export const INTERACTIVE = `
:::listing[Three steps, each with a note]{#noted file="verify/demo-sdk/examples/02-notes.ts" region="steps" replay}
::note[The first step names the reader.]{#name}
::note[The second greets them with [[lst:greet]].]{#greet}
::note[The third prints the greeting.]{#print}
:::

:::tabs
::listing[demo-sdk]{#hello-demo file="verify/demo-sdk/examples/01-hello.ts" region="call"}
::listing[other-sdk]{#hello-other file="verify/other-sdk/examples/01-other.ts" region="call"}
:::
`;

/** Adds the interactive listings to a fixture copy's second chapter. */
export function withInteractive(dir: string): void {
  edit(dir, "chapters/second.md", (text) => text.replace(/^(::listing\[Greeting.*)$/m, `$1\n${INTERACTIVE}`));
}

/**
 * A fixture example that imports the fixture's own package, `demo-sdk`, for the inline-code check. It stays out of the
 * committed harness, because the manual's typecheck covers the fixture's examples and no `node_modules` holds the
 * package there; `withSdk` writes it into a fixture copy.
 */
export const SDK_EXAMPLE = `// A fixture example that imports the fixture's installed package.
import { createAgent } from "demo-sdk";

// #region run
const agent = createAgent({ name: "greeter" });
const result = await agent.run("Greet the reader.");
console.log(result.text);
// #endregion

export const unlisted = "outsideRegion";
`;

/** The line of the second chapter where `withSdk` lists the example above. */
export const SDK_LISTING_LINE = 20;
/** The line where `prose` adds its paragraph, once `withSdk` has listed the example. */
export const PROSE_LINE = 22;

/**
 * Installs the fixture's package, committed under `installed/demo-sdk` because Git ignores every `node_modules`, into
 * the demo harness of a fixture copy, writes `SDK_EXAMPLE` beside the harness's other examples, and lists its region
 * in the second chapter after the file listing on line 18.
 */
export function withSdk(dir: string): void {
  cpSync(join(dir, "installed/demo-sdk"), join(dir, "verify/demo-sdk/node_modules/demo-sdk"), { recursive: true });
  writeFileSync(join(dir, "verify/demo-sdk/examples/03-sdk.ts"), SDK_EXAMPLE);
  edit(dir, "chapters/second.md", (text) =>
    text.replace(
      /^(::listing\[Greeting.*)$/m,
      '$1\n\n::listing[Running an agent]{#run file="verify/demo-sdk/examples/03-sdk.ts" region="run"}',
    ),
  );
}

/** The second chapter's fact-check log, from the fixture's root. */
export const SECOND_LOG = "apps/manual/fact-checks/second.md";

/** A fact-check table in the README's format, with one row for each verdict: 1 is ✅, 2 is ✏️ and 3 is ⚠️. */
export const FACT_CHECK_ROWS = [
  "| # | Claim | Where | Verdict | Source and reason |",
  "| --- | --- | --- | --- | --- |",
  "| 1 | maxTurns caps the run | § Exercises | ✅ | agent.d.ts |",
  "| 2 | internalHelper was misnamed | § Exercises | ✏️ | agent.d.ts |",
  "| 3 | maxTurns defaults to 10 | § Exercises | ⚠️ | none |",
  "",
].join("\n");

/** Appends `FACT_CHECK_ROWS` to the second chapter's fact-check log in a fixture copy. */
export function withRows(dir: string): void {
  edit(dir, SECOND_LOG, (text) => `${text}\n${FACT_CHECK_ROWS}`);
}

/** Adds a paragraph to the second chapter just before its exercises, on `PROSE_LINE` once `withSdk` has run. */
export function prose(dir: string, paragraph: string): void {
  edit(dir, "chapters/second.md", (text) => text.replace("## Exercises", `${paragraph}\n\n## Exercises`));
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
