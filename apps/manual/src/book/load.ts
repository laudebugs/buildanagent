import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { outline as bookOutline } from "../outline.js";
import { type Analogy, checkAnalogies } from "./analogies.js";
import { type BookIndex, indexChapters } from "./book-index.js";
import { checkGlossary, type GlossaryEntry } from "./glossary.js";
import { checkOutline, type NumberedChapter, numberChapters } from "./outline-rules.js";
import type { Outline } from "./outline-types.js";
import { ProblemList } from "./problems.js";
import { checkSources, type Source } from "./sources.js";

/** Where a book's content lives. The real book's come from `bookInputs()`; the tests pass fixture books. */
export interface BookInputs {
  readonly outline: Outline;
  /** The directory that holds `<slug>.md` for each written chapter. */
  readonly chaptersDir: string;
  readonly sourcesFile: string;
  readonly glossaryFile: string;
  readonly analogiesFile: string;
  /** The directory that every `verifiedIn` path is relative to: the repository root. */
  readonly repoRoot: string;
}

/** The checked book: its numbered outline, its three registers and its index of written chapters. */
export interface Book {
  readonly inputs: BookInputs;
  readonly chapters: readonly NumberedChapter[];
  readonly bySlug: ReadonlyMap<string, NumberedChapter>;
  readonly sources: ReadonlyMap<string, Source>;
  readonly glossary: ReadonlyMap<string, GlossaryEntry>;
  readonly analogies: ReadonlyMap<string, Analogy>;
  readonly index: BookIndex;
}

/**
 * The app's directory, found by walking up to its `package.json`. A fixed relative path would break once Astro bundles
 * this module into `dist/.prerender/chunks/` for the pages, which still sit inside the app's directory.
 */
function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@buildanagent/manual") return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("cannot find the @buildanagent/manual package above the book's code");
    dir = parent;
  }
}

/** The real book's inputs: `src/outline.ts`, the chapters and the three registers. */
export function bookInputs(): BookInputs {
  const app = appRoot();
  return {
    outline: bookOutline,
    chaptersDir: join(app, "src/content/chapters"),
    sourcesFile: join(app, "src/data/sources.json"),
    glossaryFile: join(app, "src/data/glossary.json"),
    analogiesFile: join(app, "src/content/analogies.json"),
    repoRoot: join(app, "../.."),
  };
}

function readJson(file: string, problems: ProblemList): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.add(file, `cannot read this file as JSON: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Loads and checks the whole book before any chapter renders: the outline's rules, the source register and its
 * `verifiedIn` files, the glossary, the analogy register, and the numbered blocks of every chapter. The Markdown
 * pipeline calls it when it loads, so the build and `check:book` fail on the same problems. Throws a `BookError`
 * that lists them all.
 */
export function loadBook(inputs: BookInputs = bookInputs()): Book {
  const problems = new ProblemList();
  const name = (file: string) => relative(inputs.repoRoot, file) || file;
  checkOutline(inputs.outline, "src/outline.ts", problems);
  const chapters = numberChapters(inputs.outline);
  const bySlug = new Map(chapters.map((chapter) => [chapter.slug, chapter]));
  const sources = checkSources(
    readJson(inputs.sourcesFile, problems),
    name(inputs.sourcesFile),
    inputs.repoRoot,
    problems,
  );
  const sourceIds = new Set(sources.map((source) => source.id));
  const glossary = checkGlossary(
    readJson(inputs.glossaryFile, problems),
    name(inputs.glossaryFile),
    sourceIds,
    problems,
  );
  const analogies = checkAnalogies(
    readJson(inputs.analogiesFile, problems),
    name(inputs.analogiesFile),
    new Set(bySlug.keys()),
    problems,
  );
  const index = indexChapters(chapters, inputs.chaptersDir, problems, name);
  checkIllustrations(analogies, index, name(inputs.analogiesFile), problems);
  problems.throwIfAny();
  return {
    inputs,
    chapters,
    bySlug,
    sources: new Map(sources.map((source) => [source.id, source])),
    glossary: new Map(glossary.map((entry) => [entry.id, entry])),
    analogies: new Map(analogies.map((entry) => [entry.id, entry])),
    index,
  };
}

/** An analogy's illustration must be a figure in its chapter, once that chapter is written. */
function checkIllustrations(
  analogies: readonly Analogy[],
  index: BookIndex,
  file: string,
  problems: ProblemList,
): void {
  for (const entry of analogies) {
    const written = index.written.get(entry.chapter);
    if (entry.illustration === null || written === undefined) continue;
    if (!written.blocks.some((block) => block.kind === "figure" && block.id === entry.illustration)) {
      problems.add(file, `${entry.id}: illustration "${entry.illustration}" is not a figure in ${entry.chapter}.md`);
    }
  }
}

/**
 * What every chapter's rendered HTML depends on beyond its own file: which chapters exist, their numbers and the
 * numbered blocks in each. Astro caches a chapter until the chapter itself changes, so `astro.config.mjs` clears the
 * cache when this text changes, as when a figure is added to one chapter and another chapter refers to it.
 */
export function renderDependencies(book: Book): string {
  return JSON.stringify(
    book.chapters.map((chapter) => ({
      slug: chapter.slug,
      number: chapter.number,
      blocks: book.index.written.get(chapter.slug)?.blocks.map((block) => [block.kind, block.id, block.number]) ?? null,
    })),
  );
}
