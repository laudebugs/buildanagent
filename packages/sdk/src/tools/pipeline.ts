/**
 * The tool pipeline: the fixed steps every tool call runs (agent-SDK guide §4). Resolve the name, coerce, validate,
 * an optional `repair`, the gate, `execute`, the write outcome, then `afterToolCall`. A failure the model caused
 * becomes an error result and never throws; only a programmer error, such as a malformed tool result, throws an
 * `SdkError`.
 *
 * The gate runs after validation and `after` runs after `execute`. The run's interceptors fill them (`beforeToolCall`
 * and `afterToolCall`), and a pipeline without them allows every call and keeps every result. A step's calls are
 * checked and gated one at a time, in model order, and then scheduled together (see `runCalls`).
 */
import type { AssistantMessage, ModelContent } from "@buildanagent/gateway";
import { SdkError } from "../errors.js";
import type { Clock } from "../testing/determinism.js";
import type { SignedPendingRequest } from "../vendor/agent-safety/pending.js";
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
   * of the step executes. It returns `{ blocked }` to stop the call with that result, `{ paused, input }` to hold the
   * call for a person with no result at all, with the signed request and the input it signs, `{ input }` to run it
   * with another input, which must pass the tool's schema, or `undefined` to let it run as it is. Without a gate every
   * call is allowed.
   */
  gate?(e: {
    readonly call: ToolCall;
    readonly tool: AnyTool;
    readonly input: unknown;
  }): Promise<GateOutcome | undefined>;
  /**
   * Called with the result of each call that executed, and returns the result to use in its place. It runs inside the
   * call's own task, so a sibling is never left running while it works, and a programmer error it throws cancels the
   * siblings like one from `execute`.
   */
  after?(e: {
    readonly call: ToolCall;
    readonly tool: AnyTool;
    readonly input: unknown;
    readonly result: ToolResult;
  }): Promise<ToolResult>;
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
   * Receives each call the gate paused, with its signed request and the input that request signs, in model order and
   * only once every call of the message has been gated.
   */
  onPause?(entry: PausedCall): void;
  /**
   * Called as soon as a tool's `execute` returns or throws, before the result is checked, so the run knows a write
   * may have happened even when its result then throws an `SdkError`.
   */
  onExecuted?(call: ToolCall): void;
  /**
   * True when every call already holds the input a verified approval signed: each runs with that input exactly, once
   * it still passes the tool's schema, and no gate is asked. Coercion and `repair` are skipped, because they ran
   * before the input was signed.
   */
  readonly approved?: boolean;
}

/** What a gate decides besides letting a call run unchanged. */
export type GateOutcome =
  | { readonly blocked: ToolResult }
  | { readonly paused: SignedPendingRequest; readonly input: unknown }
  | { readonly input: unknown };

/** A tool call a gate paused: its signed request, and the input the request signs. */
export interface PausedCall {
  readonly call: ToolCall;
  readonly request: SignedPendingRequest;
  readonly input: unknown;
}

/** One tool call and the result the model will read for it. */
export interface ToolCallResult {
  readonly call: ToolCall;
  readonly result: ToolResult;
  /** The input the gate put in place of the model's, present only when the gate replaced it. */
  readonly input?: unknown;
  /** The input the call executed with, present only for a call that executed. */
  readonly ranWith?: unknown;
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

/** True for a list of text and image blocks, the only content a tool result may carry. */
export function isContentList(content: unknown): content is readonly ModelContent[] {
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
  /** True when the gate replaced the model's input with `input`. */
  readonly replaced: boolean;
  readonly key: string | undefined;
}

/** A call whose result is already known: it failed a check, was gated or could not run. */
interface Done {
  readonly kind: "done";
  readonly call: ToolCall;
  readonly result: ToolResult;
}

/** A call held for a person: it never runs in this step and gets no result, so the transcript leaves it open. */
interface Paused {
  readonly kind: "paused";
  readonly call: ToolCall;
  readonly tool: AnyTool;
  readonly request: SignedPendingRequest;
  /** The input the request signs, which the call would run with once approved. */
  readonly input: unknown;
}

type Prepared = Ready | Done | Paused;

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

// Asks the gate about one call. A replacement input is checked against the tool's schema again, because the gate is
// user code and a call must never run with input its own tool would have rejected.
async function gateCall(
  call: ToolCall,
  tool: AnyTool,
  input: unknown,
  ctx: PipelineContext,
): Promise<
  | { readonly blocked: ToolResult }
  | { readonly paused: SignedPendingRequest; readonly input: unknown }
  | { readonly input: unknown; readonly replaced?: true }
> {
  const outcome = await ctx.gate?.({ call, tool, input });
  if (outcome === undefined) return { input };
  if ("blocked" in outcome || "paused" in outcome) return outcome;
  const checked = await preparedSchemaOf(tool).validate(outcome.input);
  if (!checked.ok) {
    const issues = checked.issues.map((issue) => `${issue.path} ${issue.message}`.trim()).join("; ");
    throw new SdkError(
      "invalid_hook_result",
      `beforeToolCall replaced the input of tool "${tool.name}" with input its schema rejects: ${issues}`,
    );
  }
  return { input: checked.value, replaced: true };
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
  if (ctx.approved === true) return prepareApproved(call, tool);
  const checked = await checkInput(tool, call);
  if (!checked.ok) return { kind: "done", call, result: checked.result };
  if (ctx.signal.aborted) return { kind: "done", call, result: notRun(call, tool, "run_aborted") };
  // Each call's gate settles before the next call's is asked, and every gate before any call executes.
  const gated = await gateCall(call, tool, checked.input, ctx);
  if ("blocked" in gated) return { kind: "done", call, result: gated.blocked };
  if ("paused" in gated) return { kind: "paused", call, tool, request: gated.paused, input: gated.input };
  const replaced = "replaced" in gated;
  return { kind: "ready", call, tool, input: gated.input, replaced, key: resourceKeyOf(tool, gated.input) };
}

// A call whose input a verified approval signed runs with that input as it is. It is checked against the schema once
// more, because the tool may have changed since the pause, but the checked value never replaces it.
async function prepareApproved(call: ToolCall, tool: AnyTool): Promise<Prepared> {
  const checked = await preparedSchemaOf(tool).validate(call.input);
  if (!checked.ok) {
    const failure: ToolFailure = {
      kind: "invalid_input",
      tool: tool.name,
      callId: call.callId,
      input: call.input,
      issues: checked.issues,
    };
    return { kind: "done", call, result: failed(failure, tool) };
  }
  return { kind: "ready", call, tool, input: call.input, replaced: false, key: resourceKeyOf(tool, call.input) };
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
    const result = await execute(item.tool, item.call, item.input, { ...ctx, signal: batch.signal });
    if (ctx.after === undefined) return result;
    return await ctx.after({ call: item.call, tool: item.tool, input: item.input, result });
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
): (Promise<Settled<ToolResult>> | undefined)[] {
  const ready = prepared.filter((item): item is Ready => item.kind === "ready");
  const scheduled = schedule(
    ready.map((item) => ({
      ...(item.key === undefined ? {} : { key: item.key }),
      readOnly: isTrustedReadOnly(item.tool),
      run: () => runReady(item, ctx, batch),
    })),
    sequential,
  );
  const byItem = new Map<Prepared, Promise<Settled<ToolResult>> | undefined>(
    ready.map((item, index) => [item, scheduled[index]]),
  );
  return prepared.map((item) => {
    if (item.kind === "paused") return undefined;
    if (item.kind === "done") return Promise.resolve<Settled<ToolResult>>({ ok: true, value: item.result });
    return byItem.get(item);
  });
}

/**
 * Runs the calls of one step. Each call is checked and gated one at a time, in model order, before any call executes.
 * The calls that passed then start together, except that a call to a sequential tool makes the whole step run one
 * call at a time, even when that call itself fails a check, and calls that share a `resourceKey` queue in model
 * order. Results reach `ctx.onResult` in model order, each as soon as every result before it is in. A call the gate
 * paused gets no result and is left out; each one reaches `ctx.onPause`, in model order, once every call is gated.
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
    // None of these calls has executed, and none will. The first error is the one thrown, so a receiver that throws
    // here must not hide it or stop the other calls from getting their results.
    // A paused call gets a not-run result here too: the run is failing, so its pause is never reported or returned.
    for (const item of prepared) {
      const result = item.kind === "done" ? item.result : notRun(item.call, item.tool, "sibling_failed");
      try {
        ctx.onResult?.({ call: item.call, result });
      } catch {
        // Not rethrown: the error being handled is thrown below.
      }
    }
    throw error;
  }
  // Reported only now, once every call has been gated, so a step that fails while its calls are checked never reports
  // a pause and then gives the same call a result.
  for (const item of prepared) {
    if (item.kind === "paused") ctx.onPause?.({ call: item.call, request: item.request, input: item.input });
  }
  const sequential = calls.some((call) => byName.get(call.name)?.executionMode === "sequential");
  const { batch, release } = batchController(ctx.signal);
  try {
    return await deliver(prepared, start(prepared, sequential, ctx, batch), ctx, batch);
  } finally {
    release();
  }
}

// Passes each result on in model order, as soon as every result before it is in. A failed call has already cancelled
// the others; the loop still waits for each of them and passes its result on, so none is left running and a write
// that happened is recorded, and then the first error is thrown. A receiver that throws is a failed call too: it
// cancels the siblings, and the results after it are still passed on.
async function deliver(
  prepared: readonly Prepared[],
  running: readonly (Promise<Settled<ToolResult>> | undefined)[],
  ctx: PipelineContext,
  batch: AbortController,
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  let failure: { readonly error: unknown } | undefined;
  for (const [index, pending] of running.entries()) {
    if (pending === undefined) continue;
    const settled = await pending;
    if (!settled.ok) {
      failure ??= { error: settled.error };
      continue;
    }
    const item = prepared[index] as Prepared;
    const replaced = item.kind === "ready" && item.replaced ? { input: item.input } : {};
    const ran = item.kind === "ready" ? { ranWith: item.input } : {};
    const entry: ToolCallResult = { call: item.call, result: settled.value, ...replaced, ...ran };
    results.push(entry);
    try {
      ctx.onResult?.(entry);
    } catch (error) {
      failure ??= { error };
      batch.abort(error);
    }
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
  const { onStart: _start, onResult: _result, onPause: _pause, ...quiet } = ctx;
  const [entry] = await runCalls([call], () => undefined, tools, quiet);
  if (entry === undefined)
    throw new SdkError("invalid_hook_result", `runToolCall() can't pause the call "${call.name}"`);
  return entry.result;
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
