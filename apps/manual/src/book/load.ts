import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { outline as bookOutline } from "../outline.js";
import { type Analogy, checkAnalogies } from "./analogies.js";
import { type BookIndex, indexChapters } from "./book-index.js";
import { checkGlossary, type GlossaryEntry } from "./glossary.js";
import { listingContext } from "./listings.js";
import { checkOutline, type NumberedChapter, numberChapters } from "./outline-rules.js";
import type { Outline } from "./outline-types.js";
import { ProblemList } from "./problems.js";
import { checkSources, type Source } from "./sources.js";

/** Where a book's content lives. The real book's inputs come from `bookInputs()`; the tests pass fixture books. */
export interface BookInputs {
  readonly outline: Outline;
  /** The file the outline comes from, for messages. */
  readonly outlineFile: string;
  /** The directory that holds `<slug>.md` for each written chapter. */
  readonly chaptersDir: string;
  /** The directory that holds each written chapter's fact-check log, `<slug>.md` (BK21). */
  readonly factChecksDir: string;
  /** The directory that holds each generated figure, `<slug>/<figure id>.svg`, beside the script that draws it. */
  readonly figuresDir: string;
  readonly sourcesFile: string;
  readonly glossaryFile: string;
  readonly analogiesFile: string;
  /** The table of each `verify/` harness's main package, whose pin a listing's caption shows. */
  readonly harnessesFile: string;
  /** The directory that every `verifiedIn` path and every listed file is relative to: the repository root. */
  readonly repoRoot: string;
}

/** The input files as messages name them: relative to the repository root. */
export interface BookFileNames {
  readonly outline: string;
  readonly sources: string;
  readonly glossary: string;
  readonly analogies: string;
  readonly harnesses: string;
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

/** The directories and files that change when a build reads a fixture book instead of the real one. */
export interface ContentDirs {
  readonly chaptersDir: string;
  readonly factChecksDir: string;
  readonly figuresDir: string;
  readonly analogiesFile: string;
}

/** The book's own figures, `figures/<chapter>/<id>.ts` and the SVG each writes, whatever `BOOK_FIXTURE_DIR` says. */
export function bookFiguresDir(app: string = appRoot()): string {
  return join(app, "figures");
}

/**
 * Where the build reads chapters, their fact-check logs, their figures and the analogy register: the book's own, unless
 * `BOOK_FIXTURE_DIR` names a fixture directory holding `chapters/`, `fact-checks/`, `figures/` and `analogies.json`.
 * Only the site's build test sets it, to build fixture chapters while the book has none of its own, so a process that
 * uses it says so once on stderr. A relative value resolves against the app's directory. `src/content.config.ts`
 * reads the same chapters, so the collection and the content model always see the same files.
 */
export function contentDirs(app: string = appRoot()): ContentDirs {
  const fixture = process.env.BOOK_FIXTURE_DIR;
  if (fixture === undefined || fixture === "") {
    return {
      chaptersDir: join(app, "src/content/chapters"),
      factChecksDir: join(app, "fact-checks"),
      figuresDir: bookFiguresDir(app),
      analogiesFile: join(app, "src/content/analogies.json"),
    };
  }
  const dir = resolve(app, fixture);
  if (!shared[FIXTURE_WARNED]) {
    shared[FIXTURE_WARNED] = true;
    console.warn(`BOOK_FIXTURE_DIR is set: building the fixture chapters in ${dir}, not the book's own`);
  }
  return {
    chaptersDir: join(dir, "chapters"),
    factChecksDir: join(dir, "fact-checks"),
    figuresDir: join(dir, "figures"),
    analogiesFile: join(dir, "analogies.json"),
  };
}

/** The real book's inputs: `src/outline.ts`, the chapters with their fact-check logs and figures, and the registers. */
export function bookInputs(): BookInputs {
  const app = appRoot();
  return {
    outline: bookOutline,
    outlineFile: join(app, "src/outline.ts"),
    ...contentDirs(app),
    sourcesFile: join(app, "src/data/sources.json"),
    glossaryFile: join(app, "src/data/glossary.json"),
    harnessesFile: join(app, "src/data/harnesses.json"),
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
 * `verifiedIn` files, the glossary, the analogy register, the harness table, and the numbered blocks of every
 * chapter, including the file, region and pin of every listing. The Markdown
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
    harnesses: name(inputs.harnessesFile),
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
  const listings = listingContext(inputs.repoRoot, inputs.harnessesFile, names.harnesses, problems);
  const index = indexChapters(
    chapters,
    { chaptersDir: inputs.chaptersDir, factChecksDir: inputs.factChecksDir, name, listings },
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
 * numbered blocks in each, the lines and pin each listing shows, and the line offset of each body, which error lines
 * depend on. Astro caches a chapter until the chapter itself changes, so `astro.config.mjs` clears the cache when this
 * text changes, as when a figure is added to one chapter and another chapter refers to it, or when a listed file or
 * its harness's pin changes.
 */
export function renderDependencies(book: Book): string {
  return JSON.stringify(
    book.chapters.map((chapter) => ({
      slug: chapter.slug,
      number: chapter.number,
      blocks:
        book.index.written
          .get(chapter.slug)
          ?.blocks.map((block) => [block.kind, block.id, block.number, block.source ?? null]) ?? null,
      // A front-matter edit moves every line below it, and the plugins add this offset to each error's line.
      bodyLineOffset: book.index.written.get(chapter.slug)?.bodyLineOffset ?? null,
    })),
  );
}

/**
 * The files the book's listings read, from the repository root: each listed file, its harness's `package.json`,
 * whose pin the caption shows, and the transcript a replay shows. Under `astro dev` an edit to one of them restarts
 * the server when it changes what a listing shows.
 */
export function listedFiles(book: Book): string[] {
  const files = new Set<string>();
  for (const block of book.index.blocks.values()) {
    if (block.source === undefined) continue;
    files.add(join(book.inputs.repoRoot, block.source.path));
    files.add(join(book.inputs.repoRoot, block.source.harness, "package.json"));
    if (block.source.replay) files.add(join(book.inputs.repoRoot, block.source.replay.path));
  }
  return [...files].sort();
}
