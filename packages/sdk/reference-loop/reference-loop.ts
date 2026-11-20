// A reference loop you can read in one sitting. It is the SDK's `run()` and `continueRun()` with the machinery taken
// out: tools run in order, there are no observers, steering or OTel, and fewer events are sent. What it keeps is the
// shape of a step (transform, before, stream, after, tools, stop), the six interceptors, signed pauses and every stop
// reason of the real loop but `clarification_requested`, which needs a signed question that only the SDK's internals
// can write.
//
// It imports only the public exports of `@buildanagent/gateway` and `@buildanagent/sdk`. The capstone's conformance
// suite runs against it as it runs against the real loop (test/reference-loop.test.ts), so a change to the real loop
// that the reference no longer matches fails a test. The README ("A reference loop") maps each part to the real module.
import {
  type AssistantMessage,
  addCost,
  addUsage,
  type ContentBlock,
  type Cost,
  emptyUsage,
  type Message,
  projectCallCost,
  type WireTool,
} from "@buildanagent/gateway";
import {
  type AgentEvent,
  type AgentEventBody,
  type ApprovalSigner,
  type Context,
  type ContinueOptions,
  canonicalInputHash,
  createPendingRequest,
  ephemeralSigner,
  type GateDecision,
  type ResolutionRejectionCause,
  type RunError,
  type RunInput,
  type RunOptions,
  type RunResult,
  SdkError,
  type SignedPendingRequest,
  type StopDecision,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "@buildanagent/sdk";

type Tool = ToolDefinition<unknown, unknown>;
type Call = Extract<ContentBlock, { type: "tool_call" }>;

/** How a run ended, before the usage, cost and messages are added. */
type Outcome = { readonly stopReason: RunResult["stopReason"]; readonly [field: string]: unknown };

/** A run in progress: iterate it for events, or await `result`. Events arrive once the run has ended. */
export interface ReferenceRun<S = unknown> extends AsyncIterable<AgentEvent> {
  readonly id: string;
  readonly result: Promise<RunResult<S>>;
  abort(): void;
}

/** Everything that changes while a run goes on. */
interface State {
  readonly runId: string;
  readonly options: RunOptions;
  readonly tools: readonly Tool[];
  readonly signal: AbortSignal;
  readonly signer: ApprovalSigner;
  readonly nextId: () => string;
  readonly system: string;
  readonly messages: Message[];
  readonly added: Message[];
  readonly events: AgentEvent[];
  readonly pending: SignedPendingRequest[];
  readonly pendingInputs: Record<string, unknown>;
  stepIndex: number;
  steps: number;
  usage: ReturnType<typeof emptyUsage>;
  cost?: Cost;
  output?: unknown;
  ended: boolean;
  /** The latest failing call and how many times in a row it has failed, for the progress rule. */
  streak: { key: string; count: number };
}

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MAX_FAILURES = 3;
const NO_COST: Cost = { total: 0, basis: "provider", currency: "USD" };
const REISSUED = "The earlier request for this call could not be verified, so it needs a new answer.";
const textOf = (text: string) => [{ type: "text" as const, text }];
const failure = (text: string): ToolResult => ({ content: textOf(text), isError: true });
const SYSTEM_CLOCK = { now: () => new Date().toISOString() };
/** The object without its undefined fields, which `exactOptionalPropertyTypes` won't let a request carry. */
const defined = <T extends object>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Thrown when an interceptor throws, so the run can end `error` instead of crashing. */
class HookFailure extends Error {}

/** Starts a run. It begins at once; `result` settles when it stops. */
export function run<S = unknown>(options: RunOptions<S> & RunInput): ReferenceRun<S> {
  const content = typeof options.input === "string" ? textOf(options.input) : [...options.input];
  const input: Message = { role: "user", content };
  return start(options, options.system, [...(options.history ?? []), input], [input]);
}

/** The answers a resumed run settles its waiting calls with. */
type Resume = { readonly context: Context; readonly resolutions: NonNullable<ContinueOptions["resolutions"]> };

/** Continues a stored context. Verified resolutions settle its waiting calls before the first model call. */
export function continueRun<S = unknown>(context: Context, options: ContinueOptions<S>): ReferenceRun<S> {
  return start(options, context.system, [...context.messages], [], { context, resolutions: options.resolutions ?? [] });
}

function start<S>(options: RunOptions<S>, system: string, messages: Message[], added: Message[], resume?: Resume) {
  const controller = new AbortController();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const nextId = options.idGenerator ?? (() => crypto.randomUUID());
  const state: State = {
    runId: nextId(),
    options: options as RunOptions,
    tools: [...(options.tools ?? []), ...(options.output === undefined ? [] : [options.output as Tool])],
    signal: controller.signal,
    signer: options.signer ?? ephemeralSigner(),
    nextId,
    system,
    messages,
    added,
    events: [],
    pending: [],
    pendingInputs: Object.create(null),
    stepIndex: 0,
    steps: 0,
    usage: emptyUsage(),
    ended: false,
    streak: { key: "", count: 0 },
  };
  const result = drive(state, resume) as Promise<RunResult<S>>;
  result.catch(() => undefined); // a failure reaches the caller through `result` and through iteration
  const events = async function* () {
    await result;
    yield* state.events;
  };
  return { id: state.runId, result, abort: () => controller.abort(), [Symbol.asyncIterator]: events };
}

function emit(s: State, body: AgentEventBody): void {
  const timestamp = (s.options.clock ?? SYSTEM_CLOCK).now();
  s.events.push({ runId: s.runId, seq: s.events.length, stepIndex: s.stepIndex, timestamp, ...body } as AgentEvent);
}

function append(s: State, message: Message): void {
  s.messages.push(message);
  s.added.push(message);
}

// --- The run: settle a resumed context, then step until a stop reason holds -------------------------------------

async function drive(s: State, resume: Resume | undefined): Promise<RunResult> {
  let outcome: Outcome | undefined;
  try {
    if (resume !== undefined) outcome = await settle(s, resume);
    while (outcome === undefined) outcome = s.signal.aborted ? { stopReason: "aborted" } : await step(s);
  } catch (error) {
    if (!(error instanceof HookFailure)) throw error;
    outcome = { stopReason: "error", error: { kind: "hook", message: error.message } satisfies RunError };
  }
  const paused = outcome.stopReason === "awaiting_approval";
  const context = {
    system: s.system,
    messages: s.messages,
    ...(paused ? { pending: s.pending, pendingInputs: s.pendingInputs } : {}),
  };
  const result = { messages: s.added, context, usage: s.usage, cost: s.cost ?? NO_COST, steps: s.steps, ...outcome };
  emit(s, { type: "run_end", result: result as RunResult });
  return result as RunResult;
}

// --- One step: transform, before, stream, after, tools, stop -----------------------------------------------------

async function step(s: State): Promise<Outcome | undefined> {
  s.stepIndex = s.steps;
  emit(s, { type: "step_start" });
  const called = await callModel(s);
  return "outcome" in called ? called.outcome : runCalls(s, called.message);
}

/** The fields every interceptor event carries. */
function hookBase(s: State) {
  const timestamp = (s.options.clock ?? SYSTEM_CLOCK).now();
  return { runId: s.runId, stepIndex: s.stepIndex, signal: s.signal, timestamp };
}

/** Calls an interceptor, if there is one. A throw becomes a `HookFailure`: the run fails closed. */
async function guarded<E, R>(name: string, hook: ((event: E) => R | Promise<R>) | undefined, event: E) {
  if (hook === undefined) return undefined;
  try {
    return await hook(event);
  } catch (error) {
    throw new HookFailure(`the ${name} interceptor threw: ${messageOf(error)}`);
  }
}

const sentTools = (s: State) => s.tools.filter((tool) => (tool.exposure ?? "direct") === "direct");

async function callModel(s: State): Promise<{ message: AssistantMessage } | { outcome: Outcome }> {
  const { model, modelOptions = {}, interceptors: hooks = {} } = s.options;
  const base = hookBase(s);
  // transform: a view of the transcript for this call alone
  const view = await guarded("transformContext", hooks.transformContext, {
    ...base,
    system: s.system,
    messages: s.messages,
    model: model.ref,
  });
  let context = { system: s.system, messages: [...(view ?? s.messages)], tools: sentTools(s).map(wireOf) };
  // before: the interceptor may change the request's system prompt or messages
  const patch = await guarded("beforeModelCall", hooks.beforeModelCall, { ...base, context, options: modelOptions });
  if (patch !== undefined) {
    context = {
      ...context,
      system: patch.system ?? context.system,
      messages: [...(patch.messages ?? context.messages)],
    };
  }
  const refused = budgetBlock(s, context);
  if (refused !== undefined) return { outcome: refused };
  // stream: forward the text, keep the final message
  let message: AssistantMessage | undefined;
  for await (const event of model.stream(context, { ...modelOptions, signal: s.signal })) {
    if (event.type === "text_delta") emit(s, { type: "text_delta", index: event.index, delta: event.delta });
    if (event.type === "done" || event.type === "error") message = event.message;
  }
  if (message === undefined) throw new SdkError("invalid_model_stream", "the model's stream ended without a result");
  s.steps += 1;
  s.usage = addUsage(s.usage, message.usage);
  s.cost = s.cost === undefined ? message.cost : addCost(s.cost, message.cost);
  // after: the interceptor may replace the response; the call is billed as the model sent it
  const replaced = await guarded("afterModelCall", hooks.afterModelCall, { ...base, message });
  const kept = replaced?.message ?? message;
  append(s, kept);
  emit(s, { type: "model_call_end", message: kept });
  return { message: kept };
}

/** The budget: the spend so far plus this call's projected cost must fit, and an unknown price fails closed. */
function budgetBlock(s: State, context: Parameters<typeof projectCallCost>[1]): Outcome | undefined {
  const { model, modelOptions = {}, budgetUsd } = s.options;
  if (budgetUsd === undefined) return undefined;
  const projected = projectCallCost(model, context, modelOptions).total;
  if (projected === null || s.cost?.total === null) {
    return { stopReason: "error", error: { kind: "unknown_price", message: "a price is unknown" } satisfies RunError };
  }
  const spentUsd = s.cost?.total ?? 0;
  if (spentUsd + projected <= budgetUsd) return undefined;
  const reason = `spent $${spentUsd}, and the next call can cost $${projected}, which passes the budget of $${budgetUsd}`;
  return { stopReason: "budget", reason, budgetUsd, spentUsd, projectedUsd: projected };
}

// --- Tools: validate, gate, ask or run, record -------------------------------------------------------------------

type Standard = Extract<Tool["inputSchema"], { "~standard": unknown }>;
const isStandard = (schema: Tool["inputSchema"]): schema is Standard => "~standard" in schema;

/** The tool as a request sends it. A raw JSON Schema is sent as it is; a Standard Schema describes itself. */
function wireOf({ name, description, inputSchema }: Tool): WireTool {
  const schema = isStandard(inputSchema)
    ? inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" })
    : inputSchema;
  return { name, description, inputSchema: schema as Record<string, unknown> };
}

/** Checks the input with the tool's Standard Schema. The reference doesn't validate raw JSON Schemas or coerce. */
async function validate({ inputSchema }: Tool, input: unknown): Promise<{ value: unknown } | { problem: string }> {
  if (!isStandard(inputSchema)) return { value: input };
  const result = await inputSchema["~standard"].validate(input);
  if (result.issues === undefined) return { value: result.value };
  const path = (keys: ReadonlyArray<PropertyKey | { key: PropertyKey }> = []) =>
    keys.map((k) => String(typeof k === "object" ? k.key : k)).join(".");
  return { problem: result.issues.map((issue) => `${path(issue.path) || "input"}: ${issue.message}`).join("; ") };
}

/** Runs the response's calls in order. A call a gate paused gets no result; the other calls run as usual. */
async function runCalls(s: State, message: AssistantMessage): Promise<Outcome | undefined> {
  const calls = message.content.filter((block): block is Call => block.type === "tool_call");
  if (message.stopReason !== "error" && message.stopReason !== "aborted") {
    for (const call of calls) await runCall(s, call, sentTools(s));
  }
  return decide(s, message, calls.length === 0);
}

/**
 * Runs one call. `approved` is set when a person approved the call's request: the call then skips the gate and runs
 * with the input the request signs, never the transcript's arguments.
 */
async function runCall(s: State, call: Call, tools: readonly Tool[], approved?: { input: unknown }) {
  emit(s, { type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input });
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (tool === undefined)
    return record(s, call, failure(`Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}`));
  const checked = await validate(tool, approved === undefined ? call.input : approved.input);
  if ("problem" in checked) return record(s, call, failure(`Invalid input for "${tool.name}": ${checked.problem}`));
  let input = checked.value;
  if (approved === undefined) {
    const event = { ...hookBase(s), callId: call.callId, tool: tool.name, input };
    const gate: GateDecision = (await guarded("beforeToolCall", s.options.interceptors?.beforeToolCall, event)) ?? {
      decision: "allow",
    };
    if (gate.decision === "deny")
      return record(s, call, failure(`Tool call "${tool.name}" was denied: ${gate.reason}`));
    if (gate.decision === "ask") return pause(s, call, gate.input ?? input, gate);
    input = gate.input ?? input;
  }
  record(s, call, await execute(s, tool, call, input));
}

/** Runs the tool, then `afterToolCall`. A tool that throws gives the model an error result, not a failed run. */
async function execute(s: State, tool: Tool, call: Call, input: unknown): Promise<ToolResult> {
  const update = (details: unknown) => emit(s, { type: "tool_call_update", callId: call.callId, details });
  const { depth = 0, maxDepth = 2, clock = SYSTEM_CLOCK } = s.options;
  const ctx: ToolContext = { runId: s.runId, callId: call.callId, signal: s.signal, depth, maxDepth, clock, update };
  let result: ToolResult;
  try {
    result = await tool.execute(input, ctx);
  } catch (error) {
    result = failure(`Tool "${tool.name}" failed: ${messageOf(error)}`);
  }
  const event = { ...hookBase(s), callId: call.callId, tool: tool.name, input, result };
  const patch = await guarded("afterToolCall", s.options.interceptors?.afterToolCall, event);
  return patch === undefined ? result : { ...result, ...patch };
}

/** The fields of the approval request for a call, which the signature covers along with the request's id. */
const pendingFields = (call: Call, input: unknown) => ({
  kind: "approval" as const,
  callId: call.callId,
  tool: call.name,
  input,
});

/** Signs a request for a person and holds it. The call has no result until `continueRun()` settles it. */
async function pause(
  s: State,
  call: Call,
  input: unknown,
  asked: { reason?: string; policyVersion?: string },
): Promise<void> {
  const { reason, policyVersion } = asked;
  const fields = defined({ ...pendingFields(call, input), reason, policyVersion });
  try {
    const request = await createPendingRequest(fields, s.signer, { generateId: s.nextId });
    hold(s, request, input);
    emit(s, { type: "approval_request", request, input });
  } catch {
    record(s, call, failure(`Tool call "${call.name}" was blocked: its approval request could not be signed.`));
  }
}

/** Puts a call's result in the transcript, and notes whether it ends the run or extends a failure streak. */
function record(s: State, call: Call, result: ToolResult): void {
  const isError = result.isError === true;
  append(s, { role: "tool", callId: call.callId, content: [...result.content], isError });
  if (s.options.output?.name === call.name && !isError) s.output = result.structured;
  if (result.terminate === true && !isError) s.ended = true;
  const key = `${call.name}:${JSON.stringify(call.input)}`;
  s.streak = isError ? { key, count: s.streak.key === key ? s.streak.count + 1 : 1 } : { key: "", count: 0 };
  emit(s, { type: "tool_call_end", callId: call.callId, result });
}

// --- Stop: the natural stop reason, then `shouldStop` and the progress rule -----------------------------------------

/** The stop reason the step's own facts give, or `undefined` when the run goes on. */
function stopCheck(s: State, message: AssistantMessage, answered: boolean): Outcome | undefined {
  if (message.stopReason === "error") return { stopReason: "error", error: errorOf(message) };
  if (message.stopReason === "aborted") return { stopReason: "aborted" };
  if (s.pending.length > 0) return { stopReason: "awaiting_approval", pending: [...s.pending] };
  if (answered || s.ended) return { stopReason: "done", output: s.output };
  if (s.signal.aborted) return { stopReason: "aborted" };
  return s.steps >= (s.options.maxSteps ?? DEFAULT_MAX_STEPS) ? { stopReason: "max_steps" } : undefined;
}

function errorOf({ error }: AssistantMessage): RunError {
  const { kind = "fatal", message = "the model call failed", status } = error ?? {};
  return { kind, message, ...(status === undefined ? {} : { status }) };
}

/** The default progress rule: the same call failing again and again. The real loop also has a per-key rule. */
function stuckReason(s: State): string | undefined {
  const { progress } = s.options;
  const limit =
    progress === false ? Number.POSITIVE_INFINITY : (progress?.maxIdenticalFailures ?? DEFAULT_MAX_FAILURES);
  return s.streak.count >= limit ? `${s.streak.count} identical failing calls in a row: ${s.streak.key}` : undefined;
}

/** A stop that the `shouldStop` interceptor or the progress rule asks for. */
function stopAsked(s: State, decision: StopDecision | undefined): Outcome | undefined {
  if (decision === true) return { stopReason: "stopped", stoppedBy: "hook" };
  if (typeof decision === "object" && "stop" in decision) {
    return decision.stop === "hook"
      ? { stopReason: "stopped", stoppedBy: decision.reason }
      : { stopReason: "no_progress", reason: decision.reason };
  }
  const reason = stuckReason(s);
  return reason === undefined ? undefined : { stopReason: "no_progress", reason };
}

/**
 * The stop check, then the `shouldStop` interceptor and the progress rule. A pause, an error, an abort or an output
 * tool's answer stands whatever they say. They can end a run that would go on, and the interceptor can keep going a
 * run the model ended by answering, until the step cap.
 */
async function decide(s: State, message: AssistantMessage, answered: boolean): Promise<Outcome | undefined> {
  const natural = stopCheck(s, message, answered);
  if (natural !== undefined && !(natural.stopReason === "done" && answered)) return natural;
  const event = { ...hookBase(s), messages: s.messages, lastMessage: message };
  const decision = await guarded("shouldStop", s.options.interceptors?.shouldStop, event);
  if (natural === undefined) return stopAsked(s, decision);
  const more = typeof decision === "object" && "continue" in decision ? decision.continue : undefined;
  if (more === undefined || stuckReason(s) !== undefined) return natural;
  if (s.steps >= (s.options.maxSteps ?? DEFAULT_MAX_STEPS)) return { stopReason: "max_steps" };
  append(s, { role: "user", content: typeof more === "string" ? textOf(more) : [...more] });
  return undefined;
}

// --- Resume: check each waiting call's stored request and its answer before anything runs ------------------------------

/** The calls of the transcript's last response that have no result, which a paused context waits on. */
function openCalls(messages: readonly Message[]): Call[] {
  const index = messages.findLastIndex((message) => message.role === "assistant");
  const last = messages[index];
  if (last?.role !== "assistant" || last.stopReason === "error" || last.stopReason === "aborted") return [];
  const answered = new Set(messages.slice(index + 1).flatMap((m) => (m.role === "tool" ? [m.callId] : [])));
  return last.content.filter((block): block is Call => block.type === "tool_call" && !answered.has(block.callId));
}

/**
 * Settles the calls a paused context waits on, in model order. A verified approval runs with the input its request
 * signs, a verified denial reaches the model as an error, a call with no answer keeps waiting, and a call whose
 * request or answer fails a check asks again with a new request. No model call is made here.
 */
async function settle(s: State, resume: Resume): Promise<Outcome | undefined> {
  for (const call of openCalls(s.messages)) await settleCall(s, call, resume);
  if (s.pending.length > 0) return { stopReason: "awaiting_approval", pending: [...s.pending] };
  return s.ended ? { stopReason: "done", output: s.output } : undefined;
}

async function settleCall(s: State, call: Call, { context, resolutions }: Resume): Promise<void> {
  const request = context.pending?.find((candidate) => candidate.callId === call.callId);
  if (request === undefined) {
    throw new SdkError("invalid_run_options", `continueRun() found the call "${call.callId}" with no pending request`);
  }
  const input = context.pendingInputs?.[request.id];
  const answer = resolutions.find((resolution) => resolution.requestId === request.id);
  const cause = await failedCheck(s, request, call, input, answer);
  if (cause !== undefined) {
    emit(s, { type: "resolution_rejected", requestId: request.id, callId: call.callId, cause });
    await pause(s, call, call.input, { reason: REISSUED });
  } else if (answer === undefined) {
    hold(s, request, input);
  } else if ("decision" in answer && answer.decision === "allow") {
    await runCall(s, call, s.tools, { input });
  } else {
    const why = "reason" in answer && answer.reason ? `: ${answer.reason}` : "";
    emit(s, { type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input });
    record(s, call, failure(`Tool call "${call.name}" was denied${why}`));
  }
}

/** Keeps a request that no one has answered, so the run ends paused again without a model call. */
function hold(s: State, request: SignedPendingRequest, input: unknown): void {
  s.pending.push(request);
  s.pendingInputs[request.id] = input;
}

/**
 * Why a request or its answer fails, or `undefined` when both pass. The input is checked against the request's hash
 * first; then the request is signed again from that input, and a request whose signature differs was not signed by
 * this signer for this call. This checks with the current key only, so it can't verify a request signed under an
 * older key, and a production check would also compare signatures in constant time, as the SDK's `verify` does.
 */
async function failedCheck(
  s: State,
  request: SignedPendingRequest,
  call: Call,
  input: unknown,
  answer: unknown,
): Promise<ResolutionRejectionCause | undefined> {
  if ((await canonicalInputHash(input).catch(() => undefined)) !== request.inputHash) return "input_changed";
  const fields = defined({ ...pendingFields(call, input), policyVersion: request.policyVersion });
  const again = await createPendingRequest(fields, s.signer, { generateId: () => request.id }).catch(() => undefined);
  if (again?.signature !== request.signature || again.keyId !== request.keyId) return "signature_invalid";
  const decision = (answer as { decision?: unknown } | undefined)?.decision;
  return answer !== undefined && decision !== "allow" && decision !== "deny" ? "resolution_mismatch" : undefined;
}
