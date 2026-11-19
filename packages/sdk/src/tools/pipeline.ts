/**
 * The tool pipeline: the fixed steps every tool call runs (agent-SDK guide §4). Resolve the name, coerce, validate,
 * an optional `repair`, the gate, `execute`, the write outcome, then `afterToolCall`. A failure the model caused
 * becomes an error result and never throws; only a programmer error, such as a malformed tool result, throws an
 * `SdkError`.
 *
 * The gate and `afterToolCall` steps hold their places in the order below, and the interceptors fill them in: until
 * then every call is allowed and every result passes through unchanged. A step's calls are checked and gated one at a
 * time, in model order, and then scheduled together (see `runCalls`).
 */
import type { AssistantMessage, ModelContent } from "@buildanagent/gateway";
import { SdkError } from "../errors.js";
import type { Clock } from "../testing/determinism.js";
import { coerceValue } from "./coerce.js";
import { preparedSchemaOf } from "./define.js";
import { formatToolError, REDACTED_MESSAGE } from "./format-error.js";
import { withOutcome } from "./outcome.js";
import { type Settled, schedule } from "./scheduler.js";
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
  /**
   * The gate: asked once for each call that passed validation, one call at a time in model order, and before any call
   * of the step executes. It returns a result to block the call, or `undefined` to let it run. Without a gate every
   * call is allowed.
   */
  gate?(e: {
    readonly call: ToolCall;
    readonly tool: AnyTool;
    readonly input: unknown;
  }): Promise<ToolResult | undefined>;
  /** Called for each call of a message before its result is worked out, whether or not the call will run. */
  onStart?(call: ToolCall): void;
  /** Receives a tool's progress updates. */
  onUpdate?(callId: string, details: unknown): void;
  /**
   * Receives each call's result as soon as `runToolCalls` has it, so the run can record a write before a later call
   * in the same message throws.
   */
  onResult?(entry: ToolCallResult): void;
  /**
   * Called as soon as a tool's `execute` returns or throws, before the result is checked, so the run knows a write
   * may have happened even when its result then throws an `SdkError`.
   */
  onExecuted?(call: ToolCall): void;
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
    ctx.onExecuted?.(call);
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
  ctx.onExecuted?.(call);
  return withOutcome(tool.name, checkResult(tool.name, result));
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

/** A call that passed every check before execution and now waits to be scheduled. */
interface Ready {
  readonly kind: "ready";
  readonly call: ToolCall;
  readonly tool: AnyTool;
  readonly input: unknown;
  readonly key: string | undefined;
}

/** A call whose result is already known: it failed a check, was gated or could not run. */
interface Done {
  readonly kind: "done";
  readonly call: ToolCall;
  readonly result: ToolResult;
}

type Prepared = Ready | Done;

function resourceKeyOf(tool: AnyTool, input: unknown): string | undefined {
  if (tool.resourceKey === undefined) return undefined;
  let key: unknown;
  try {
    key = tool.resourceKey(input);
  } catch (cause) {
    throw new SdkError("invalid_tool_definition", `tool "${tool.name}": resourceKey threw: ${errorMessage(cause)}`, {
      cause,
    });
  }
  if (typeof key !== "string") {
    throw new SdkError("invalid_tool_definition", `tool "${tool.name}": resourceKey must return a string`);
  }
  return key;
}

// Everything that happens before execution, for one call: name, cancellation, input checks, resource key, and the
// gate. A call that fails any of them is `Done` with the result the model reads.
async function prepareCall(
  call: ToolCall,
  early: ToolResult | undefined,
  byName: ReadonlyMap<string, AnyTool>,
  ctx: PipelineContext,
): Promise<Prepared> {
  if (early !== undefined) return { kind: "done", call, result: early };
  const tool = byName.get(call.name);
  if (tool === undefined) {
    const availableTools = [...byName.keys()];
    const failure: ToolFailure = {
      kind: "unknown_tool",
      tool: call.name,
      callId: call.callId,
      input: call.input,
      availableTools,
    };
    return { kind: "done", call, result: failed(failure, undefined) };
  }
  // Checked before validation, so a cancelled run starts no `repair`, and again after, because `repair` may await.
  if (ctx.signal.aborted) return { kind: "done", call, result: notRun(call, tool, "run_aborted") };
  const checked = await checkInput(tool, call);
  if (!checked.ok) return { kind: "done", call, result: checked.result };
  if (ctx.signal.aborted) return { kind: "done", call, result: notRun(call, tool, "run_aborted") };
  const key = resourceKeyOf(tool, checked.input);
  // Each call's gate settles before the next call's is asked, and every gate before any call executes.
  const blocked = await ctx.gate?.({ call, tool, input: checked.input });
  if (blocked !== undefined) return { kind: "done", call, result: blocked };
  return { kind: "ready", call, tool, input: checked.input, key };
}

// Only a first-party tool's hint counts: an MCP server's annotations are claims by someone we don't control. A tool
// with an `effect` changes the world whatever its hint says, so it always queues as a writer.
function isTrustedReadOnly(tool: AnyTool): boolean {
  return tool.firstParty === true && tool.annotations?.readOnlyHint === true && tool.effect === undefined;
}

// Relays the run's cancellation to the signal the batch's tools receive, which a failing sibling can also fire.
function batchController(runSignal: AbortSignal): { batch: AbortController; release(): void } {
  const batch = new AbortController();
  const relay = () => batch.abort(runSignal.reason);
  if (runSignal.aborted) relay();
  else runSignal.addEventListener("abort", relay, { once: true });
  return { batch, release: () => runSignal.removeEventListener("abort", relay) };
}

// Runs one ready call under the batch's signal. A programmer error cancels the siblings before it propagates; a
// model-caused failure is an ordinary result and cancels nothing.
async function runReady(item: Ready, ctx: PipelineContext, batch: AbortController): Promise<ToolResult> {
  if (batch.signal.aborted) {
    return notRun(item.call, item.tool, ctx.signal.aborted ? "run_aborted" : "sibling_failed");
  }
  try {
    return await execute(item.tool, item.call, item.input, { ...ctx, signal: batch.signal });
  } catch (error) {
    batch.abort(error);
    throw error;
  }
}

// Starts every ready call by the scheduling rules and returns, in model order, the promise of each call's result.
function start(
  prepared: readonly Prepared[],
  sequential: boolean,
  ctx: PipelineContext,
  batch: AbortController,
): Promise<Settled<ToolResult>>[] {
  const ready = prepared.filter((item): item is Ready => item.kind === "ready");
  const scheduled = schedule(
    ready.map((item) => ({
      ...(item.key === undefined ? {} : { key: item.key }),
      readOnly: isTrustedReadOnly(item.tool),
      run: () => runReady(item, ctx, batch),
    })),
    sequential,
  );
  const byItem = new Map(ready.map((item, index) => [item, scheduled[index]]));
  return prepared.map(
    (item) =>
      (item.kind === "done" ? undefined : byItem.get(item)) ??
      Promise.resolve<Settled<ToolResult>>({ ok: true, value: (item as Done).result }),
  );
}

/**
 * Runs the calls of one step. Each call is checked and gated one at a time, in model order, before any call executes.
 * The calls that passed then start together, except that a call to a sequential tool makes the whole step run one
 * call at a time, even when that call itself fails a check, and calls that share a `resourceKey` queue in model
 * order. Results reach `ctx.onResult` in model order, each as soon as every result before it is in.
 *
 * A programmer error (an `SdkError`) in one call fires the signal the other calls hold, waits for them to stop, and
 * is then thrown, after every other call's result has been passed on: a call after the failing one may have run and
 * written. A programmer error while the calls are checked, such as a `resourceKey` that throws, is thrown after the
 * calls already checked get their results, so every call that started has one, except the call that failed.
 */
async function runCalls(
  calls: readonly ToolCall[],
  early: (call: ToolCall) => ToolResult | undefined,
  tools: readonly AnyTool[],
  ctx: PipelineContext,
): Promise<ToolCallResult[]> {
  const byName = toolsByName(tools);
  const prepared: Prepared[] = [];
  try {
    for (const call of calls) {
      ctx.onStart?.(call);
      prepared.push(await prepareCall(call, early(call), byName, ctx));
    }
  } catch (error) {
    // None of these calls has executed, and none will.
    for (const item of prepared) {
      const result = item.kind === "done" ? item.result : notRun(item.call, item.tool, "sibling_failed");
      ctx.onResult?.({ call: item.call, result });
    }
    throw error;
  }
  const sequential = calls.some((call) => byName.get(call.name)?.executionMode === "sequential");
  const { batch, release } = batchController(ctx.signal);
  try {
    return await deliver(prepared, start(prepared, sequential, ctx, batch), ctx);
  } finally {
    release();
  }
}

// Passes each result on in model order, as soon as every result before it is in. A failed call has already cancelled
// the others; the loop still waits for each of them and passes its result on, so none is left running and a write
// that happened is recorded, and then the first error is thrown.
async function deliver(
  prepared: readonly Prepared[],
  running: readonly Promise<Settled<ToolResult>>[],
  ctx: PipelineContext,
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  let failure: { readonly error: unknown } | undefined;
  for (const [index, pending] of running.entries()) {
    const settled = await pending;
    if (!settled.ok) {
      failure ??= { error: settled.error };
      continue;
    }
    const entry = { call: (prepared[index] as Prepared).call, result: settled.value };
    results.push(entry);
    ctx.onResult?.(entry);
  }
  if (failure !== undefined) throw failure.error;
  return results;
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
  const { onStart: _start, onResult: _result, ...quiet } = ctx;
  const [entry] = await runCalls([call], () => undefined, tools, quiet);
  return (entry as ToolCallResult).result;
}

/**
 * Runs every tool call of an assistant message and passes each result to `ctx.onResult` in model order. A message
 * that stopped at the output limit (`stopReason: "length"`) runs nothing: each of its calls gets an error asking the
 * model to re-issue it, because its arguments may be cut short. A message that ended in an error or was aborted also
 * runs nothing, because its calls may be partial. Otherwise the calls are scheduled as `runCalls` describes.
 */
export async function runToolCalls(
  message: AssistantMessage,
  tools: readonly AnyTool[],
  ctx: PipelineContext,
): Promise<ToolCallResult[]> {
  const calls = message.content.filter((block): block is ToolCall => block.type === "tool_call");
  return runCalls(calls, (call) => unrunnable(message, call, tools), tools, ctx);
}
