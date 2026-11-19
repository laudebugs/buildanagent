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

/** One entry in the source register, `src/data/sources.json`. */
export const sourceSchema = z.strictObject({
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
  /** The repository path of the fact-check log that verified this source; it must contain `url`. */
  verifiedIn: z.string().trim().min(1),
  /** True when that check rests on a search summary or a secondary write-up. */
  secondary: z.boolean().optional(),
});

/** One entry in the source register. */
export type Source = z.infer<typeof sourceSchema>;

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
