// The register's research papers and the rules for naming them in chapters. A chapter writes a paper as
// `[[paper:id]]`, which renders the paper's `short` name as a link to its entry on the sources page; the chapter's
// first one also shows the paper's `blurb`, unless it is written `[[paper:id described]]` because the sentence
// around it already describes the paper. A `[@id]` citation of a paper counts as a linked mention, but never as the
// first one, because it carries no description. A paper's name written as bare text fails.
//
// `src/data/papers-pending.json` lists the papers that have no `short` and `blurb` yet. They are exempt from these
// rules until the content todos fill them in and empty the list.

import { existsSync, readFileSync } from "node:fs";
import type { Root, RootContent, Text } from "mdast";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { chapterBody } from "./book-index.js";
import { CITE } from "./citations.js";
import type { NumberedChapter } from "./outline-rules.js";
import type { ProblemList } from "./problems.js";
import type { Source } from "./sources.js";

/** A `[[paper:id]]` or `[[paper:id described]]` reference as written. */
export const PAPER_REF = /\[\[paper:([a-z0-9]+(?:-[a-z0-9]+)*)( described)?\]\]/g;

/** Anything that starts like a paper reference, so a malformed one fails instead of staying text. */
export const PAPER_REF_LIKE = /\[\[paper:[^\]]{0,200}\]\]/g;

/** Where a paper's name links: its entry on the sources page. */
export const paperHref = (id: string): string => `/sources/#${id}`;

/** The id of a chapter's first mention of a paper, which the sources page's "Cited in" links to. */
export const paperAnchor = (id: string): string => `paper-${id}`;

/**
 * The URL shapes a paper's entry may link to, each with the reason it names the paper itself rather than a page
 * about it. Only the shape is checked; nothing is fetched.
 */
export const PAPER_URL_SHAPES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}$/,
    reason: "an arXiv abstract page, which links every version",
  },
  { pattern: /^https:\/\/doi\.org\/10\.\d{4,9}\/\S+$/, reason: "a DOI, which resolves to the publisher's page" },
  { pattern: /^https:\/\/dl\.acm\.org\/doi\/10\.\d{4,9}\/\S+$/, reason: "the ACM Digital Library's page for a DOI" },
  { pattern: /^https:\/\/aclanthology\.org\/[\w.-]+\/?$/, reason: "an ACL Anthology paper page" },
  { pattern: /^https:\/\/openreview\.net\/forum\?id=[\w-]+$/, reason: "an OpenReview forum, a venue's review page" },
  { pattern: /^https:\/\/proceedings\.mlr\.press\/v\d+\/[\w.-]+\.html$/, reason: "a PMLR proceedings page" },
  {
    pattern: /^https:\/\/proceedings\.neurips\.cc\/paper_files\/paper\/\d{4}\/hash\/[\w-]+\.html$/,
    reason: "a NeurIPS proceedings page",
  },
  { pattern: /^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/?$/, reason: "a PubMed Central article" },
];

/** Whether a URL has one of the shapes a paper's entry may link to. */
export const isPaperUrl = (url: string): boolean => PAPER_URL_SHAPES.some(({ pattern }) => pattern.test(url));

/** A paper whose entry has its `short` name and `blurb`, so chapters must name it through `[[paper:id]]`. */
export interface NamedPaper {
  readonly source: Source;
  readonly short: string;
  readonly blurb: string;
  /** The short name and the aliases: every spelling a chapter must not write bare. */
  readonly names: readonly string[];
}

/** The register's papers, split into those with a name and blurb and those still pending. */
export interface Papers {
  readonly named: ReadonlyMap<string, NamedPaper>;
  /** Ids on `papers-pending.json`: papers without `short` and `blurb` yet, exempt from the naming rules. */
  readonly pending: ReadonlySet<string>;
}

/**
 * Checks the papers in the register against the pending list. A paper not on the list needs `short`, `blurb` and a
 * URL of a known shape; an id on the list must be a paper with neither `short` nor `blurb`, so the list only shrinks.
 * No spelling may belong to two papers.
 */
export function checkPapers(
  sources: readonly Source[],
  pendingData: unknown,
  files: { readonly sources: string; readonly pending: string },
  problems: ProblemList,
): Papers {
  const pending = readPending(pendingData, files.pending, problems);
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const id of pending) {
    const source = byId.get(id);
    if (source === undefined || source.kind !== "paper") {
      problems.add(files.pending, `${id} is not a paper in the register; remove it from the list`);
    } else if (source.short !== undefined || source.blurb !== undefined) {
      problems.add(files.pending, `${id} already has a short name or a blurb; remove it from the list`);
    }
  }
  const named = new Map<string, NamedPaper>();
  const spellings = new Map<string, string>();
  for (const source of sources) {
    if (source.kind !== "paper" || pending.has(source.id)) continue;
    const missing = (["short", "blurb"] as const).filter((key) => source[key] === undefined);
    if (missing.length > 0) {
      problems.add(
        files.sources,
        `${source.id}: a paper needs ${missing.join(" and ")}; fill ${missing.length === 1 ? "it" : "them"} in, or list ` +
          `the id in ${files.pending} until a content todo does`,
      );
    }
    if (!isPaperUrl(source.url)) {
      problems.add(
        files.sources,
        `${source.id}: ${source.url} is not a paper's own page; link its arXiv abstract (https://arxiv.org/abs/<id>), ` +
          "its DOI (https://doi.org/10.…) or its page at a venue that papers.ts lists",
      );
    }
    if (source.short === undefined || source.blurb === undefined) continue;
    const names = [source.short, ...(source.aliases ?? [])];
    for (const name of names) {
      const owner = spellings.get(name);
      if (owner !== undefined) problems.add(files.sources, `${source.id}: "${name}" already names ${owner}`);
      spellings.set(name, source.id);
    }
    named.set(source.id, { source, short: source.short, blurb: source.blurb, names });
  }
  return { named, pending };
}

function readPending(data: unknown, file: string, problems: ProblemList): ReadonlySet<string> {
  if (!Array.isArray(data) || !data.every((id): id is string => typeof id === "string")) {
    problems.add(file, "the pending list must be a JSON array of register ids");
    return new Set();
  }
  const ids = new Set<string>();
  for (const id of data) {
    if (ids.has(id)) problems.add(file, `${id} appears twice`);
    ids.add(id);
  }
  return ids;
}

/** How a chapter mentions a paper. */
export type MentionKind =
  /** `[[paper:id]]`: a link, with the blurb on the chapter's first mention. */
  | "ref"
  /** `[[paper:id described]]`: a link, and the sentence around it describes the paper. */
  | "described"
  /** `[@id]` or one id in `[@a; @b]`: a numbered link to the paper's entry. */
  | "cite"
  /** The paper's short name or an alias as bare text. */
  | "bare";

/** One mention of a paper in a chapter: where it is, as a text node and an offset in its value. */
export interface Mention {
  readonly id: string;
  readonly kind: MentionKind;
  readonly node: Text;
  readonly index: number;
  readonly text: string;
}

/**
 * Text inside a link is never a mention, because links cannot nest. Code, inline code and HTML hold their text as a
 * value, not as text nodes, so the walk never reads them; nor does it read a figure's id or alt text, which are
 * directive attributes.
 */
export const NOT_PROSE: ReadonlySet<string> = new Set(["link", "linkReference"]);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One expression for every bare spelling of every named paper, longest first, matched with its exact case. A match
 * cannot touch a letter, a digit or an underscore on either side, so "Voyager" does not match inside "Voyagers", while
 * "Voyager's" and "Voyager-style" still name the paper.
 */
function bareMatcher(spellings: readonly Spelling[]): { readonly re: RegExp; readonly owners: readonly string[] } {
  const all = [...spellings];
  all.sort((a, b) => b.name.length - a.name.length);
  const source = all.length > 0 ? all.map(({ name }, i) => `(?<p${i}>${escapeRegExp(name)})`).join("|") : "(?!)";
  return { re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, "gu"), owners: all.map((a) => a.id) };
}

/** A spelling of a paper's name that a chapter must not write bare. */
export interface Spelling {
  readonly id: string;
  readonly name: string;
}

/** Every bare spelling of the named papers: each short name and alias. */
export const namedSpellings = (papers: Papers): Spelling[] =>
  [...papers.named.values()].flatMap((paper) => paper.names.map((name) => ({ id: paper.source.id, name })));

/** Blanks every `[[…]]` reference and `[@…]` citation, keeping offsets, so an id inside one never reads as a name. */
export const maskRefs = (value: string): string =>
  value.replace(/\[\[[^\]]*\]\]|\[@[^\]]*\]/g, (m) => " ".repeat(m.length));

/**
 * Every mention of a paper in a chapter's tree, in reading order: `[[paper:…]]` references, `[@…]` citations of
 * papers, and bare spellings, by default those of the named papers. A reference names any id, so the caller can
 * reject one that is not a paper; a citation counts only when its id is a paper.
 */
export function paperMentions(
  tree: Root,
  papers: Papers,
  sources: ReadonlyMap<string, Source>,
  spellings: readonly Spelling[] = namedSpellings(papers),
): Mention[] {
  const { re, owners } = bareMatcher(spellings);
  const mentions: Mention[] = [];
  visit(tree, (node) => {
    if (NOT_PROSE.has(node.type)) return SKIP;
    if (node.type !== "text") return undefined;
    const value = node.value;
    const found: Mention[] = [];
    for (const m of value.matchAll(PAPER_REF)) {
      const id = m[1] ?? "";
      found.push({ id, kind: m[2] ? "described" : "ref", node, index: m.index, text: m[0] });
    }
    for (const m of value.matchAll(CITE)) {
      let offset = 1;
      for (const part of (m[1] ?? "").split(";")) {
        const id = part.trim().slice(1);
        if (sources.get(id)?.kind === "paper") {
          found.push({ id, kind: "cite", node, index: m.index + offset, text: m[0] });
        }
        offset += part.length + 1;
      }
    }
    for (const m of maskRefs(value).matchAll(re)) {
      const key = Object.keys(m.groups ?? {}).find((name) => m.groups?.[name] !== undefined);
      const id = key === undefined ? undefined : owners[Number(key.slice(1))];
      if (id !== undefined) found.push({ id, kind: "bare", node, index: m.index, text: m[0] });
    }
    mentions.push(...found.sort((a, b) => a.index - b.index));
    return undefined;
  });
  return mentions;
}

/**
 * A chapter's tree as the book's plugins see it before they change it: parsed with directives, with each bare text
 * directive, such as the `:ruan-skillcfi` inside `[[paper:ruan-skillcfi]]`, put back as text and joined to the text
 * around it. Positions are the file's own lines.
 */
export function chapterTree(file: string): Root {
  const tree = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .parse(chapterBody(readFileSync(file, "utf8")));
  visit(tree, (node, index, parent) => {
    if (node.type !== "textDirective" || parent === undefined || index === undefined) return undefined;
    if (node.children.length > 0 || Object.keys(node.attributes ?? {}).length > 0) return undefined;
    const text: Text = { type: "text", value: `:${node.name}`, ...(node.position ? { position: node.position } : {}) };
    parent.children.splice(index, 1, text);
    return index;
  });
  visit(tree, (node) => {
    if (!("children" in node)) return;
    const merged: RootContent[] = [];
    for (const child of node.children as RootContent[]) {
      const previous = merged.at(-1);
      if (child.type === "text" && previous?.type === "text") {
        const start = previous.position?.start;
        const end = child.position?.end;
        merged[merged.length - 1] = {
          type: "text",
          value: previous.value + child.value,
          ...(start && end ? { position: { start, end } } : {}),
        };
      } else {
        merged.push(child);
      }
    }
    node.children = merged as never;
  });
  return tree;
}

/** The mentions of one paper in one chapter, in reading order. */
export interface PaperUse {
  readonly chapter: NumberedChapter;
  readonly mentions: readonly Mention[];
}

/**
 * Every paper's mentions in every written chapter, by paper id, chapters in reading order. The sources page lists
 * them as "Cited in", `check:book` prints the `described` ones, and the audit counts them all.
 */
export function paperUses(
  chapters: Iterable<{ readonly chapter: NumberedChapter; readonly file: string }>,
  papers: Papers,
  sources: ReadonlyMap<string, Source>,
  spellings: readonly Spelling[] = namedSpellings(papers),
): ReadonlyMap<string, readonly PaperUse[]> {
  const uses = new Map<string, PaperUse[]>();
  const ordered = [...chapters].sort((a, b) => a.chapter.number - b.chapter.number);
  for (const { chapter, file } of ordered) {
    if (!existsSync(file)) continue;
    const byId = new Map<string, Mention[]>();
    for (const mention of paperMentions(chapterTree(file), papers, sources, spellings)) {
      if (sources.get(mention.id)?.kind !== "paper") continue;
      byId.set(mention.id, [...(byId.get(mention.id) ?? []), mention]);
    }
    for (const [id, mentions] of byId) uses.set(id, [...(uses.get(id) ?? []), { chapter, mentions }]);
  }
  return uses;
}

/** The line a mention sits on, in the chapter file. */
export const mentionLine = (mention: Mention): number | undefined => {
  const start = mention.node.position?.start;
  if (start === undefined) return undefined;
  return start.line + (mention.node.value.slice(0, mention.index).match(/\n/g)?.length ?? 0);
};

/** A chapter that mentions a paper, as the sources page's "Cited in" links to it. */
export interface Citation {
  readonly number: number;
  readonly title: string;
  /** The chapter's first mention of the paper when it is a `[[paper:id]]`, which carries the anchor; else the chapter. */
  readonly href: string;
}

/** For each paper, the chapters that mention it, in reading order, each linking to its first mention there. */
export function paperCitations(book: {
  readonly index: {
    readonly written: ReadonlyMap<string, { readonly chapter: NumberedChapter; readonly file: string }>;
  };
  readonly papers: Papers;
  readonly sources: ReadonlyMap<string, Source>;
}): ReadonlyMap<string, readonly Citation[]> {
  const citations = new Map<string, Citation[]>();
  for (const [id, uses] of paperUses(book.index.written.values(), book.papers, book.sources)) {
    citations.set(
      id,
      uses.map(({ chapter, mentions }) => {
        const first = mentions[0];
        const anchored = first !== undefined && (first.kind === "ref" || first.kind === "described");
        return {
          number: chapter.number,
          title: chapter.title,
          href: anchored ? `/${chapter.slug}/#${paperAnchor(id)}` : `/${chapter.slug}/`,
        };
      }),
    );
  }
  return citations;
}
