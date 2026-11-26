/**
 * Code blocks that come from tested example files. A page writes a fence such as
 * ` ```ts file="packages/sdk/examples/order-agent.ts" region="run" `, and the build replaces the fence's body with that
 * region of the file, so the docs never show code that no longer runs. A test runs every file the docs may show, so
 * only two kinds are allowed: a file under a package's `examples/` folder
 * ([examples guideline](../../../../docs/guidelines/examples.md)) and a transcript under its `transcripts/` folder. A
 * ` ```console file="packages/cli/transcripts/help.txt" ` fence shows a transcript of a terminal session, which a test of
 * that package re-runs and compares.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository's root, which every `file=` path is relative to. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** What a fence's meta string asked for. */
export interface ExampleRef {
  readonly file: string;
  readonly region?: string;
}

const EXAMPLE_FILE = "examples/[\\w./-]+\\.ts";
const TRANSCRIPT_FILE = "transcripts/[\\w-]+\\.txt";
/** A file the docs may show: an example program or a transcript, under a package's folder. */
const SHOWABLE_PATH = new RegExp(`^packages/[\\w-]+/(?:${EXAMPLE_FILE}|${TRANSCRIPT_FILE})$`);
const TRANSCRIPT_PATH = new RegExp(`^packages/[\\w-]+/${TRANSCRIPT_FILE}$`);

/** Whether `file` is a transcript of a terminal session, not an example program. */
export function isTranscript(file: string): boolean {
  return TRANSCRIPT_PATH.test(file);
}

/** The `file` and `region` of a fence's meta string, or `undefined` when it names no file. */
export function parseExampleRef(meta: string | null | undefined): ExampleRef | undefined {
  const file = /(?:^|\s)file="([^"]+)"/.exec(meta ?? "")?.[1];
  if (file === undefined) return undefined;
  const region = /(?:^|\s)region="([^"]+)"/.exec(meta ?? "")?.[1];
  return region === undefined ? { file } : { file, region };
}

/** The lines of a `// #region name` block, without the markers. */
function regionLines(lines: readonly string[], name: string, file: string): string[] {
  const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
  if (start === -1) throw new Error(`${file} has no region named ${name}`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === "// #endregion");
  if (end === -1) throw new Error(`${file}: the region ${name} is never closed`);
  // The first end marker closes the region, so a region that holds another would be cut short without a sign.
  if (lines.slice(start + 1, end).some((line) => line.trim().startsWith("// #region"))) {
    throw new Error(`${file}: the region ${name} holds another region, which the docs can't show`);
  }
  return lines.slice(start + 1, end);
}

/** Removes the markers that other readers of an example file use, and the indent every line shares. */
function tidy(lines: readonly string[]): string {
  const clean = lines
    .filter((line) => !/^\s*\/\/ #(?:end)?region\b/.test(line))
    .map((line) => line.replace(/\s*\/\/ book:note\b.*$/, ""));
  const indent = Math.min(
    ...clean.filter((line) => line.trim() !== "").map((line) => /^ */.exec(line)?.[0].length ?? 0),
  );
  return clean
    .map((line) => line.slice(indent))
    .join("\n")
    .trim();
}

/** The code `ref` names. Throws when the path is not an example or transcript file or the region is missing. */
export function exampleSource(ref: ExampleRef): string {
  if (!SHOWABLE_PATH.test(ref.file) || ref.file.split("/").includes("..")) {
    throw new Error(`${ref.file} is not a file under a package's examples/ or transcripts/ folder`);
  }
  return codeOf(readFileSync(resolve(REPO_ROOT, ref.file.split("/").join(sep)), "utf8"), ref);
}

/** The code `ref` names in `text`, the content of its file. */
export function codeOf(text: string, ref: ExampleRef): string {
  const lines = text.split("\n");
  const code = tidy(ref.region === undefined ? lines : regionLines(lines, ref.region, ref.file));
  if (code === "")
    throw new Error(`${ref.file}${ref.region === undefined ? "" : `, region ${ref.region}`} holds no code`);
  return code;
}

/**
 * A fence's meta string with its `file` and `region` attributes removed and a `title` of the file's name added, so the
 * attributes that Starlight reads, such as a line highlight or a title of the page's own, stay.
 */
export function rewriteMeta(meta: string | null | undefined, ref: ExampleRef): string {
  const rest = (meta ?? "")
    .replace(/(?:^|\s)file="[^"]*"/, " ")
    .replace(/(?:^|\s)region="[^"]*"/, " ")
    .trim();
  // A transcript is a terminal session, which a title such as `help.txt` would only mislabel.
  if (isTranscript(ref.file) || /(?:^|\s)title=/.test(rest)) return rest;
  return `${rest} title="${exampleTitle(ref)}"`.trim();
}

/** The title a fence shows: the file's name, never its path. */
export function exampleTitle(ref: ExampleRef): string {
  return basename(ref.file);
}
