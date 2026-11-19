import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import type { Root } from "mdast";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { KEBAB_ID, type NumberedChapter } from "./outline-rules.js";
import type { ProblemList } from "./problems.js";

/** The things the build numbers, keyed by the directive name that introduces each. */
export const NUMBERED_KINDS = {
  figure: { prefix: "fig", label: "Figure" },
  listing: { prefix: "lst", label: "Listing" },
  table: { prefix: "tbl", label: "Table" },
} as const;

/** A directive name that the build numbers: `figure`, `listing` or `table`. */
export type NumberedKind = keyof typeof NUMBERED_KINDS;

/** The reference prefix of each kind, as written in `[[fig:id]]`, `[[lst:id]]` and `[[tbl:id]]`. */
export type RefPrefix = (typeof NUMBERED_KINDS)[NumberedKind]["prefix"];

const isNumberedKind = (name: string): name is NumberedKind => Object.hasOwn(NUMBERED_KINDS, name);

/** One numbered block: its kind and id, the chapter it is in, its number there (3.2) and its line. */
export interface NumberedBlock {
  readonly kind: NumberedKind;
  readonly id: string;
  readonly chapter: NumberedChapter;
  readonly number: string;
  readonly line: number;
}

/** A written chapter: its place in the outline, its file and the numbered blocks it holds, in order. */
export interface WrittenChapter {
  readonly chapter: NumberedChapter;
  readonly file: string;
  readonly blocks: readonly NumberedBlock[];
}

/** What the build knows about every chapter before it renders any: which exist and what they number. */
export interface BookIndex {
  readonly written: ReadonlyMap<string, WrittenChapter>;
  /** Every numbered block in the book, keyed by `<prefix>:<id>`, such as `fig:tool-call-round-trip`. */
  readonly blocks: ReadonlyMap<string, NumberedBlock>;
}

/** The key a reference uses for a block: `fig:tool-call-round-trip`. */
export const blockKey = (kind: NumberedKind, id: string): string => `${NUMBERED_KINDS[kind].prefix}:${id}`;

/** A chapter's body with its front matter blanked out line for line, so positions are the file's own lines. */
export function chapterBody(text: string): string {
  return parseFrontmatter(text, { frontmatter: "empty-with-lines" }).content;
}

const parser = unified().use(remarkParse).use(remarkDirective);

/** The numbered directives in one chapter's body, in document order. */
function scanBlocks(body: string): { kind: NumberedKind; id: string | undefined; line: number }[] {
  const tree = parser.runSync(parser.parse(body)) as Root;
  const found: { kind: NumberedKind; id: string | undefined; line: number }[] = [];
  visit(tree, (node) => {
    if ((node.type === "containerDirective" || node.type === "leafDirective") && isNumberedKind(node.name)) {
      found.push({ kind: node.name, id: node.attributes?.id ?? undefined, line: node.position?.start.line ?? 0 });
    }
  });
  return found;
}

/**
 * Reads every chapter file in `chaptersDir`, numbers its figures, listings and tables from its outline position and
 * their order, and reports a file the outline does not name, a block without a kebab-case id, and an id used twice
 * in the book, with each file and line.
 */
export function indexChapters(
  chapters: readonly NumberedChapter[],
  chaptersDir: string,
  problems: ProblemList,
  name: (file: string) => string = (file) => file,
): BookIndex {
  const bySlug = new Map(chapters.map((chapter) => [chapter.slug, chapter]));
  const files = existsSync(chaptersDir) ? readdirSync(chaptersDir).filter((name) => name.endsWith(".md")) : [];
  for (const file of files) {
    if (!bySlug.has(basename(file, ".md"))) {
      problems.add(
        name(join(chaptersDir, file)),
        "this chapter is not in src/outline.ts, so it has no number; add it there",
      );
    }
  }
  const written = new Map<string, WrittenChapter>();
  const blocks = new Map<string, NumberedBlock>();
  for (const chapter of chapters) {
    const file = join(chaptersDir, `${chapter.slug}.md`);
    if (!existsSync(file)) continue;
    const counters = new Map<NumberedKind, number>();
    const own: NumberedBlock[] = [];
    for (const { kind, id, line } of scanBlocks(chapterBody(readFileSync(file, "utf8")))) {
      const count = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, count);
      if (id === undefined || !KEBAB_ID.test(id)) {
        problems.add(name(file), `a ${kind} needs a kebab-case id, written {#some-id}`, line);
        continue;
      }
      const block = { kind, id, chapter, number: `${chapter.number}.${count}`, line };
      const earlier = blocks.get(blockKey(kind, id));
      if (earlier !== undefined) {
        const where = `${name(join(chaptersDir, `${earlier.chapter.slug}.md`))}:${earlier.line}`;
        problems.add(name(file), `the ${kind} id "${id}" is already used at ${where}`, line);
        continue;
      }
      blocks.set(blockKey(kind, id), block);
      own.push(block);
    }
    written.set(chapter.slug, { chapter, file, blocks: own });
  }
  return { written, blocks };
}
