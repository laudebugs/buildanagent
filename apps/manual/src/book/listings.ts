import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { type HarnessTable, pinOf, readHarnesses } from "./harnesses.js";
import type { ProblemList } from "./problems.js";
import { cutRegion, type SourceLine } from "./regions.js";
import { readTranscript, type Transcript } from "./transcripts.js";
import { isInside, readWorkspace, TypecheckCoverage } from "./typecheck-coverage.js";

/** A `::listing` resolved against the repository: the lines it shows and what its caption says. */
export interface ListingSource {
  /** The listed file's path from the repository root, with forward slashes. */
  readonly path: string;
  readonly region: string | undefined;
  readonly lines: readonly SourceLine[];
  /** The harness directory the file belongs to, such as `verify/vercel-ai-sdk`. */
  readonly harness: string;
  /** The harness's main package at its pinned version, such as `ai@7.0.162`. */
  readonly pin: string;
  /** The Shiki language the file is highlighted as. */
  readonly lang: "typescript" | "tsx";
  /** For a listing with `replay`, the recorded run of its example and that file's path from the repository root. */
  readonly replay?: { readonly transcript: Transcript; readonly path: string };
}

/** The attributes a `::listing` directive takes; `replay` takes no value. */
export const LISTING_ATTRIBUTES = ["id", "file", "region", "replay"] as const;

/** Everything resolving a listing needs: the repository, the harness table and the typecheck coverage. */
export interface ListingContext {
  readonly repoRoot: string;
  readonly harnesses: HarnessTable;
  readonly coverage: TypecheckCoverage;
}

/** The TypeScript source extensions, which TypeScript checks without `allowJs`, and the Shiki language for each. */
const LANGUAGES: Readonly<Record<string, ListingSource["lang"]>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
};

/** Reads the harness table and the workspace once per book load; problems name the harness table's file. */
export function listingContext(
  repoRoot: string,
  harnessesFile: string,
  harnessesName: string,
  problems: ProblemList,
): ListingContext {
  return {
    repoRoot,
    harnesses: readHarnesses(harnessesFile, harnessesName, problems),
    coverage: new TypecheckCoverage(repoRoot, readWorkspace(repoRoot)),
  };
}

const toPosix = (path: string): string => path.split(sep).join("/");

/**
 * The listed file's absolute path, or why the directive's `file` cannot name a file to list: it must be a plain path
 * from the repository root, with no `./`, `..`, `//` or trailing `/`, and the file it names must be a file inside the
 * repository after following symbolic links.
 */
function confined(file: string, repoRoot: string): { readonly absolute: string; readonly path: string } | string {
  const absolute = join(repoRoot, file);
  const path = toPosix(relative(repoRoot, absolute));
  if (isAbsolute(file) || path.startsWith("../") || path !== file) {
    return `::listing file="${file}" must be a path from the repository root, without ./, .., // or a leading /`;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return `${path} is not a file`;
  if (!isInside(realpathSync(absolute), realpathSync(repoRoot))) {
    return `${path} resolves through a symbolic link to a file outside the repository`;
  }
  return { absolute, path };
}

/**
 * Resolves a `::listing{#id file="…" region="…"}` against the repository: the file must be inside it, be TypeScript
 * that a workspace package's `typecheck` covers, belong to a harness with a pinned main package, and hold the region;
 * with `replay`, its harness must hold a transcript of the file recorded at the current pin. Returns the listing, or
 * the message of the first rule it breaks.
 */
export function resolveListing(
  attributes: Readonly<Record<string, string | null | undefined>>,
  context: ListingContext,
): ListingSource | { readonly message: string } {
  const unknown = Object.keys(attributes).filter((key) => !(LISTING_ATTRIBUTES as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return {
      message: `::listing does not take ${unknown.map((key) => `"${key}"`).join(", ")}; it takes id, file, region and replay`,
    };
  }
  const { file, region, replay } = attributes;
  if (replay !== undefined && replay !== "" && replay !== null) {
    return { message: `replay takes no value; write {… replay}, not replay="${replay}"` };
  }
  if (!file) return { message: '::listing needs the file it shows, written file="verify/<sdk>/examples/<name>.ts"' };
  const found = confined(file, context.repoRoot);
  if (typeof found === "string") return { message: found };
  const { absolute, path } = found;
  const lang = LANGUAGES[extname(path)];
  if (lang === undefined) return { message: `${path} is not TypeScript, so no typecheck checks it` };
  const unchecked = context.coverage.uncovered(absolute);
  if (unchecked !== undefined) return { message: unchecked };
  const pinned = pinOf(path, context.harnesses, context.repoRoot);
  if ("message" in pinned) return pinned;
  const lines = cutRegion(readFileSync(absolute, "utf8"), region ?? undefined);
  if ("message" in lines) {
    const where = lines.line === undefined ? `${path} ` : `${path}:${lines.line}: `;
    return { message: `${where}${lines.message}` };
  }
  const listing = { path, region: region ?? undefined, lines, ...pinned, lang };
  if (replay === undefined) return listing;
  const recorded = readTranscript(context.repoRoot, listing);
  if ("message" in recorded) return recorded;
  return { ...listing, replay: { transcript: recorded.transcript, path: recorded.transcriptPath } };
}
