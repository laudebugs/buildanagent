// `audit:papers`: a read-only report of how the chapters name the register's research papers, for the content todos
// that fill in each paper's short name and blurb and convert its mentions. It reports; `check:book` enforces.

import type { Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import type { Book } from "./load.js";
import {
  chapterTree,
  isPaperUrl,
  type MentionKind,
  maskRefs,
  NOT_PROSE,
  namedSpellings,
  paperUses,
  type Spelling,
} from "./papers.js";

/** How one chapter mentions one paper. */
export interface ChapterAudit {
  readonly slug: string;
  readonly number: number;
  readonly counts: Readonly<Record<MentionKind, number>>;
  /** How the chapter first mentions the paper. */
  readonly first: MentionKind;
  /** Whether that first mention describes the paper: a `[[paper:id]]`, which shows the blurb, or one marked described. */
  readonly firstDescribed: boolean;
  /** Bare mentions after the first, which link nowhere. */
  readonly laterUnlinked: number;
}

/** One paper in the register and its mentions. */
export interface PaperAudit {
  readonly id: string;
  readonly pending: boolean;
  /** The spellings searched as bare text: the short name and aliases, or, for a pending paper, a guess from its title. */
  readonly names: readonly string[];
  readonly guessed: boolean;
  readonly urlIsPaper: boolean;
  readonly chapters: readonly ChapterAudit[];
}

/** A capitalised name near "paper", "arXiv" or "et al." that no register paper is known by. */
export interface Candidate {
  readonly name: string;
  readonly chapters: ReadonlyMap<string, number>;
  /** A register paper the name probably means, by its id or its authors, so it may only need an alias. */
  readonly probably?: string;
}

/** The whole report. */
export interface Audit {
  readonly papers: readonly PaperAudit[];
  readonly candidates: readonly Candidate[];
}

const KINDS: readonly MentionKind[] = ["ref", "described", "cite", "bare"];

/**
 * A pending paper's likely name, from its title: the part before a colon when it is one or two words, as in "ReAct:
 * Synergizing …" or "τ-bench: A Benchmark …". A title without one gives no guess.
 */
export function guessName(title: string): string | undefined {
  const head = title.split(":")[0]?.trim();
  if (head === undefined || head === title.trim() || head.split(/\s+/).length > 2) return undefined;
  return /\p{Lu}|τ/u.test(head) ? head : undefined;
}

/** Everyday capitalised words and acronyms the candidate search ignores; they name no paper. */
const NOT_PAPERS = new Set([
  "AI",
  "API",
  "APIs",
  "CLI",
  "GPT",
  "HTTP",
  "HTTPS",
  "ID",
  "JSON",
  "LLM",
  "LLMs",
  "MCP",
  "PDF",
  "RAG",
  "SDK",
  "SDKs",
  "SQL",
  "UI",
  "URL",
  "AWS",
  "GitHub",
  "LangChain",
  "OpenAI",
  "TypeScript",
  "JavaScript",
  "OWASP",
  "README",
]);

/** A name with at least two capitals, such as SkillCFI, ACaM or MAP, or a Greek-lettered one such as τ-bench. */
const SYSTEM_NAME =
  /(?<![\p{L}\p{N}_-])((?:\p{Lu}[\p{L}\p{N}]*\p{Lu}[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*)|τ-[\p{L}\p{N}-]+)(?![\p{L}\p{N}_])/gu;
/** The surname before "et al.". */
const ET_AL = /(\p{Lu}[\p{L}'-]+) et al\./gu;
/** Words that say a name nearby is research. */
const NEAR = /\bpapers?\b|arXiv|et al\./g;
/** How far from such a word a name may sit, in characters. */
const WINDOW = 160;

/** Each text node of prose in a tree, with `[[…]]` and `[@…]` blanked so ids never read as names. */
function proseTexts(tree: Root): string[] {
  const texts: string[] = [];
  visit(tree, (node) => {
    if (NOT_PROSE.has(node.type)) return SKIP;
    if (node.type === "text") texts.push(maskRefs((node as Text).value));
    return undefined;
  });
  return texts;
}

function candidatesIn(text: string, known: ReadonlySet<string>): string[] {
  const names: string[] = [];
  for (const near of text.matchAll(NEAR)) {
    const from = Math.max(0, near.index - WINDOW);
    const window = text.slice(from, near.index + near[0].length + WINDOW);
    for (const m of window.matchAll(SYSTEM_NAME)) names.push(m[1] ?? "");
    for (const m of window.matchAll(ET_AL)) names.push(`${m[1] ?? ""} et al.`);
  }
  return [...new Set(names)].filter(
    (name) => name !== "" && !known.has(name) && !NOT_PAPERS.has(name) && !/^GPT-/.test(name),
  );
}

/** The register paper a candidate name probably means: one whose id holds the name, or whose authors include it. */
function probablePaper(name: string, papers: readonly { readonly id: string; readonly publisher: string }[]) {
  const word = name.replace(/ et al\.$/, "");
  return papers.find(
    (paper) => paper.id.split("-").includes(word.toLowerCase()) || new RegExp(`\\b${word}\\b`).test(paper.publisher),
  )?.id;
}

/** Audits every paper in the register against every written chapter. Reads the chapters; writes nothing. */
export function auditPapers(book: Book): Audit {
  const papers = [...book.sources.values()].filter((source) => source.kind === "paper");
  const spellings: Spelling[] = namedSpellings(book.papers);
  const guesses = new Map<string, string>();
  for (const paper of papers) {
    if (book.papers.named.has(paper.id)) continue;
    const guess = guessName(paper.title);
    if (guess !== undefined) {
      guesses.set(paper.id, guess);
      spellings.push({ id: paper.id, name: guess });
    }
  }
  const uses = paperUses(book.index.written.values(), book.papers, book.sources, spellings);
  const audits = papers.map((paper): PaperAudit => {
    const named = book.papers.named.get(paper.id);
    const guess = guesses.get(paper.id);
    return {
      id: paper.id,
      pending: book.papers.pending.has(paper.id),
      names: named?.names ?? (guess === undefined ? [] : [guess]),
      guessed: named === undefined && guess !== undefined,
      urlIsPaper: isPaperUrl(paper.url),
      chapters: (uses.get(paper.id) ?? []).map(({ chapter, mentions }) => {
        const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<MentionKind, number>;
        for (const mention of mentions) counts[mention.kind] += 1;
        const first = mentions[0]?.kind ?? "bare";
        return {
          slug: chapter.slug,
          number: chapter.number,
          counts,
          first,
          firstDescribed: first === "ref" || first === "described",
          laterUnlinked: mentions.slice(1).filter((mention) => mention.kind === "bare").length,
        };
      }),
    };
  });
  const known = new Set(spellings.map((spelling) => spelling.name));
  const found = new Map<string, Map<string, number>>();
  for (const { chapter, file } of book.index.written.values()) {
    for (const text of proseTexts(chapterTree(file))) {
      for (const name of candidatesIn(text, known)) {
        const chapters = found.get(name) ?? new Map<string, number>();
        chapters.set(chapter.slug, (chapters.get(chapter.slug) ?? 0) + 1);
        found.set(name, chapters);
      }
    }
  }
  const candidates = [...found]
    .map(([name, chapters]): Candidate => {
      const probably = probablePaper(name, papers);
      return probably === undefined ? { name, chapters } : { name, chapters, probably };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { papers: audits, candidates };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The report as the script prints it. */
export function formatAudit(audit: Audit): string {
  const lines: string[] = [];
  const named = audit.papers.filter((paper) => !paper.pending).length;
  lines.push(
    `audit:papers: ${plural(audit.papers.length, "paper")} in the register, ${named} named, ${audit.papers.length - named} pending`,
  );
  lines.push("");
  const perChapter = new Map<string, { number: number; counts: Record<MentionKind, number> }>();
  let undescribed = 0;
  for (const paper of audit.papers) {
    const label = paper.pending ? "pending" : "named";
    const names =
      paper.names.length === 0
        ? "no name to search"
        : `${paper.guessed ? "guessed " : ""}${paper.names.map((name) => `"${name}"`).join(", ")}`;
    lines.push(`${paper.id} (${label}; ${names}${paper.urlIsPaper ? "" : "; url is not a paper's own page"})`);
    if (paper.chapters.length === 0) lines.push("  no chapter mentions it");
    for (const chapter of paper.chapters) {
      const counts = KINDS.map((kind) => `${kind} ${chapter.counts[kind]}`).join(", ");
      lines.push(
        `  chapter ${chapter.number} ${chapter.slug}: ${counts}; first: ${chapter.first}` +
          ` (${chapter.firstDescribed ? "described" : "not described"}); later bare: ${chapter.laterUnlinked}`,
      );
      if (!chapter.firstDescribed) undescribed += 1;
      const total = perChapter.get(chapter.slug) ?? {
        number: chapter.number,
        counts: Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<MentionKind, number>,
      };
      for (const kind of KINDS) total.counts[kind] += chapter.counts[kind];
      perChapter.set(chapter.slug, total);
    }
  }
  lines.push("", "Mentions per chapter:");
  let mentions = 0;
  let bare = 0;
  for (const [slug, { number, counts }] of [...perChapter].sort((a, b) => a[1].number - b[1].number)) {
    const total = KINDS.reduce((sum, kind) => sum + counts[kind], 0);
    mentions += total;
    bare += counts.bare;
    lines.push(`  chapter ${number} ${slug}: ${total} (${KINDS.map((kind) => `${kind} ${counts[kind]}`).join(", ")})`);
  }
  lines.push(
    "",
    `Totals: ${plural(mentions, "mention")}, ${bare} bare (unlinked), ` +
      `${undescribed} chapter-paper pair(s) whose first mention is not described`,
  );
  lines.push(
    "",
    `Candidates near "paper", "arXiv" or "et al." that match no register paper: ${audit.candidates.length}`,
  );
  for (const { name, chapters, probably } of audit.candidates) {
    const where = [...chapters].map(([slug, count]) => `${slug} (${count})`).join(", ");
    lines.push(`  ${name}: ${where}${probably === undefined ? "" : `; probably ${probably}, so maybe an alias`}`);
  }
  return lines.join("\n");
}
