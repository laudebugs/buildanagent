import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import { KEBAB_ID } from "./outline-rules.js";
import type { ProblemList } from "./problems.js";
import { formatIssues } from "./zod-issues.js";

/** The kinds of source the register holds (BK6). */
export const SOURCE_KINDS = ["docs", "repo", "paper", "spec", "post"] as const;

const MONTH_YEAR =
  /^(January|February|March|April|May|June|July|August|September|October|November|December) (19|20)\d{2}$/;

/** Markdown a short name or a blurb must not hold: they render as plain text inside a sentence. */
const MARKUP = /`|\[|\]|\*\*|__/;

/** The longest blurb: a clause inside a sentence, not a paragraph. */
const MAX_BLURB = 240;

/**
 * A paper's display name, as chapters write it: `SkillCFI`, `ReAct`. The bare-name rule matches it with its exact
 * case, so it must hold a letter.
 */
const paperName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((text) => !MARKUP.test(text), "a paper's name must be plain text, with no Markdown")
  .refine((text) => /\p{L}/u.test(text), "a paper's name must hold a letter");

/** One entry in the source register, `src/data/sources.json`. */
const sourceFields = z.strictObject({
  /** The id chapters cite with `[@id]`, and the anchor on the sources page. */
  id: z.string().regex(KEBAB_ID, "id must be kebab-case"),
  title: z.string().trim().min(1),
  /** Who wrote or publishes the source, as the sources page shows it. */
  publisher: z.string().trim().min(1),
  url: z.url({ protocol: /^https$/ }),
  kind: z.enum(SOURCE_KINDS),
  /** The month and year the source was read, shown as "as of <month year>". */
  asOf: z.string().regex(MONTH_YEAR, 'asOf must be a month and year, such as "November 2026"'),
  /** A version, tag or commit, when the source has one. */
  version: z.string().trim().min(1).optional(),
  /** The repository path of the fact-check log that verified this source; it must be a fact-check log holding `url`. */
  verifiedIn: z.string().trim().min(1),
  /** True when that check rests on a search summary or a secondary write-up. */
  secondary: z.boolean().optional(),
  /** A paper's display name, which a chapter's `[[paper:id]]` shows as a link and which no chapter writes bare. */
  short: paperName.optional(),
  /**
   * A paper's description: who wrote it, where and when it appeared, and in one clause what it does or found. A
   * chapter's first `[[paper:id]]` shows it in parentheses after the name, so it is plain text with no parentheses and
   * no closing full stop: "a November 2026 arXiv paper by Ruan et al. on control-flow integrity for agent skills".
   */
  blurb: z
    .string()
    .trim()
    .min(1)
    .max(MAX_BLURB, `a blurb is one clause; keep it under ${MAX_BLURB} characters`)
    .refine((text) => !MARKUP.test(text), "the blurb must be plain text, with no Markdown")
    .refine((text) => !/[()]/.test(text), "the blurb shows inside parentheses, so it holds none of its own")
    .refine((text) => !/[.!?]$/.test(text), "the blurb shows mid-sentence, so it ends without a full stop")
    .optional(),
  /** Other spellings of a paper's name that chapters must not write bare either, such as "τ-bench" for "tau-bench". */
  aliases: z.array(paperName).min(1).optional(),
});

/**
 * One entry in the source register, `src/data/sources.json`. Only a paper takes `short`, `blurb` and `aliases`. A
 * paper needs `short` and `blurb` unless `src/data/papers-pending.json` lists it; `checkPapers` applies that rule,
 * because the schema cannot see the list.
 */
export const sourceSchema = sourceFields.superRefine((entry, ctx) => {
  if (entry.kind === "paper") return;
  for (const key of ["short", "blurb", "aliases"] as const) {
    if (entry[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `only a paper takes ${key}` });
  }
});

/** One entry in the source register. */
export type Source = z.infer<typeof sourceSchema>;

/**
 * The fact-check logs a register entry may name as `verifiedIn`: the research logs, the plan reviews' logs, each SDK
 * reference's log and each chapter's own log. A source verified anywhere else has not been fact-checked (BK6).
 */
const FACT_CHECK_LOGS: readonly RegExp[] = [
  /^docs\/research\/(?:[^/]+\/)*fact-check[^/]*\.md$/,
  /^docs\/plans\/reviews\/fact-check[^/]*\.md$/,
  /^docs\/reference\/[^/]+\/fact-check\.md$/,
  /^apps\/manual\/fact-checks\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/,
];

/** Whether a repository path is one of the fact-check logs a register entry may name. */
export const isFactCheckLog = (path: string): boolean => FACT_CHECK_LOGS.some((pattern) => pattern.test(path));

const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"'`|]+/g;

/** Strips what Markdown and prose leave around a URL, so `(https://a/b).` and `https://a/b/` compare equal. */
export function normalizeUrl(url: string): string {
  return url.replace(/[.,;:!?*_]+$/, "").replace(/\/$/, "");
}

/**
 * Every URL a file mentions, normalised. It reads inline links, bare URLs and reference-style definitions alike,
 * because a fact-check log that cites a source by a link label still defines the label's URL somewhere in the file.
 */
export function urlsIn(text: string): ReadonlySet<string> {
  return new Set([...text.matchAll(URL_IN_TEXT)].map(([url]) => normalizeUrl(url)));
}

/**
 * Parses and checks the register: each entry matches the schema, ids appear once, and each `verifiedIn` file exists
 * under `repoRoot` and contains the entry's URL. Returns the entries that parsed, so later checks can still run.
 */
export function checkSources(data: unknown, file: string, repoRoot: string, problems: ProblemList): readonly Source[] {
  const parsed = z.array(z.unknown()).safeParse(data);
  if (!parsed.success) {
    problems.add(file, "the register must be a JSON array of sources");
    return [];
  }
  const sources: Source[] = [];
  const ids = new Set<string>();
  const urlsByFile = new Map<string, ReadonlySet<string> | undefined>();
  for (const [index, raw] of parsed.data.entries()) {
    const entry = sourceSchema.safeParse(raw);
    if (!entry.success) {
      problems.add(file, `entry ${index + 1}: ${formatIssues(entry.error)}`);
      continue;
    }
    const source = entry.data;
    if (ids.has(source.id)) problems.add(file, `${source.id}: the id appears twice`);
    ids.add(source.id);
    checkVerifiedIn(source, file, repoRoot, urlsByFile, problems);
    sources.push(source);
  }
  return sources;
}

function checkVerifiedIn(
  source: Source,
  file: string,
  repoRoot: string,
  urlsByFile: Map<string, ReadonlySet<string> | undefined>,
  problems: ProblemList,
): void {
  if (!isFactCheckLog(source.verifiedIn)) {
    problems.add(
      file,
      `${source.id}: verifiedIn names ${source.verifiedIn}, which is not a fact-check log; name a docs/research, ` +
        "docs/plans/reviews or docs/reference fact-check log, or apps/manual/fact-checks/<slug>.md",
    );
    return;
  }
  if (!urlsByFile.has(source.verifiedIn)) {
    const path = join(repoRoot, source.verifiedIn);
    const isFile = existsSync(path) && statSync(path).isFile();
    urlsByFile.set(source.verifiedIn, isFile ? urlsIn(readFileSync(path, "utf8")) : undefined);
  }
  const urls = urlsByFile.get(source.verifiedIn);
  if (urls === undefined) {
    problems.add(file, `${source.id}: verifiedIn names ${source.verifiedIn}, which is not a file in the repository`);
  } else if (!urls.has(normalizeUrl(source.url))) {
    problems.add(
      file,
      `${source.id}: ${source.verifiedIn} does not mention ${source.url}; add a fact-check row for it there first`,
    );
  }
}
