import { readFileSync } from "node:fs";
import type { ProblemList } from "./problems.js";

/**
 * What the book knows about the occasional live run (book plan BK18): which listed files it runs against real APIs,
 * from `src/data/live-examples.json`, and the date of its last complete comparison, from
 * `src/data/live-comparison.json`, which the live run's pull request updates. Every page with a file listing states
 * the date, and a listing of a file the run leaves out says that only mock models verify it.
 */
export interface LiveRuns {
  /** The listed files the live run compares, as paths from the repository root. */
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

/** Reads the live list and the comparison date; each problem names its file. */
export function readLiveRuns(
  files: { readonly examples: string; readonly comparison: string },
  names: { readonly examples: string; readonly comparison: string },
  problems: ProblemList,
): LiveRuns {
  const list = readJson(files.examples, names.examples, problems) as { examples?: unknown } | undefined;
  const compared = new Set<string>();
  if (list !== undefined && !Array.isArray(list.examples)) problems.add(names.examples, "examples must be a list");
  for (const example of Array.isArray(list?.examples) ? list.examples : []) {
    const file = (example as { file?: unknown } | null)?.file;
    if (typeof file === "string" && file !== "") compared.add(file);
    else problems.add(names.examples, "each example needs the file it runs, as a path from the repository root");
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
