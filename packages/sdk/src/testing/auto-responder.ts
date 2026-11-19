/**
 * `autoResponder()`: a responder step that acts like a cooperative model without a script, so a test can drive any
 * agent offline (agent-SDK guide §8). It calls one tool with arguments built from the tool's JSON Schema, then answers
 * in text. It never calls a host tool: a deny list matched by name keeps shell, file-writing and delete tools out,
 * because a verification run once let OpenAI's `exec_command` through a filter that checked only the tool's kind.
 */
import type { ContentBlock, Message, WireTool } from "@buildanagent/gateway";
import type { AssistantScript, RecordedRequest, ScriptStep } from "./scripted-model.js";

/**
 * The tool names `autoResponder()` never calls, whatever options it gets: tools that run commands on the host or
 * change its files.
 */
export const DEFAULT_DENIED_TOOLS = Object.freeze([
  "bash",
  "exec_command",
  "shell",
  "write",
  "edit",
  "delete",
] as const);

/** What `autoResponder()` takes. */
export interface AutoResponderOptions {
  /**
   * More tools never to call, added to `DEFAULT_DENIED_TOOLS`: a string matches a tool's whole name, ignoring case,
   * and a regular expression is tested against the name.
   */
  readonly denyTools?: readonly (string | RegExp)[];
  /** The final answer's text. Default `"Auto responder: done."`. */
  readonly answer?: string;
}

const MAX_DEPTH = 6;

function firstType(schema: Record<string, unknown>): unknown {
  const { type } = schema;
  return Array.isArray(type) ? type.find((item) => item !== "null") : type;
}

function synthesizeObject(schema: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return out;
  for (const [key, value] of Object.entries(properties)) out[key] = synthesize(value, depth + 1);
  return out;
}

function synthesizeTyped(schema: Record<string, unknown>, depth: number): unknown {
  switch (firstType(schema)) {
    case "string":
      return schema.format === "email" ? "user@example.com" : "example";
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array":
      return [synthesize(schema.items ?? {}, depth + 1)];
    default:
      return synthesizeObject(schema, depth);
  }
}

function synthesize(schema: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || typeof schema !== "object" || schema === null) return null;
  const s = schema as Record<string, unknown>;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.default !== undefined) return s.default;
  const options = s.anyOf ?? s.oneOf;
  if (Array.isArray(options)) return synthesize(options[0], depth + 1);
  return synthesizeTyped(s, depth);
}

/**
 * Builds a value that fits a JSON Schema, the way a cooperative model fills in a tool's arguments: `const`, then the
 * first `enum` value, then `default`, then the first `anyOf` or `oneOf` branch, then a value of the first non-null
 * `type` (`"example"` for a string, the `minimum` or 1 for a number, `false`, a one-item array, or an object with
 * every listed property). Nesting past six levels gives `null`. It reads no `$ref`, `pattern` or length bound.
 */
export function synthesizeInput(schema: Readonly<Record<string, unknown>>): unknown {
  return synthesize(schema, 0);
}

function isDenied(name: string, deny: readonly (string | RegExp)[]): boolean {
  const lower = name.toLowerCase();
  return deny.some((rule) => (typeof rule === "string" ? rule.toLowerCase() === lower : rule.test(name)));
}

function toolCallsOf(messages: readonly Message[]): ContentBlock[] {
  return messages.flatMap((message) =>
    message.role === "assistant" ? message.content.filter((block) => block.type === "tool_call") : [],
  );
}

function userText(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => (message.role === "user" ? message.content : []))
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/** The tool to call: one the user's text names, else the first allowed one. */
function pickTool(tools: readonly WireTool[], messages: readonly Message[]): WireTool | undefined {
  const text = userText(messages);
  return tools.find((tool) => text.includes(tool.name)) ?? tools[0];
}

/**
 * A responder step that acts like a cooperative model. On a request whose conversation has no tool call yet, it
 * calls one offered tool that isn't denied (one whose name the user's text mentions, else the first), with input
 * from `synthesizeInput()`; on any other request it answers in text. A denied tool is never called, even when it is
 * the only tool offered: the step answers in text instead. `DEFAULT_DENIED_TOOLS` always applies, and `denyTools`
 * adds to it.
 *
 * One step answers one call, so give `ScriptedModel` one step per call you expect, such as
 * `new ScriptedModel([autoResponder(), autoResponder()])` for a call and its answer.
 */
export function autoResponder(options: AutoResponderOptions = {}): ScriptStep {
  const deny = [...DEFAULT_DENIED_TOOLS, ...(options.denyTools ?? [])];
  const answer = options.answer ?? "Auto responder: done.";
  return (request: RecordedRequest): AssistantScript => {
    const { messages, tools } = request.context;
    const allowed = tools.filter((tool) => !isDenied(tool.name, deny));
    const tool = toolCallsOf(messages).length === 0 ? pickTool(allowed, messages) : undefined;
    if (tool === undefined) return { content: [{ type: "text", text: answer }], usage: {} };
    const input = synthesizeInput(tool.inputSchema);
    return { content: [{ type: "tool_call", callId: "", name: tool.name, input }], usage: {} };
  };
}
