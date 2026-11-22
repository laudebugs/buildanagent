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

/** What the search tools share with the file tools, plus the environment their commands run with. */
export interface SearchDeps extends FileDeps {
  readonly env: Readonly<Record<string, string>>;
}

/** The files under `base`, or the result that ends the call: a refusal, a denial or a failed listing. */
type Listing = { readonly files: readonly string[]; readonly cut: boolean } | { readonly result: ToolResult };

async function exec(deps: SearchDeps, command: string[], timeoutMs: number, signal: AbortSignal): Promise<ExecResult> {
  return deps.sandbox.exec(command, { env: deps.env, signal, timeoutMs });
}

/** Lists the regular files under `base` inside the sandbox, skipping the folders search never enters. */
async function listFiles(deps: SearchDeps, base: string, timeoutMs: number, signal: AbortSignal): Promise<Listing> {
  const skipped = BUILTIN_TOOL_DEFAULTS.search.skippedFolders.flatMap((name, index) =>
    index === 0 ? ["-name", name] : ["-o", "-name", name],
  );
  const command = ["find", base, "(", ...skipped, ")", "-prune", "-o", "-type", "f", "-print0"];
  let result: ExecResult;
  try {
    result = await exec(deps, command, timeoutMs, signal);
  } catch (error) {
    return { result: failureResult(error) };
  }
  if ("denied" in result) return { result: deniedResult(result.denied) };
  if (result.exitCode !== 0) {
    return { result: errorResult(`Listing ${base} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`) };
  }
  const names = result.stdout.split("\u0000");
  // The last name is empty after a whole listing, and only part of a path when the output was cut.
  names.pop();
  return { files: names, cut: result.truncated === true };
}

const relativeTo = (base: string, path: string): string =>
  path === base ? (path.split("/").at(-1) ?? "") : path.slice(base.length + 1);

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
  const cut = listing.cut ? "\n[the file listing was cut, so some matches may be missing]" : "";
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

/** Runs `grep` over `files` in batches, and returns the matching lines, or the result that ends the call. */
async function grepFiles(
  deps: SearchDeps,
  input: GrepInput,
  files: readonly string[],
  signal: AbortSignal,
): Promise<{ readonly lines: string } | { readonly result: ToolResult }> {
  const { filesPerCommand } = BUILTIN_TOOL_DEFAULTS.search;
  const flags = ["-n", "-H", "-I", "-E", ...(input.ignore_case === true ? ["-i"] : []), "-e", input.pattern];
  let lines = "";
  for (let at = 0; at < files.length; at += filesPerCommand) {
    const batch = files.slice(at, at + filesPerCommand);
    let result: ExecResult;
    try {
      result = await exec(deps, ["grep", ...flags, "--", ...batch], BUILTIN_TOOL_DEFAULTS.grep.timeoutMs, signal);
    } catch (error) {
      return { result: failureResult(error) };
    }
    if ("denied" in result) return { result: deniedResult(result.denied) };
    // grep exits with 1 when nothing matched, and with 2 for an error such as a pattern it can't read.
    if (result.exitCode > 1) return { result: errorResult(`grep failed: ${result.stderr.trim()}`) };
    lines += result.stdout;
  }
  return { lines };
}

async function grep(deps: SearchDeps, input: GrepInput, signal: AbortSignal): Promise<ToolResult> {
  const checked = checkPath(deps.bounds, input.path ?? deps.bounds.root, "read");
  if ("refused" in checked) return errorResult(checked.refused);
  const listing = await listFiles(deps, checked.path, BUILTIN_TOOL_DEFAULTS.grep.timeoutMs, signal);
  if ("result" in listing) return listing.result;
  const files =
    input.glob === undefined ? listing.files : listing.files.filter(matcher(input.glob, checked.path, true));
  const found = files.length === 0 ? { lines: "" } : await grepFiles(deps, input, [...files].sort(), signal);
  if ("result" in found) return found.result;
  const cut = listing.cut ? "\n[the file listing was cut, so some files were not searched]" : "";
  if (found.lines === "") return textResult(`No line under ${checked.path} matches ${input.pattern}.${cut}`);
  return textResult(`${found.lines.trimEnd()}${cut}`);
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
