/**
 * `read`, `write` and `edit`: the file tools. Each checks its path against the policy's roots before it calls the
 * sandbox, and reads and writes only through `Sandbox.readFile()` and `Sandbox.writeFile()`. `read` keeps the input
 * names `path`, `file_path`, `offset` and `limit`, which the skill loader matches when it records a skill as loaded.
 */
import { defineTool, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import { escapedBytes } from "../../context/write-cap.js";
import { normalizePath } from "../../permissions/match.js";
import type { Sandbox } from "../../sandbox/types.js";
import { BUILTIN_TOOL_DEFAULTS } from "./descriptions.js";
import { type Bounds, checkPath, pathInput, unusablePath } from "./paths.js";
import { errorResult, failureResult, textResult } from "./results.js";

/** What the file and search tools share: the sandbox, the bounds its policy sets, and the session's spill reader. */
export interface FileDeps {
  readonly sandbox: Sandbox;
  readonly bounds: Bounds;
  readonly spills?: (path: string) => string | undefined | Promise<string | undefined>;
}

type AnyTool = ToolDefinition<unknown, unknown, unknown>;

/**
 * Every file and search tool returns this key, so the step scheduler treats the workspace as one resource: reads run
 * together and wait for the writes the model sent before them, and a write waits for the reads before it.
 */
export const WORKSPACE_KEY = "workspace";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
// `edit` writes the whole file back, so it reads it strictly: a byte that is not UTF-8 refuses the edit instead of
// becoming U+FFFD, and a byte order mark stays in the text, so it is written back too.
const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
// A NUL byte in the first part of a file marks it as binary, as grep and git decide.
const BINARY_PROBE_BYTES = 8000;

const PATH_PROPERTIES = {
  path: { type: "string", description: "The file, relative to the workspace root or absolute." },
  file_path: { type: "string", description: "The same as `path`, under the name some models use." },
} as const;

interface ReadInput {
  readonly path?: string;
  readonly file_path?: string;
  readonly offset?: number;
  readonly column?: number;
  readonly limit?: number;
}

/**
 * The longest start of `text` whose JSON-escaped form fits in `bytes`, without splitting a character, and never less
 * than one character. Every character takes at least one byte, so the start is at most `bytes` characters long, and a
 * binary search over that range finds it in a few measures.
 */
function headOf(text: string, bytes: number): string {
  let low = 0;
  let high = Math.min(text.length, bytes);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (escapedBytes(text.slice(0, middle)) <= bytes) low = middle;
    else high = middle - 1;
  }
  // A start that ends on the first half of a surrogate pair would split its character.
  const code = text.charCodeAt(low - 1);
  const end = low > 0 && code >= 0xd800 && code <= 0xdbff ? low - 1 : low;
  return end === 0 ? String.fromCodePoint(text.codePointAt(0) ?? 0) : text.slice(0, end);
}

/** Where a page starts and how far it may go: 0-based line indexes, and the column of the first line to start at. */
interface Span {
  readonly start: number;
  readonly column: number;
  readonly last: number;
}

// A page is measured as the write cap measures a result: by its bytes inside the log's JSON string. A quote, a
// backslash or a newline takes two bytes there and a control character six, so a page budgeted by raw bytes could pass
// the cap, be cut and spilled again, and a spill read that way would never show its whole text.
const NEWLINE_BYTES = escapedBytes("\n");

/**
 * The lines of `span`, at most `maxBytes` of them once JSON-escaped, with a line that says where to read on when some
 * are left. A first line longer than a page is shown in part, with the column the next part starts at.
 */
function pageOf(lines: readonly string[], path: string, span: Span): ToolResult {
  const { start, column, last } = span;
  const total = lines.length;
  const from = column > 0 ? { column: column + 1 } : {};
  let shown = "";
  let budget = BUILTIN_TOOL_DEFAULTS.read.maxBytes;
  let line = start;
  for (; line < last; line += 1) {
    const piece = line === start ? (lines[line] ?? "").slice(column) : (lines[line] ?? "");
    const size = escapedBytes(piece) + NEWLINE_BYTES;
    if (size > budget && line > start) break;
    if (size > budget) {
      const part = headOf(piece, budget - NEWLINE_BYTES);
      const more = `[line ${line + 1} of ${total} goes on; read on with offset ${line + 1} and column ${column + part.length + 1}]`;
      return textResult(`${part}\n${more}`, { path, from: line + 1, to: line + 1, ...from, lines: total });
    }
    shown += `${piece}\n`;
    budget -= size;
  }
  const more = line < total ? `[lines ${start + 1} to ${line} of ${total}; read on with offset ${line + 1}]` : "";
  return textResult(`${shown}${more}`, { path, from: start + 1, to: line, ...from, lines: total });
}

/**
 * The part of `text` that `offset`, `column` and `limit` select, at most `maxBytes` of it once JSON-escaped. A line
 * longer than a page is shown in parts, each naming the column the next starts at, so every byte of a long result can
 * be read, even one that is a single line.
 */
function page(text: string, path: string, input: ReadInput): ToolResult {
  const { defaultLimit, maxBytes } = BUILTIN_TOOL_DEFAULTS.read;
  if (text === "") return textResult(`(${path} is empty)`, { path, lines: 0 });
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const total = lines.length;
  const unpaged = input.offset === undefined && input.limit === undefined && input.column === undefined;
  if (unpaged && total <= defaultLimit && escapedBytes(text) <= maxBytes)
    return textResult(text, { path, lines: total });
  const start = (input.offset ?? 1) - 1;
  if (start >= total)
    return errorResult(`The offset ${start + 1} is past the end of ${path}, which has ${total} lines.`);
  const column = (input.column ?? 1) - 1;
  if (column > 0 && column >= (lines[start] ?? "").length) {
    return errorResult(`The column ${column + 1} is past the end of line ${start + 1} of ${path}, which is shorter.`);
  }
  return pageOf(lines, path, { start, column, last: Math.min(total, start + (input.limit ?? defaultLimit)) });
}

async function readFile(deps: FileDeps, input: ReadInput): Promise<ToolResult> {
  const chosen = pathInput(input);
  if (typeof chosen !== "string") return errorResult(chosen.refused);
  const unusable = unusablePath(chosen);
  if (unusable !== undefined) return errorResult(unusable);
  // A spill file is the harness's own copy of an earlier result, outside the sandbox, and the cap names it by an
  // absolute path. Only such a path asks the spill reader, so a relative path always means a workspace file, never a
  // spill that happens to share its name.
  if (deps.spills !== undefined && chosen.startsWith("/")) {
    const spillPath = normalizePath(chosen);
    const spilled = await deps.spills(spillPath);
    if (spilled !== undefined) return page(spilled, spillPath, input);
  }
  const checked = checkPath(deps.bounds, chosen, "read");
  if ("refused" in checked) return errorResult(checked.refused);
  let bytes: Uint8Array;
  try {
    bytes = await deps.sandbox.readFile(checked.path);
  } catch (error) {
    return failureResult(error);
  }
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
    return errorResult(`${checked.path} is a binary file of ${bytes.length} bytes, and read returns only text.`);
  }
  return page(DECODER.decode(bytes), checked.path, input);
}

/** The `read` tool. */
export function readTool(deps: FileDeps): AnyTool {
  return defineTool<ReadInput>({
    name: "read",
    description: BUILTIN_TOOL_DEFAULTS.read.description,
    inputSchema: {
      type: "object",
      properties: {
        ...PATH_PROPERTIES,
        offset: { type: "integer", minimum: 1, description: "The first line to read, counting from 1." },
        column: {
          type: "integer",
          minimum: 1,
          description: "Where to start in the first line, counting from 1, to read on in a line too long for one page.",
        },
        limit: { type: "integer", minimum: 1, description: "How many lines to read." },
      },
      additionalProperties: false,
    },
    firstParty: true,
    annotations: { readOnlyHint: true },
    resourceKey: () => WORKSPACE_KEY,
    execute: (input) => readFile(deps, input),
  }) as AnyTool;
}

interface WriteInput {
  readonly path?: string;
  readonly file_path?: string;
  readonly content: string;
}

/** The `write` tool. */
export function writeTool(deps: FileDeps): AnyTool {
  return defineTool<WriteInput>({
    name: "write",
    description: BUILTIN_TOOL_DEFAULTS.write.description,
    inputSchema: {
      type: "object",
      properties: { ...PATH_PROPERTIES, content: { type: "string", description: "The file's whole new text." } },
      required: ["content"],
      additionalProperties: false,
    },
    firstParty: true,
    effect: { kind: "write" },
    resourceKey: () => WORKSPACE_KEY,
    async execute(input) {
      const chosen = pathInput(input);
      if (typeof chosen !== "string") return errorResult(chosen.refused);
      const checked = checkPath(deps.bounds, chosen, "write");
      if ("refused" in checked) return errorResult(checked.refused);
      const bytes = ENCODER.encode(input.content);
      try {
        await deps.sandbox.writeFile(checked.path, bytes);
      } catch (error) {
        return failureResult(error);
      }
      return textResult(`Wrote ${bytes.length} bytes to ${checked.path}.`, { path: checked.path, bytes: bytes.length });
    },
  }) as AnyTool;
}

interface EditInput {
  readonly path?: string;
  readonly file_path?: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

/** How many times `needle` occurs in `text`, counting matches that don't overlap. */
function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/** The edited text, or the sentence that says why the edit can't be made and nothing was changed. */
function edited(text: string, input: EditInput, path: string): string | { refused: string } {
  if (input.old_string === "") return { refused: "`old_string` is empty; use write to create or replace a file." };
  if (input.old_string === input.new_string) return { refused: "`old_string` and `new_string` are the same." };
  const count = occurrences(text, input.old_string);
  if (count === 0) return { refused: `\`old_string\` does not occur in ${path}, so nothing was changed.` };
  if (count > 1 && input.replace_all !== true) {
    return {
      refused:
        `\`old_string\` occurs ${count} times in ${path}, so nothing was changed. Add surrounding lines until it ` +
        "is unique, or set `replace_all` to replace every match.",
    };
  }
  // A function replacement keeps `$&` and the other replacement patterns in `new_string` as written.
  return input.replace_all === true
    ? text.replaceAll(input.old_string, () => input.new_string)
    : text.replace(input.old_string, () => input.new_string);
}

async function editFile(deps: FileDeps, input: EditInput): Promise<ToolResult> {
  const chosen = pathInput(input);
  if (typeof chosen !== "string") return errorResult(chosen.refused);
  const checked = checkPath(deps.bounds, chosen, "write");
  if ("refused" in checked) return errorResult(checked.refused);
  try {
    const bytes = await deps.sandbox.readFile(checked.path);
    if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
      return errorResult(`${checked.path} is a binary file, and edit changes only text, so nothing was changed.`);
    }
    let text: string;
    try {
      text = STRICT_DECODER.decode(bytes);
    } catch {
      return errorResult(
        `${checked.path} is not UTF-8 text, and edit would corrupt it, so nothing was changed. Use bash to change it.`,
      );
    }
    const next = edited(text, input, checked.path);
    if (typeof next !== "string") return errorResult(next.refused);
    await deps.sandbox.writeFile(checked.path, ENCODER.encode(next));
    const count = input.replace_all === true ? occurrences(text, input.old_string) : 1;
    return textResult(`Replaced ${count} match${count === 1 ? "" : "es"} in ${checked.path}.`, {
      path: checked.path,
      replaced: count,
    });
  } catch (error) {
    return failureResult(error);
  }
}

/** The `edit` tool. */
export function editTool(deps: FileDeps): AnyTool {
  return defineTool<EditInput>({
    name: "edit",
    description: BUILTIN_TOOL_DEFAULTS.edit.description,
    inputSchema: {
      type: "object",
      properties: {
        ...PATH_PROPERTIES,
        old_string: { type: "string", description: "The exact text to replace." },
        new_string: { type: "string", description: "The text to put in its place." },
        replace_all: { type: "boolean", description: "Replace every match instead of requiring exactly one." },
      },
      required: ["old_string", "new_string"],
      additionalProperties: false,
    },
    firstParty: true,
    effect: { kind: "write" },
    resourceKey: () => WORKSPACE_KEY,
    execute: (input) => editFile(deps, input),
  }) as AnyTool;
}
