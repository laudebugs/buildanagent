import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ProblemList } from "./problems.js";

/**
 * What the book knows about the occasional live run (book plan BK18): which listed files it has compared with real
 * APIs, from `src/data/live-examples.json` and the live transcripts committed beside each harness's results, and the
 * date of its last complete comparison, from `src/data/live-comparison.json`, which the live run's pull request
 * updates. Every page with a file listing states the date, and a listing of a file the run has not compared says that
 * only mock models verify it.
 */
export interface LiveRuns {
  /**
   * The listed files the live run has compared, as paths from the repository root: each one the list names with a
   * provider whose live transcript of it is committed. A listed file whose run left no transcript in the repository,
   * on any provider, is not compared, so its listing claims no live comparison.
   */
  readonly compared: ReadonlySet<string>;
  /** The date of the last complete live comparison, as `YYYY-MM-DD`, or null before the first one. */
  readonly lastCompared: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readJson(file: string, shownAs: string, problems: ProblemList): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.add(shownAs, `cannot read this file as JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

const PROVIDER = /^[a-z]+$/;

/**
 * Where the live run commits a listed file's transcript on one provider, as `exampleOf()` in
 * `scripts/live/config.mjs` names it: `<harness>/results/live/<provider>/<example>.json`.
 */
export function liveTranscriptPath(file: string, provider: string): string {
  return `${dirname(dirname(file))}/results/live/${provider}/${basename(file, extname(file))}.json`;
}

/** Reads the live list, its committed transcripts under `repoRoot` and the comparison date; each problem names its file. */
export function readLiveRuns(
  files: { readonly examples: string; readonly comparison: string; readonly repoRoot: string },
  names: { readonly examples: string; readonly comparison: string },
  problems: ProblemList,
): LiveRuns {
  const list = readJson(files.examples, names.examples, problems) as { examples?: unknown } | undefined;
  const compared = new Set<string>();
  if (list !== undefined && !Array.isArray(list.examples)) problems.add(names.examples, "examples must be a list");
  for (const example of Array.isArray(list?.examples) ? list.examples : []) {
    const { file, provider } = (example ?? {}) as { file?: unknown; provider?: unknown };
    if (typeof file !== "string" || file === "") {
      problems.add(names.examples, "each example needs the file it runs, as a path from the repository root");
    } else if (typeof provider !== "string" || !PROVIDER.test(provider)) {
      problems.add(names.examples, `${file} needs the provider it runs on, such as "anthropic"`);
    } else if (existsSync(join(files.repoRoot, liveTranscriptPath(file, provider)))) {
      compared.add(file);
    }
  }
  const comparison = readJson(files.comparison, names.comparison, problems) as { lastCompared?: unknown } | undefined;
  const date = comparison?.lastCompared;
  if (comparison !== undefined && date !== null && !(typeof date === "string" && DATE.test(date))) {
    problems.add(names.comparison, "lastCompared must be a YYYY-MM-DD date, or null before the first live run");
  }
  return { compared, lastCompared: typeof date === "string" && DATE.test(date) ? date : null };
}

/** A `YYYY-MM-DD` date as a reader reads it, such as "1 December 2026". */
export function readableDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const name = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return `${day} ${name} ${year}`;
}

/**
 * The line every page with a file listing shows. A page with a listing the live run compares gives the date of the
 * last comparison, or says none has run; a page whose listings the live run all leaves out says only mock models
 * verify them.
 */
export function verificationLine(lastCompared: string | null, compared: boolean): string {
  if (!compared) return "Listings on this page are verified against mock models only.";
  return lastCompared === null
    ? "Listings on this page are verified against mock models; not yet compared with live APIs."
    : `Listings on this page are verified against mock models; last compared with live APIs on ${readableDate(lastCompared)}.`;
}
