import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
  /** The file the outline comes from, for messages. */
  readonly outlineFile: string;
  /** The directory that holds `<slug>.md` for each written chapter. */
  readonly chaptersDir: string;
  /** The directory that holds each written chapter's fact-check log, `<slug>.md` (BK21). */
  readonly factChecksDir: string;
  readonly sourcesFile: string;
  readonly glossaryFile: string;
  readonly analogiesFile: string;
  /** The directory that every `verifiedIn` path is relative to: the repository root. */
  readonly repoRoot: string;
}

/** The input files as messages name them: relative to the repository root. */
export interface BookFileNames {
  readonly outline: string;
  readonly sources: string;
  readonly glossary: string;
  readonly analogies: string;
}

/** The checked book: its numbered outline, its three registers and its index of written chapters. */
export interface Book {
  readonly inputs: BookInputs;
  readonly names: BookFileNames;
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

// Astro loads this module twice in one build, once for the config and once in the pages' prerender bundle, so the
// "warned" flag lives on globalThis to print the fixture warning once per process.
const FIXTURE_WARNED = Symbol.for("@buildanagent/manual:fixture-warned");
const shared = globalThis as { [FIXTURE_WARNED]?: boolean };

/**
 * Where the build reads chapters and their fact-check logs: `src/content/chapters/` and `fact-checks/`, unless
 * `BOOK_FIXTURE_DIR` names a directory holding `chapters/` and `fact-checks/`. Only the site's build test sets it, to
 * build one fixture chapter while the book has none of its own, so a process that uses it says so once on stderr. A
 * relative value resolves against the app's directory. `src/content.config.ts` reads the same directories, so the
 * collection and the content model always see the same files.
 */
export function contentDirs(app: string = appRoot()): { readonly chaptersDir: string; readonly factChecksDir: string } {
  const fixture = process.env.BOOK_FIXTURE_DIR;
  if (fixture === undefined || fixture === "") {
    return { chaptersDir: join(app, "src/content/chapters"), factChecksDir: join(app, "fact-checks") };
  }
  const dir = resolve(app, fixture);
  if (!shared[FIXTURE_WARNED]) {
    shared[FIXTURE_WARNED] = true;
    console.warn(`BOOK_FIXTURE_DIR is set: building the fixture chapters in ${dir}, not the book's own`);
  }
  return { chaptersDir: join(dir, "chapters"), factChecksDir: join(dir, "fact-checks") };
}

/** The real book's inputs: `src/outline.ts`, the chapters, their fact-check logs and the three registers. */
export function bookInputs(): BookInputs {
  const app = appRoot();
  return {
    outline: bookOutline,
    outlineFile: join(app, "src/outline.ts"),
    ...contentDirs(app),
    sourcesFile: join(app, "src/data/sources.json"),
    glossaryFile: join(app, "src/data/glossary.json"),
    analogiesFile: join(app, "src/content/analogies.json"),
    repoRoot: join(app, "../.."),
  };
}

let realBook: Book | undefined;

/**
 * The real book for the pages and the layouts, loaded on first use and cached. Astro bundles the pages into their own
 * module graph, so a build loads the book twice: once in `astro.config.mjs` and once here, each cached.
 */
export function getBook(): Book {
  realBook ??= loadBook();
  return realBook;
}

function readJson(file: string, shownAs: string, problems: ProblemList): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.add(shownAs, `cannot read this file as JSON: ${error instanceof Error ? error.message : String(error)}`);
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
  const names: BookFileNames = {
    outline: name(inputs.outlineFile),
    sources: name(inputs.sourcesFile),
    glossary: name(inputs.glossaryFile),
    analogies: name(inputs.analogiesFile),
  };
  checkOutline(inputs.outline, names.outline, problems);
  const chapters = numberChapters(inputs.outline);
  const bySlug = new Map(chapters.map((chapter) => [chapter.slug, chapter]));
  const sources = checkSources(
    readJson(inputs.sourcesFile, names.sources, problems),
    names.sources,
    inputs.repoRoot,
    problems,
  );
  const sourceIds = new Set(sources.map((source) => source.id));
  const glossary = checkGlossary(
    readJson(inputs.glossaryFile, names.glossary, problems),
    names.glossary,
    sourceIds,
    problems,
  );
  const analogies = checkAnalogies(
    readJson(inputs.analogiesFile, names.analogies, problems),
    { file: names.analogies, outlineFile: names.outline },
    new Set(bySlug.keys()),
    problems,
  );
  const index = indexChapters(
    chapters,
    { chaptersDir: inputs.chaptersDir, factChecksDir: inputs.factChecksDir, name },
    problems,
  );
  checkIllustrations(analogies, index, names.analogies, problems);
  problems.throwIfAny();
  return {
    inputs,
    names,
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
 * What every chapter's rendered output depends on beyond its own file: which chapters exist, their numbers, the
 * numbered blocks in each, and the line offset of each body, which error lines depend on. Astro caches a chapter until the chapter itself changes, so `astro.config.mjs` clears the
 * cache when this text changes, as when a figure is added to one chapter and another chapter refers to it.
 */
export function renderDependencies(book: Book): string {
  return JSON.stringify(
    book.chapters.map((chapter) => ({
      slug: chapter.slug,
      number: chapter.number,
      blocks: book.index.written.get(chapter.slug)?.blocks.map((block) => [block.kind, block.id, block.number]) ?? null,
      // A front-matter edit moves every line below it, and the plugins add this offset to each error's line.
      bodyLineOffset: book.index.written.get(chapter.slug)?.bodyLineOffset ?? null,
    })),
  );
}
