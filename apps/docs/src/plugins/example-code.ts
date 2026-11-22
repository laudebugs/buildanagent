/**
 * Code blocks that come from tested example files. A page writes a fence such as
 * ` ```ts file="packages/sdk/examples/order-agent.ts" region="run" `, and the build replaces the fence's body with that
 * region of the file, so the docs never show code that no longer runs. Only files under a package's `examples/`
 * folder can be shown, because those are the files a test runs ([examples guideline](../../../../docs/guidelines/examples.md)).
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

const EXAMPLE_PATH = /^packages\/[\w-]+\/examples\/[\w./-]+\.ts$/;

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

/** The code `ref` names. Throws when the path is not an example file or the region is missing. */
export function exampleSource(ref: ExampleRef): string {
  if (!EXAMPLE_PATH.test(ref.file) || ref.file.split("/").includes("..")) {
    throw new Error(`${ref.file} is not a file under a package's examples/ folder`);
  }
  return codeOf(readFileSync(resolve(REPO_ROOT, ref.file.split("/").join(sep)), "utf8"), ref);
}

/** The code `ref` names in `text`, the content of its file. */
export function codeOf(text: string, ref: ExampleRef): string {
  const lines = text.split("\n");
  return tidy(ref.region === undefined ? lines : regionLines(lines, ref.region, ref.file));
}

/** The title a fence shows: the file's name, never its path. */
export function exampleTitle(ref: ExampleRef): string {
  return basename(ref.file);
}
