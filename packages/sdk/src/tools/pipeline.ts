/**
 * The tool pipeline: the fixed steps every tool call runs (agent-SDK guide §4). Resolve the name, coerce, validate,
 * an optional `repair`, the gate, `execute`, the write outcome, then `afterToolCall`. A failure the model caused
 * becomes an error result and never throws; only a programmer error, such as a malformed tool result, throws an
 * `SdkError`.
 *
 * The gate and `afterToolCall` steps hold their places in the order below, and the interceptors fill them in: until
 * then every call is allowed and every result passes through unchanged. Calls run one at a time, in model order.
 */
import type { AssistantMessage, ModelContent } from "@buildanagent/gateway";
import { SdkError } from "../errors.js";
import type { Clock } from "../testing/determinism.js";
import { coerceValue } from "./coerce.js";
import { preparedSchemaOf } from "./define.js";
import { formatToolError, REDACTED_MESSAGE } from "./format-error.js";
import { withOutcome } from "./outcome.js";
import type { ToolCall, ToolDefinition, ToolFailure, ToolResult } from "./types.js";

/** A tool of any input and structured type, as the pipeline holds it. */
export type AnyTool = ToolDefinition<unknown, unknown>;

/** What the pipeline needs from the run around it. */
export interface PipelineContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly depth: number;
  readonly maxDepth: number;
  readonly clock: Clock;
  /** Receives a tool's progress updates. */
  onUpdate?(callId: string, details: unknown): void;
  /**
   * Receives each call's result as soon as `runToolCalls` has it, so the run can record a write before a later call
   * in the same message throws.
   */
  onResult?(entry: ToolCallResult): void;
}

/** One tool call and the result the model will read for it. */
export interface ToolCallResult {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

function toolsByName(tools: readonly AnyTool[]): ReadonlyMap<string, AnyTool> {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) {
    preparedSchemaOf(tool);
    if (byName.has(tool.name)) {
      throw new SdkError("invalid_tool_definition", `two tools are named "${tool.name}"; tool names must be unique`);
    }
    byName.set(tool.name, tool);
  }
  return byName;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isModelContent(block: unknown): block is ModelContent {
  if (typeof block !== "object" || block === null) return false;
  const { type, text, mediaType, data } = block as Record<string, unknown>;
  if (type === "text") return typeof text === "string";
  return type === "image" && typeof mediaType === "string" && typeof data === "string";
}

function isContentList(content: unknown): content is readonly ModelContent[] {
  return Array.isArray(content) && content.every(isModelContent);
}

type Formatted = { readonly content: readonly ModelContent[]; readonly error?: string };

// A formatter that throws, or returns something the model can't read, must not hide the failure from the model, so
// the default text is used instead, and the formatter's error is kept in `details`.
function formatted(failure: ToolFailure, tool: AnyTool | undefined): Formatted {
  const fallback = formatToolError(failure);
  if (tool?.formatError === undefined) return { content: fallback };
  let content: unknown;
  try {
    content = tool.formatError(failure);
  } catch (error) {
    return { content: fallback, error: errorMessage(error) };
  }
  if (isContentList(content)) return { content };
  return { content: fallback, error: "formatError did not return a list of text and image blocks" };
}

function failed(failure: ToolFailure, tool: AnyTool | undefined, details: Record<string, unknown> = {}): ToolResult {
  const { content, error: formatterError } = formatted(failure, tool);
  return {
    content,
    isError: true,
    details: { failure, ...details, ...(formatterError === undefined ? {} : { formatterError }) },
  };
}

type Checked = { readonly ok: true; readonly input: unknown } | { readonly ok: false; readonly result: ToolResult };

// Coerce, validate, and on failure give `repair` one chance. The model sees the issues of its own arguments, and
// `details` keeps what repair returned.
async function checkInput(tool: AnyTool, call: ToolCall): Promise<Checked> {
  const schema = preparedSchemaOf(tool);
  const coerced = coerceValue(call.input, schema.jsonSchema);
  const first = await schema.validate(coerced);
  if (first.ok) return { ok: true, input: first.value };
  const failure: ToolFailure = {
    kind: "invalid_input",
    tool: tool.name,
    callId: call.callId,
    input: call.input,
    issues: first.issues,
  };
  if (tool.repair === undefined) return { ok: false, result: failed(failure, tool) };
  let repaired: unknown;
  try {
    repaired = await tool.repair({ input: coerced, issues: first.issues });
  } catch (error) {
    return { ok: false, result: failed(failure, tool, { repairError: errorMessage(error) }) };
  }
  if (repaired === undefined) return { ok: false, result: failed(failure, tool) };
  const second = await schema.validate(coerceValue(repaired, schema.jsonSchema));
  if (second.ok) return { ok: true, input: second.value };
  return { ok: false, result: failed(failure, tool, { repaired, repairedIssues: second.issues }) };
}

function checkResult(tool: string, result: unknown): ToolResult {
  const content = (result as { content?: unknown } | null)?.content;
  if (typeof result !== "object" || result === null || !isContentList(content)) {
    throw new SdkError(
      "invalid_tool_result",
      `tool "${tool}" must return an object whose content is a list of text and image blocks`,
    );
  }
  return result as ToolResult;
}

async function execute(tool: AnyTool, call: ToolCall, input: unknown, ctx: PipelineContext): Promise<ToolResult> {
  const context = {
    runId: ctx.runId,
    callId: call.callId,
    signal: ctx.signal,
    depth: ctx.depth,
    maxDepth: ctx.maxDepth,
    clock: ctx.clock,
    update: (details: unknown) => ctx.onUpdate?.(call.callId, details),
  };
  let result: unknown;
  try {
    result = await tool.execute(input, context);
  } catch (error) {
    const message = errorMessage(error);
    const redacted = tool.redactErrors === true;
    const failure: ToolFailure = {
      kind: "execution_error",
      tool: tool.name,
      callId: call.callId,
      input: call.input,
      message: redacted ? REDACTED_MESSAGE : message,
      redacted,
    };
    return failed(failure, tool, { error: { name: error instanceof Error ? error.name : typeof error, message } });
  }
  return withOutcome(tool.name, checkResult(tool.name, result));
}

/**
 * Runs one tool call through the pipeline and returns the result the model reads. It never throws for a failure
 * the model caused: an unknown tool, invalid input or a throwing `execute` each become an error result. It throws
 * an `SdkError` for a programmer error: a bad tool definition, two tools with one name, or a malformed result.
 */
export async function runToolCall(
  call: ToolCall,
  tools: readonly AnyTool[],
  ctx: PipelineContext,
): Promise<ToolResult> {
  const byName = toolsByName(tools);
  const tool = byName.get(call.name);
  if (tool === undefined) {
    const availableTools = [...byName.keys()];
    return failed(
      { kind: "unknown_tool", tool: call.name, callId: call.callId, input: call.input, availableTools },
      undefined,
    );
  }
  const checked = await checkInput(tool, call);
  if (!checked.ok) return checked.result;
  // Checked after validation, because `repair` may await: a write must not start once the user has cancelled.
  if (ctx.signal.aborted) return notRun(call, tool, "run_aborted");
  // Gate: every call is allowed until the beforeToolCall interceptor exists.
  const result = await execute(tool, call, checked.input, ctx);
  // afterToolCall: the result passes through unchanged until that interceptor exists.
  return result;
}

type NotRunReason = Extract<ToolFailure, { kind: "not_run" }>["reason"];

function notRun(call: ToolCall, tool: AnyTool | undefined, reason: NotRunReason): ToolResult {
  return failed({ kind: "not_run", reason, tool: call.name, callId: call.callId, input: call.input }, tool);
}

// Why none of a message's calls may run, or undefined when they all may.
function unrunnable(message: AssistantMessage, call: ToolCall, tools: readonly AnyTool[]): ToolResult | undefined {
  const tool = tools.find((candidate) => candidate.name === call.name);
  switch (message.stopReason) {
    case "length":
      return failed({ kind: "truncated", tool: call.name, callId: call.callId, input: call.input }, tool);
    case "error":
      return notRun(call, tool, "response_error");
    case "aborted":
      return notRun(call, tool, "response_aborted");
    default:
      return undefined;
  }
}

/**
 * Runs every tool call of an assistant message, one at a time and in model order, and passes each result to
 * `ctx.onResult` as it arrives. A message that stopped at the output limit (`stopReason: "length"`) runs nothing:
 * each of its calls gets an error asking the model to re-issue it, because its arguments may be cut short. A message
 * that ended in an error or was aborted also runs nothing, because its calls may be partial.
 */
export async function runToolCalls(
  message: AssistantMessage,
  tools: readonly AnyTool[],
  ctx: PipelineContext,
): Promise<ToolCallResult[]> {
  const calls = message.content.filter((block): block is ToolCall => block.type === "tool_call");
  toolsByName(tools);
  const results: ToolCallResult[] = [];
  for (const call of calls) {
    const entry = { call, result: unrunnable(message, call, tools) ?? (await runToolCall(call, tools, ctx)) };
    results.push(entry);
    ctx.onResult?.(entry);
  }
  return results;
}
