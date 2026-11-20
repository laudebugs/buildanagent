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
  type Model,
  type ModelContext,
  projectCallCost,
  type WireTool,
} from "@buildanagent/gateway";
import {
  type AgentEvent,
  type AgentEventBody,
  type ApprovalSigner,
  type CallOptions,
  type Context,
  type ContinueOptions,
  canonicalInputHash,
  createPendingRequest,
  ephemeralSigner,
  type GateDecision,
  type ModelCallPatch,
  type Resolution,
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
  verifyResolution,
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
  /** The run's id and every request id in use, which a new request never takes. */
  readonly usedIds: Set<string>;
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
const TRUNCATED =
  "was not run, because the response was cut off at the output limit. Re-issue it in a shorter response.";
const CANCELLED = (tool: string) => `Tool "${tool}" was not run, because the run was cancelled.`;
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
  const runId = nextId();
  const state: State = {
    runId,
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
    usedIds: new Set([runId]),
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
    // A hook that failed because the run was aborted, such as a fetch that honours the signal, ends it `aborted`.
    const failed: Outcome = { stopReason: "error", error: { kind: "hook", message: error.message } satisfies RunError };
    outcome = s.signal.aborted ? { stopReason: "aborted" } : failed;
  }
  const paused =
    outcome.stopReason === "awaiting_approval" ? { pending: s.pending, pendingInputs: s.pendingInputs } : {};
  const context = { system: s.system, messages: s.messages, ...paused };
  const result = { messages: s.added, context, usage: s.usage, cost: s.cost ?? NO_COST, steps: s.steps, ...outcome };
  emit(s, { type: "run_end", result: result as RunResult });
  return result as RunResult;
}

// --- One step: transform, before, stream, after, tools, stop -----------------------------------------------------

async function step(s: State): Promise<Outcome | undefined> {
  s.stepIndex = s.steps;
  emit(s, { type: "step_start" });
  const called = await callModel(s);
  return "outcome" in called ? called.outcome : runCalls(s, called.message, called.active);
}

/** The fields every interceptor event carries. */
function hookBase(s: State) {
  const timestamp = (s.options.clock ?? SYSTEM_CLOCK).now();
  return { runId: s.runId, stepIndex: s.stepIndex, signal: s.signal, timestamp };
}

/** Calls a model-moment interceptor or `shouldStop`, if there is one. A throw becomes a `HookFailure`: the run fails closed. */
async function guarded<E, R>(name: string, hook: ((event: E) => R | Promise<R>) | undefined, event: E) {
  if (hook === undefined) return undefined;
  try {
    return await hook(event);
  } catch (error) {
    throw new HookFailure(`the ${name} interceptor threw: ${messageOf(error)}`);
  }
}

const sentTools = (s: State) => s.tools.filter((tool) => (tool.exposure ?? "direct") === "direct");

/**
 * The tools a model call sends: the direct ones, or those `beforeModelCall`'s `activeTools` names, in definition
 * order. A name of no tool is a programmer error.
 */
function named(s: State, names: readonly string[] | undefined): Tool[] {
  if (names === undefined) return sentTools(s);
  const unknown = names.filter((name) => !s.tools.some((tool) => tool.name === name));
  if (unknown.length > 0) throw new SdkError("invalid_hook_result", `activeTools names unknown tools: ${unknown}`);
  return s.tools.filter((tool) => names.includes(tool.name));
}

type Called = { message: AssistantMessage; active: readonly Tool[] } | { outcome: Outcome };

async function callModel(s: State): Promise<Called> {
  const { model, modelOptions = {}, interceptors: hooks = {} } = s.options;
  const base = hookBase(s);
  // transform: a view of the transcript for this call alone
  const transform = { ...base, system: s.system, messages: s.messages, model: model.ref };
  const view = await guarded("transformContext", hooks.transformContext, transform);
  let context = { system: s.system, messages: [...(view ?? s.messages)], tools: sentTools(s).map(wireOf) };
  // before: the interceptor may change this call's system prompt, messages, tools, model or options
  const before = { ...base, context, options: modelOptions };
  const patch: ModelCallPatch = (await guarded("beforeModelCall", hooks.beforeModelCall, before)) ?? {};
  const { system = s.system, messages = context.messages, model: used = model, options = modelOptions } = patch;
  const active = named(s, patch.activeTools);
  context = { system, messages: [...messages], tools: active.map(wireOf) };
  const refused = budgetBlock(s, used, options, context);
  if (refused !== undefined) return { outcome: refused };
  // stream: forward the text, keep the final message
  let message: AssistantMessage | undefined;
  for await (const event of used.stream(context, { ...options, signal: s.signal })) {
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
  return { message: kept, active };
}

/** The budget: the spend so far plus this call's projected cost must fit, and an unknown price fails closed. */
function budgetBlock(s: State, model: Model, options: CallOptions, context: ModelContext): Outcome | undefined {
  const { budgetUsd } = s.options;
  if (budgetUsd === undefined) return undefined;
  const projected = projectCallCost(model, context, options).total;
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
function wireOf({ name, description, inputSchema: schema }: Tool): WireTool {
  const inputSchema = isStandard(schema) ? schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) : schema;
  return { name, description, inputSchema: inputSchema as Record<string, unknown> };
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

/**
 * Runs the response's calls in order. A call a gate paused gets no result; the other calls run as usual. A response
 * cut off at the output limit runs none of its calls, because their arguments may be incomplete.
 */
async function runCalls(s: State, message: AssistantMessage, tools: readonly Tool[]): Promise<Outcome | undefined> {
  const calls = message.content.filter((block): block is Call => block.type === "tool_call");
  if (message.stopReason !== "error" && message.stopReason !== "aborted") {
    for (const call of calls) await runCall(s, call, tools, message.stopReason === "length" ? "truncated" : "new");
  }
  return decide(s, message, calls.length === 0);
}

/**
 * How a call comes to run: `new` from the model, `truncated` from a cut-off response, `reissue` after its stored
 * request failed a check, so it must ask again whatever the gate allows, or `approved` with the input a person approved.
 */
type Mode = "new" | "truncated" | "reissue" | { readonly approved: unknown };

/**
 * Runs one call. An approved call skips the gate and runs with exactly the input its request signs, never the
 * transcript's arguments and never the schema's output. A gate that throws denies the call.
 */
async function runCall(s: State, call: Call, tools: readonly Tool[], mode: Mode): Promise<void> {
  emit(s, { type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input });
  if (mode === "truncated") return record(s, call, failure(`Tool "${call.name}" ${TRUNCATED}`));
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (tool === undefined)
    return record(s, call, failure(`Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}`));
  if (s.signal.aborted) return record(s, call, failure(CANCELLED(tool.name)));
  const approved = typeof mode === "object" ? mode : undefined;
  const checked = await validate(tool, approved === undefined ? call.input : approved.approved);
  if ("problem" in checked) return record(s, call, failure(`Invalid input for "${tool.name}": ${checked.problem}`));
  if (approved !== undefined) return record(s, call, await execute(s, tool, call, approved.approved));
  const hook = s.options.interceptors?.beforeToolCall;
  let gate: GateDecision = { decision: "allow" };
  try {
    if (hook !== undefined)
      gate = await hook({ ...hookBase(s), callId: call.callId, tool: tool.name, input: checked.value });
  } catch {
    return record(s, call, failure(`Tool call "${tool.name}" was not run, because its permission check failed.`));
  }
  if (gate.decision === "deny") return record(s, call, failure(`Tool call "${tool.name}" was denied: ${gate.reason}`));
  // A call never runs with input its tool rejects, so a gate's replacement must pass the schema too.
  const replaced = gate.input === undefined ? checked : await validate(tool, gate.input);
  if ("problem" in replaced)
    throw new SdkError("invalid_hook_result", `a gate's input for ${tool.name}: ${replaced.problem}`);
  const input = replaced.value;
  if (gate.decision === "ask") return pause(s, call, input, gate.reason, gate.policyVersion);
  if (mode === "reissue") return pause(s, call, input, REISSUED);
  await record(s, call, await execute(s, tool, call, input));
}

/**
 * Runs the tool, then `afterToolCall`. A tool that throws gives the model an error result, not a failed run, and an
 * `afterToolCall` that throws withholds the result but says the tool ran, so the model doesn't retry a write.
 */
async function execute(s: State, tool: Tool, call: Call, input: unknown): Promise<ToolResult> {
  if (s.signal.aborted) return failure(CANCELLED(tool.name));
  const update = (details: unknown) => emit(s, { type: "tool_call_update", callId: call.callId, details });
  const { depth = 0, maxDepth = 2, clock = SYSTEM_CLOCK } = s.options;
  const ctx: ToolContext = { runId: s.runId, callId: call.callId, signal: s.signal, depth, maxDepth, clock, update };
  const attempt = async () => tool.execute(input, ctx);
  const result = await attempt().catch((error: unknown) => failure(`Tool "${tool.name}" failed: ${messageOf(error)}`));
  const hook = s.options.interceptors?.afterToolCall;
  try {
    const patch = await hook?.({ ...hookBase(s), callId: call.callId, tool: tool.name, input, result });
    return patch ? { ...result, ...patch } : result;
  } catch {
    const withheld = failure(`Tool call "${tool.name}" ran, but its result check failed, so its result was withheld.`);
    return result.outcome === undefined ? withheld : { ...withheld, outcome: result.outcome };
  }
}

/** The next request id. One `idGenerator` repeats, or one already in use, falls back to a random UUID. */
function freshId(s: State): string {
  const id = s.nextId();
  return s.usedIds.has(id) ? crypto.randomUUID() : id;
}

/** Signs a request for a person and holds it. The call has no result until `continueRun()` settles it. */
async function pause(s: State, call: Call, input: unknown, reason?: string, policyVersion?: string): Promise<void> {
  // A blank reason is display text only, so it is left out rather than failing the signature.
  const optional = defined({ reason: reason || undefined, policyVersion });
  const fields = { kind: "approval" as const, callId: call.callId, tool: call.name, input, ...optional };
  try {
    const request = await createPendingRequest(fields, s.signer, { generateId: () => freshId(s) });
    hold(s, request, input);
    emit(s, { type: "approval_request", request, input });
  } catch {
    await record(s, call, failure(`Tool call "${call.name}" was blocked: its approval request could not be signed.`));
  }
}

/**
 * Puts a call's result in the transcript, and notes whether it ends the run or extends a failure streak. Inputs
 * compare by `canonicalInputHash()`, so key order doesn't matter; one with no canonical form matches nothing.
 */
async function record(s: State, call: Call, result: ToolResult): Promise<void> {
  const isError = result.isError === true;
  append(s, { role: "tool", callId: call.callId, content: [...result.content], isError });
  if (s.options.output?.name === call.name && !isError) s.output = result.structured;
  if (result.terminate === true && !isError) s.ended = true;
  const key = `${call.name}:${await canonicalInputHash(call.input).catch(() => crypto.randomUUID())}`;
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
  const max = progress === false ? Number.POSITIVE_INFINITY : (progress?.maxIdenticalFailures ?? DEFAULT_MAX_FAILURES);
  return s.streak.count >= max ? `${s.streak.count} identical failing calls in a row: ${s.streak.key}` : undefined;
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
 * request or answer fails a check asks again through the gate, with a new request. No model call is made here.
 */
async function settle(s: State, resume: Resume): Promise<Outcome | undefined> {
  for (const request of resume.context.pending ?? []) s.usedIds.add(request.id);
  for (const call of openCalls(s.messages)) await settleCall(s, call, resume);
  // These results answer calls from before this run, which the progress rule doesn't count.
  s.streak = { key: "", count: 0 };
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
    // Nothing verified this call, so only a tool the model is sent may ask again, and the gate decides as for a new call.
    await runCall(s, call, sentTools(s), "reissue");
  } else if (answer === undefined) {
    hold(s, request, input);
  } else if ("decision" in answer && answer.decision === "allow") {
    await runCall(s, call, s.tools, { approved: input });
  } else {
    const why = "reason" in answer && answer.reason ? `: ${answer.reason}` : "";
    emit(s, { type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input });
    await record(s, call, failure(`Tool call "${call.name}" was denied${why}`));
  }
}

/** Keeps a request that no one has answered, so the run ends paused again without a model call. */
function hold(s: State, request: SignedPendingRequest, input: unknown): void {
  s.usedIds.add(request.id);
  s.pending.push(request);
  s.pendingInputs[request.id] = input;
}

/**
 * Why a request or its answer fails, or `undefined` when both pass. `verifyResolution()` checks the signature under
 * the key the request names, then the call, the input's hash and the answer's kind. A request no one answered is
 * checked with a denial, which fits an approval.
 */
async function failedCheck(s: State, request: SignedPendingRequest, call: Call, input: unknown, answer?: Resolution) {
  const probe = answer ?? { requestId: request.id, decision: "deny" };
  const options = { signer: s.signer, call: { callId: call.callId, tool: call.name, input } };
  // A custom signer whose verify() throws fails the check.
  const check = await verifyResolution(request, probe, options).catch(() => undefined);
  return check === undefined ? "error" : check.ok ? undefined : check.cause;
}
