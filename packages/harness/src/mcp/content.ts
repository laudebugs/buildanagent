/**
 * What the harness takes from a server's replies: a tool list it checks before any tool is registered, and tool
 * results mapped to the text and image blocks the model reads. Everything here reads untrusted data, so every field is
 * checked for its type and size, and anything unexpected becomes a refusal or a short note, never a crash.
 */
import type { ModelContent } from "@buildanagent/gateway";
import { McpError } from "./errors.js";
import type { McpCallResult, McpTool } from "./types.js";

const MAX_NAME_CHARS = 128;
const MAX_DESCRIPTION_CHARS = 4096;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_ERROR_CHARS = 500;
const IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// The control characters of ASCII and Latin-1, which a name shown in a log or a prompt should never carry.
const isControl = (code: number): boolean => code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const hasControl = (text: string): boolean => [...text].some((char) => isControl(char.codePointAt(0) ?? 0));
const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `text` cut to at most `max` UTF-16 units, with `…` after it when it was cut. It never splits a surrogate pair, since a
 * lone half would make the canonical JSON that the record hashes refuse the text, and the server's whole list with it.
 */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, end)}…`;
}

/** A server's text cut to `max` characters, with its control characters replaced, for an error message. */
export function shortText(text: string, max = MAX_ERROR_CHARS): string {
  const plain = [...text].map((char) => (isControl(char.codePointAt(0) ?? 0) ? " " : char)).join("");
  return cut(plain, max);
}

function refuse(server: string, why: string): McpError {
  return new McpError(
    "mcp_tool_list_refused",
    server,
    `its tool list was refused, so none of its tools was registered: ${why}`,
  );
}

/** One listed tool, checked, or the reason it can't be used. */
function checkTool(server: string, tool: unknown, index: number): McpTool {
  if (!isRecord(tool)) throw refuse(server, `tool ${index} is not an object`);
  const { name, description, inputSchema, annotations } = tool;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_CHARS || hasControl(name)) {
    throw refuse(server, `tool ${index} has no name of 1 to ${MAX_NAME_CHARS} characters without control characters`);
  }
  if (!isRecord(inputSchema) || inputSchema.type !== "object") {
    throw refuse(server, `the tool ${JSON.stringify(name)} has an input schema that is not an object schema`);
  }
  let schemaBytes: number;
  try {
    schemaBytes = encoder.encode(JSON.stringify(inputSchema)).length;
  } catch {
    throw refuse(server, `the tool ${JSON.stringify(name)} has an input schema that is not JSON`);
  }
  if (schemaBytes > MAX_SCHEMA_BYTES) {
    throw refuse(server, `the tool ${JSON.stringify(name)} has an input schema over ${MAX_SCHEMA_BYTES} bytes`);
  }
  const text = typeof description === "string" ? description : "";
  return {
    name,
    description: cut(text, MAX_DESCRIPTION_CHARS),
    inputSchema,
    ...(isRecord(annotations) ? { annotations } : {}),
  };
}

/**
 * The server's tool list, checked as a whole: it is refused when it is longer than `maxTools`, when any tool fails its
 * check, or when two names match once normalised (NFKC, then lower case), since they would read as one tool to a
 * person approving a call.
 */
export function checkToolList(server: string, tools: unknown, maxTools: number): McpTool[] {
  if (!Array.isArray(tools)) throw refuse(server, "it did not send a list of tools");
  if (tools.length > maxTools) throw refuse(server, `it listed ${tools.length} tools, over the limit of ${maxTools}`);
  const seen = new Map<string, string>();
  return tools.map((tool, index) => {
    const checked = checkTool(server, tool, index);
    const key = checked.name.normalize("NFKC").toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      throw refuse(server, `the names ${JSON.stringify(earlier)} and ${JSON.stringify(checked.name)} name one tool`);
    }
    seen.set(key, checked.name);
    return checked;
  });
}

// Keywords whose value is one subschema, a list of them, or a map of names to them. Everything else in a schema is
// data, such as `enum` or `default`, and is copied as it is.
const ONE_SCHEMA = new Set([
  "additionalProperties",
  "items",
  "additionalItems",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "not",
  "if",
  "then",
  "else",
]);
const SCHEMA_LIST = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_MAP = new Set(["properties", "dependentSchemas", "$defs", "definitions"]);
// Keywords that make the validator run a regular expression the server wrote, or a format check, on the model's input.
const REGEX_KEYWORDS = new Set(["pattern", "patternProperties", "format"]);
const MAX_SCHEMA_DEPTH = 64;

/**
 * The server's input schema with every keyword removed that runs a regular expression on the model's input: `pattern`,
 * `patternProperties` and `format`. The SDK checks a call's input against the schema before the permission gate, and a
 * pattern such as `^(a+)+$` runs on a backtracking engine, so a server could freeze the harness with a schema alone. The
 * server still checks its own input, and the model still reads the description. A schema nested deeper than 64 levels
 * is refused, since no real tool needs one and walking it could exhaust the stack.
 */
export function safeSchema(schema: unknown, depth = 0): unknown {
  if (depth > MAX_SCHEMA_DEPTH) throw new Error(`the input schema is nested deeper than ${MAX_SCHEMA_DEPTH} levels`);
  if (!isRecord(schema)) return schema;
  // Built from entries, so a key such as `__proto__` stays a plain property and never sets a prototype.
  const entries = Object.entries(schema)
    .filter(([key]) => !REGEX_KEYWORDS.has(key))
    .map(([key, value]): [string, unknown] => [key, subschemas(key, value, depth + 1)]);
  return Object.fromEntries(entries);
}

/** One keyword's value with its subschemas made safe, by the shape the keyword has. */
function subschemas(key: string, value: unknown, depth: number): unknown {
  const each = (map: Record<string, unknown>, visit: (item: unknown) => unknown) =>
    Object.fromEntries(Object.entries(map).map(([name, item]) => [name, visit(item)]));
  // Draft 7's `items` may be a list of schemas, one per position.
  if ((ONE_SCHEMA.has(key) || SCHEMA_LIST.has(key)) && Array.isArray(value)) {
    return value.map((item) => safeSchema(item, depth));
  }
  if (ONE_SCHEMA.has(key)) return safeSchema(value, depth);
  if (SCHEMA_MAP.has(key) && isRecord(value)) return each(value, (item) => safeSchema(item, depth));
  // Draft 7: each value is a schema or a list of property names.
  if (key === "dependencies" && isRecord(value)) {
    return each(value, (item) => (Array.isArray(item) ? item : safeSchema(item, depth)));
  }
  return value;
}

/** One content block of a result, as the model reads it. A kind the model can't read becomes a short note. */
function blockOf(block: unknown): ModelContent {
  if (!isRecord(block)) return { type: "text", text: "[a content block that is not an object was left out]" };
  const { type } = block;
  if (type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
  if (type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
    if (IMAGE_TYPES.includes(block.mimeType)) return { type: "image", mediaType: block.mimeType, data: block.data };
    return { type: "text", text: `[an image of type ${shortText(block.mimeType, 64)} was left out]` };
  }
  if (type === "resource" && isRecord(block.resource) && typeof block.resource.text === "string") {
    return { type: "text", text: block.resource.text };
  }
  if (type === "resource_link" && typeof block.uri === "string") {
    return { type: "text", text: `[a link to the resource ${shortText(block.uri, 256)}]` };
  }
  const kind = typeof type === "string" ? shortText(type, 64) : "unknown";
  return { type: "text", text: `[a ${kind} content block was left out]` };
}

/**
 * A `tools/call` result as the model reads it. Structured content stands in, as JSON, only when there is no content,
 * so a result is never empty by accident.
 */
export function resultOf(result: unknown): McpCallResult {
  const record = isRecord(result) ? result : {};
  const blocks = Array.isArray(record.content) ? record.content.map(blockOf) : [];
  if (blocks.length === 0 && record.structuredContent !== undefined) {
    let text: string;
    try {
      text = JSON.stringify(record.structuredContent) ?? "";
    } catch {
      text = "[structured content that is not JSON was left out]";
    }
    blocks.push({ type: "text", text });
  }
  return { content: blocks, isError: record.isError === true };
}
