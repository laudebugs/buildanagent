/**
 * `grep` and `glob`: read-only search, run inside the sandbox with `find` and `grep`, so a pattern the model wrote is
 * matched by a sandboxed process with a timeout and never by a regular expression in the host's own loop. Both list
 * files with `find`, which never follows a symlink, and filter the list here with the permission rules' own glob
 * matcher, so `glob` and `grep`'s file filter read a pattern the same way on every backend.
 */
import { defineTool, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import { globToRegExp } from "../../permissions/match.js";
import type { ExecResult } from "../../sandbox/types.js";
import { BUILTIN_TOOL_DEFAULTS } from "./descriptions.js";
import { type FileDeps, WORKSPACE_KEY } from "./files.js";
import { checkPath } from "./paths.js";
import { deniedResult, errorResult, failureResult, textResult } from "./results.js";

type AnyTool = ToolDefinition<unknown, unknown, unknown>;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** What the search tools share with the file tools, plus the environment their commands run with. */
export interface SearchDeps extends FileDeps {
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Either the files under `base` (with a warning when `find` could not read part of the tree) or the result that ends
 * the call: a refusal, a denial or a listing that produced nothing.
 */
type Listing =
  | { readonly files: readonly string[]; readonly cut: boolean; readonly warning: string }
  | { readonly result: ToolResult };

// The most bytes of a command's standard error a warning quotes, so many unreadable files can't flood the result.
const WARNING_BYTES = 2048;

/** The line that tells the model a command failed on part of its input, quoting its first lines of standard error. */
function warningOf(what: string, result: { exitCode: number; stderr: string }): string {
  const stderr = result.stderr.trim();
  const quoted = stderr.length > WARNING_BYTES ? `${stderr.slice(0, WARNING_BYTES)}...` : stderr;
  return `\n[${what} exited with ${result.exitCode}, so some files may be missing: ${quoted}]`;
}

async function exec(
  deps: SearchDeps,
  command: string[],
  options: { readonly timeoutMs: number; readonly maxOutputBytes?: number },
  signal: AbortSignal,
): Promise<ExecResult> {
  return deps.sandbox.exec(command, { env: deps.env, signal, ...options });
}

/** `path` as a `find -path` pattern that matches only itself. */
const literalPattern = (path: string): string => path.replace(/[\\*?[\]]/g, "\\$&");

/** Lists the regular files under `base` inside the sandbox, skipping the folders search never enters. */
async function listFiles(deps: SearchDeps, base: string, timeoutMs: number, signal: AbortSignal): Promise<Listing> {
  const skipped = BUILTIN_TOOL_DEFAULTS.search.skippedFolders.flatMap((name, index) =>
    index === 0 ? ["-name", name] : ["-o", "-name", name],
  );
  // The starting point is exempt from the prune, so a search of `node_modules` itself still lists its files.
  const prune = ["(", "!", "-path", literalPattern(base), "(", ...skipped, ")", "-prune", ")"];
  const command = ["find", base, ...prune, "-o", "-type", "f", "-print0"];
  let result: ExecResult;
  try {
    result = await exec(deps, command, { timeoutMs }, signal);
  } catch (error) {
    return { result: failureResult(error) };
  }
  if ("denied" in result) return { result: deniedResult(result.denied) };
  const names = result.stdout.split("\u0000");
  // The last name is empty after a whole listing, and only part of a path when the output was cut.
  names.pop();
  // find exits with 1 when it could not read part of the tree, and still prints what it could: keep that.
  if (result.exitCode !== 0 && names.length === 0) {
    return { result: errorResult(`Listing ${base} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`) };
  }
  const warning = result.exitCode === 0 ? "" : warningOf("find", result);
  return { files: names, cut: result.truncated === true, warning };
}

// A base of "/" already ends in the separator, so the slice starts right after it.
const relativeTo = (base: string, path: string): string =>
  path === base ? (path.split("/").at(-1) ?? "") : path.slice(base === "/" ? 1 : base.length + 1);

/** A filter for the listed files: an absolute glob matches the whole path, and a relative one the path below `base`. */
function matcher(pattern: string, base: string, byName: boolean): (path: string) => boolean {
  const regex = globToRegExp(pattern);
  if (pattern.startsWith("/")) return (path) => regex.test(path);
  if (byName && !pattern.includes("/")) return (path) => regex.test(path.split("/").at(-1) ?? "");
  return (path) => regex.test(relativeTo(base, path));
}

interface GlobInput {
  readonly pattern: string;
  readonly path?: string;
}

async function globFiles(deps: SearchDeps, input: GlobInput, signal: AbortSignal): Promise<ToolResult> {
  const checked = checkPath(deps.bounds, input.path ?? deps.bounds.root, "read");
  if ("refused" in checked) return errorResult(checked.refused);
  const listing = await listFiles(deps, checked.path, BUILTIN_TOOL_DEFAULTS.glob.timeoutMs, signal);
  if ("result" in listing) return listing.result;
  const matches = matcher(input.pattern, checked.path, false);
  const found = listing.files.filter(matches).sort();
  const cut = `${listing.cut ? "\n[the file listing was cut, so some matches may be missing]" : ""}${listing.warning}`;
  if (found.length === 0) return textResult(`No file under ${checked.path} matches ${input.pattern}.${cut}`);
  return textResult(`${found.join("\n")}${cut}`, { files: found.length });
}

/** The `glob` tool. */
export function globTool(deps: SearchDeps): AnyTool {
  return defineTool<GlobInput>({
    name: "glob",
    description: BUILTIN_TOOL_DEFAULTS.glob.description,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: "The glob to match, such as `**/*.ts`." },
        path: { type: "string", description: "The folder to search, relative to the workspace root or absolute." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    firstParty: true,
    annotations: { readOnlyHint: true },
    resourceKey: () => WORKSPACE_KEY,
    execute: (input, ctx) => globFiles(deps, input, ctx.signal),
  }) as AnyTool;
}

interface GrepInput {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly ignore_case?: boolean;
}

/**
 * What the grep commands found: the matching lines, the notices that say what they may have missed, and, when matches
 * were found but none fits whole, where the first one is.
 */
interface Found {
  readonly lines: string;
  readonly notes: string;
  readonly tooLong?: { readonly path?: string; readonly line?: number };
}

/**
 * Where grep's first match in `stdout` is: the file of `batch` that the output starts with, and its line number. grep
 * prints `path:line:text`, and a path may itself hold a colon, so the path is matched against the files searched.
 */
function firstMatch(stdout: string, batch: readonly string[]): { path?: string; line?: number } {
  const path = batch.find((file) => stdout.startsWith(`${file}:`));
  if (path === undefined) return {};
  const line = /^(\d+):/.exec(stdout.slice(path.length + 1))?.[1];
  return line === undefined ? { path } : { path, line: Number(line) };
}

/** The longest start of `text` that ends a line and fits in `bytes` UTF-8 bytes. */
function wholeLines(text: string, bytes: number): string {
  const encoded = ENCODER.encode(text);
  if (encoded.length <= bytes) return text.endsWith("\n") ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  const end = encoded.subarray(0, bytes).lastIndexOf(10);
  return DECODER.decode(encoded.subarray(0, end + 1));
}

/** Runs one `grep` command over `batch`, and returns what it did, or the result that ends the call. */
async function grepBatch(
  deps: SearchDeps,
  flags: readonly string[],
  batch: readonly string[],
  signal: AbortSignal,
): Promise<Extract<ExecResult, { exitCode: number }> | { readonly result: ToolResult }> {
  const { timeoutMs, maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.grep;
  let result: ExecResult;
  try {
    result = await exec(deps, ["grep", ...flags, "--", ...batch], { timeoutMs, maxOutputBytes }, signal);
  } catch (error) {
    return { result: failureResult(error) };
  }
  return "denied" in result ? { result: deniedResult(result.denied) } : result;
}

const CUT_NOTICE =
  `\n[the matches passed ${BUILTIN_TOOL_DEFAULTS.grep.maxOutputBytes} bytes, so the rest were dropped and some files ` +
  "were not searched; narrow the pattern, path or glob to see them]";

/**
 * Runs `grep` over `files` in batches, and returns the matching lines, or the result that ends the call. The lines stop
 * at the tool's output cap, across all the batches, and a batch with a file grep could not read keeps its matches and
 * adds a warning. The call fails only when no batch matched and one failed, as an unreadable pattern makes every one.
 */
async function grepFiles(
  deps: SearchDeps,
  input: GrepInput,
  files: readonly string[],
  signal: AbortSignal,
): Promise<Found | { readonly result: ToolResult }> {
  const { filesPerCommand } = BUILTIN_TOOL_DEFAULTS.search;
  const { maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.grep;
  const flags = ["-n", "-H", "-I", "-E", ...(input.ignore_case === true ? ["-i"] : []), "-e", input.pattern];
  let lines = "";
  let size = 0;
  let failed: Extract<ExecResult, { exitCode: number }> | undefined;
  const warning = () => (failed === undefined ? "" : warningOf("grep", failed));
  for (let at = 0; at < files.length; at += filesPerCommand) {
    const batch = files.slice(at, at + filesPerCommand);
    const result = await grepBatch(deps, flags, batch, signal);
    if ("result" in result) return result;
    // grep exits with 1 when nothing matched, and with 2 for an error, such as a file it can't read or a bad pattern.
    if (result.exitCode > 1) failed ??= result;
    // A cut stream ends part way through a line, so only its whole lines are kept.
    const kept = wholeLines(result.stdout, maxOutputBytes - size);
    lines += kept;
    size += ENCODER.encode(kept).length;
    if (result.truncated === true || kept.length < result.stdout.length) {
      // A match whose line alone passes the cap leaves no whole line to show, but it is still a match: say so, so the
      // model never reads that the pattern matched nothing.
      const tooLong = lines === "" && result.stdout !== "" ? { tooLong: firstMatch(result.stdout, batch) } : {};
      return { lines, notes: `${CUT_NOTICE}${warning()}`, ...tooLong };
    }
  }
  if (failed !== undefined && lines === "") return { result: errorResult(`grep failed: ${failed.stderr.trim()}`) };
  return { lines, notes: warning() };
}

/** The sentence for matches whose lines are each too long to show: they exist, where the first is, and what to do. */
function tooLongSentence(base: string, pattern: string, first: { path?: string; line?: number }): string {
  const { maxOutputBytes } = BUILTIN_TOOL_DEFAULTS.grep;
  const where =
    first.path === undefined
      ? ""
      : ` The first is in ${first.path}${first.line === undefined ? "" : `, on line ${first.line}`}.`;
  return (
    `Lines under ${base} match ${pattern}, but the first matching line is longer than ${maxOutputBytes} bytes, so ` +
    `none can be shown.${where} Narrow the pattern, path or glob, or read the matching file with read, in parts.`
  );
}

async function grep(deps: SearchDeps, input: GrepInput, signal: AbortSignal): Promise<ToolResult> {
  const checked = checkPath(deps.bounds, input.path ?? deps.bounds.root, "read");
  if ("refused" in checked) return errorResult(checked.refused);
  const listing = await listFiles(deps, checked.path, BUILTIN_TOOL_DEFAULTS.grep.timeoutMs, signal);
  if ("result" in listing) return listing.result;
  const files =
    input.glob === undefined ? listing.files : listing.files.filter(matcher(input.glob, checked.path, true));
  const found = files.length === 0 ? { lines: "", notes: "" } : await grepFiles(deps, input, [...files].sort(), signal);
  if ("result" in found) return found.result;
  const cut = listing.cut ? "\n[the file listing was cut, so some files were not searched]" : "";
  const notes = `${found.notes}${cut}${listing.warning}`;
  if (found.tooLong !== undefined)
    return textResult(`${tooLongSentence(checked.path, input.pattern, found.tooLong)}${notes}`);
  if (found.lines === "") return textResult(`No line under ${checked.path} matches ${input.pattern}.${notes}`);
  return textResult(`${found.lines.trimEnd()}${notes}`);
}

/** The `grep` tool. */
export function grepTool(deps: SearchDeps): AnyTool {
  return defineTool<GrepInput>({
    name: "grep",
    description: BUILTIN_TOOL_DEFAULTS.grep.description,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: "The extended regular expression to find." },
        path: { type: "string", description: "The file or folder to search. Default the workspace root." },
        glob: { type: "string", description: "Only files that match this glob, such as `*.ts`." },
        ignore_case: { type: "boolean", description: "Match without regard to case." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    firstParty: true,
    annotations: { readOnlyHint: true },
    resourceKey: () => WORKSPACE_KEY,
    execute: (input, ctx) => grep(deps, input, ctx.signal),
  }) as AnyTool;
}
