/**
 * Code-initiated tool calls: a side effect the host's own code chose, run through the same permission pipeline, signed
 * pause and log as a call the model makes, with no model step. The `code_call` entry is written before anything else
 * of the call, and its id is the call id, so the effect key is fixed before the tool can run and a resume finds it.
 * A call starts once its log holds the entry that clears it to run; one that started with no result is never rerun.
 */
import { effectKey, renderOutcome, writeOutcome } from "@buildanagent/agent-safety";
import type { ContentBlock } from "@buildanagent/gateway";
import type { CodeCallEntry, Origin, SessionEntry } from "@buildanagent/protocol";
import {
  canonicalInputHash,
  createPendingRequest,
  type Resolution,
  type ToolContext,
  type ToolResult,
  verifyResolution,
} from "@buildanagent/sdk";
import type { Clock } from "@buildanagent/sdk/testing";
import { HarnessError } from "../errors.js";
import type { CodeCall, CodeCallResult, Harness } from "../harness.js";
import type { Decision, PolicySession } from "../permissions/types.js";
import type { RegisteredTool } from "../tools/types.js";
import { type CodeCallRecord, codeCallsOf, type WaitingCodeCall } from "./code-call-log.js";
import { writeCodeCallResult } from "./code-call-result.js";
import { effectScope } from "./effect-scope.js";
import { interruptedResult } from "./resume.js";
import { type ResolutionRecord, recordSessionStart } from "./runner.js";
import type { Session } from "./session.js";
import { findSticky, stickyDecision } from "./sticky.js";
import type { EntryInput } from "./store.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistributiveOmit<EntryInput, "id" | "parentId" | "timestamp" | "origin">;

/** How a code call writes: one entry at a time after the one before, with its ids and clock. */
interface Io {
  readonly session: Session;
  write(origin: Origin, body: Body, id?: string): Promise<SessionEntry>;
  readonly newId: () => string;
  readonly clock: Clock;
}

/** The settings both a call and its resolution take: where its ids and time come from. */
interface IoOptions {
  readonly clock?: Clock;
  readonly newId?: () => string;
}

/** What running a code call needs besides the tool: its host context and its signal. */
interface RunOptions<H> extends IoOptions {
  readonly hostContext?: H;
  readonly signal?: AbortSignal;
}

// The SDK's default nesting cap, so a tool that starts an agent from a code call nests as it would in a run.
const MAX_DEPTH = 2;

function ioOf(session: Session, options: IoOptions): Io {
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  return {
    session,
    newId,
    clock,
    async write(origin, body, id = newId()) {
      const entry = { ...body, id, parentId: session.head(), timestamp: clock.now(), origin } as EntryInput;
      const [stored] = await session.append([entry]);
      return stored as SessionEntry;
    },
  };
}

const invalid = (message: string, cause?: unknown) =>
  new HarnessError("invalid_code_call", message, cause === undefined ? {} : { cause });

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// One code call of a session runs at a time in a process: a second one would read the first one's open call as a crash.
// Another process is kept out by the session's lock.
const queues = new WeakMap<Session, Promise<unknown>>();

/** Runs `task` after every code call of `session` that this process started before it. */
export function inCodeCallQueue<T>(session: Session, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(session) ?? Promise.resolve()).then(task, task);
  queues.set(
    session,
    next.catch(() => undefined),
  );
  return next;
}

/** The registered tool a code call names, refused when the registry lacks it or only a client can run it. */
function toolFor<H>(harness: Harness<H>, name: string): RegisteredTool {
  const tool = harness.registry.get(name);
  if (tool === undefined) throw invalid(`no tool "${name}" is registered, so the code call can't run`);
  if (tool.pattern === "client_request") {
    throw invalid(`the tool "${tool.canonicalName}" runs on the client, which a code call has no way to reach`);
  }
  return tool;
}

async function hashOf(value: unknown, what: string): Promise<string> {
  try {
    return await canonicalInputHash(value);
  } catch (error) {
    throw invalid(`the code call's ${what} has no canonical JSON form`, error);
  }
}

/**
 * The call's effect key: from the tool's business key when it declares one, and from the scope of `callId` otherwise.
 * A tool the registry no longer has gets the scope's key.
 */
export async function codeCallEffectKey<H>(
  session: Session,
  harness: Harness<H>,
  tool: RegisteredTool | undefined,
  call: { readonly callId: string; readonly input: unknown },
): Promise<string> {
  const businessKey = tool?.definition.effect?.businessKey;
  try {
    return await effectKey(effectScope(session, harness, call.callId), businessKey?.(call.input));
  } catch (error) {
    throw invalid(`the effect key of the call to "${tool?.canonicalName}" could not be made`, error);
  }
}

/** Refuses a harness that can't decide or sign a code call, before anything is written. */
function checkHarness<H>(harness: Harness<H>): void {
  if (harness.pipeline === undefined) {
    throw invalid("the harness has no permission pipeline, so no code call can be decided");
  }
  if (harness.signer === undefined) {
    throw new HarnessError("approval_unavailable", "the harness has no signer, so a code call could not ask anyone");
  }
}

/**
 * Settles each code call a crash left open: writes the result it lacks. A call that started may have taken effect, so
 * it gets the result an interrupted model call gets. A call that never started never ran, so it gets an error that says
 * so: one that stopped before it could run or ask anyone, and one whose answer was written but which stopped, or was
 * refused, before it started. A call that asked and has no final answer still waits.
 */
async function settleCodeCalls<H>(path: readonly SessionEntry[], harness: Harness<H>, io: Io): Promise<void> {
  for (const { call, result, requested, answered, letRun } of codeCallsOf(path).values()) {
    if (result !== undefined || (requested !== undefined && !answered && !letRun)) continue;
    const body = letRun
      ? { origin: "tool" as const, ...interruptedResult(harness, call.tool) }
      : { origin: "harness" as const, ...notRun(answered ? NOT_RUN_ANSWERED : NOT_RUN_EARLY) };
    const { origin, ...fields } = body;
    await io.write(origin, { type: "tool_result", callId: call.callId, tool: call.tool, ...fields });
  }
}

const NOT_RUN_EARLY = "The code call stopped before it could run or ask anyone, so it never ran.";
const NOT_RUN_ANSWERED = "The code call stopped after its answer was written and before it could run, so it never ran.";

const notRun = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
  trust: "trusted" as const,
});

/** Refuses a compensation that names no code call that ran, or that would share that call's effect key. */
async function checkCompensation<H>(
  session: Session,
  harness: Harness<H>,
  records: ReadonlyMap<string, CodeCallRecord>,
  compensated: string,
  ownKey: string,
): Promise<void> {
  const target = records.get(compensated);
  // A denial is the harness's own result. A result from the tool, a crash's result, or a call let run that has no
  // result yet means the call ran or may have run.
  const ran = target?.result === undefined ? target?.letRun === true : target.result.origin === "tool";
  if (target === undefined || !ran) {
    throw invalid(`a compensation must name a code call that ran, and "${compensated}" names none`);
  }
  const theirs = await codeCallEffectKey(session, harness, harness.registry.get(target.call.tool), target.call);
  if (theirs === ownKey) {
    throw invalid("a compensation needs an effect key of its own, and this one has the key of the call it undoes");
  }
}

/** Writes an error result for a call that does not run, and returns the denial. */
async function deny(io: Io, call: CodeCallEntry, reason: string): Promise<CodeCallResult> {
  const entry = await io.write("harness", {
    type: "tool_result",
    callId: call.callId,
    tool: call.tool,
    ...notRun(reason),
  });
  return { status: "denied", callId: call.callId, reason, entryId: entry.id };
}

/** Decides the call with the pipeline, which writes its `permission_decision`, and keeps the policy version it used. */
async function decide<H>(
  harness: Harness<H>,
  session: Session,
  io: Io,
  call: CodeCallEntry,
  hostContext: H | undefined,
): Promise<{ decision: Decision; policyVersion: string | undefined }> {
  let policyVersion: string | undefined;
  const policySession: PolicySession = {
    append(entry) {
      if (entry.type === "permission_decision") policyVersion = entry.policyVersion;
      return io.write("harness", entry);
    },
  };
  // checkHarness() refused a harness without a pipeline before anything was written.
  const pipeline = harness.pipeline as NonNullable<Harness<H>["pipeline"]>;
  const decision = await pipeline.decide(
    { callId: call.callId, tool: call.tool, input: call.input, initiator: "code" },
    { session: policySession, hostContext, entries: await session.path() },
  );
  return { decision, policyVersion: policyVersion === "" ? undefined : policyVersion };
}

const isContentList = (content: unknown): content is ToolResult["content"] =>
  Array.isArray(content) &&
  content.every(
    (block: Partial<ContentBlock> | null) =>
      (block?.type === "text" && typeof block.text === "string") ||
      (block?.type === "image" && typeof block.mediaType === "string" && typeof block.data === "string"),
  );

/** A result with its write outcome's sentence in front of its content, as the model would read it. */
function withOutcome(result: ToolResult<unknown>): ToolResult<unknown> {
  if (!isContentList(result?.content)) throw new TypeError("the tool returned content that is not text and images");
  if (result.outcome === undefined) return result;
  const rendered = renderOutcome(result.outcome);
  return {
    ...result,
    content: [
      { type: "text", text: rendered.text },
      { type: "text", text: JSON.stringify({ outcome: rendered.payload }) },
      ...result.content,
    ],
    isError: result.isError === true || rendered.isError,
  };
}

/** The result of a tool that threw or returned something unusable: a write's outcome is unknown, since it may have run. */
function thrownResult(tool: RegisteredTool, error: unknown): ToolResult<unknown> {
  const text = tool.definition.redactErrors === true ? "The tool failed." : `The tool failed: ${describe(error)}`;
  if (tool.definition.effect?.kind !== "write") return { content: [{ type: "text", text }], isError: true };
  const rendered = renderOutcome(
    writeOutcome({
      kind: "unknown",
      operation: tool.canonicalName,
      retry: "reconcile_first",
      reason: "WRITE_FAILED",
      currentState: "The tool failed before it returned, so the write may have taken effect.",
      next: "Check whether it took effect before you do anything else.",
    }),
  );
  return {
    content: [
      { type: "text", text: rendered.text },
      { type: "text", text: JSON.stringify({ outcome: rendered.payload }) },
      { type: "text", text },
    ],
    isError: true,
    details: { outcome: rendered.payload },
  };
}

/**
 * Runs the tool through the harness's wrapper with the host context, and writes its result. The harness's interceptors
 * and observers belong to a turn's model step, so they don't run here; the pipeline already decided the call.
 */
async function runTool<H>(
  harness: Harness<H>,
  io: Io,
  tool: RegisteredTool,
  call: CodeCallEntry,
  options: RunOptions<H> & { readonly effectKey: string },
): Promise<CodeCallResult> {
  const ctx: ToolContext<unknown> = {
    runId: call.callId,
    callId: call.callId,
    signal: options.signal ?? new AbortController().signal,
    depth: 0,
    maxDepth: MAX_DEPTH,
    clock: io.clock,
    app: options.hostContext,
    update: () => undefined,
  };
  let result: ToolResult<unknown>;
  // A wrapper that throws is recorded like a tool that throws, so the call that was let run still gets a result.
  try {
    const definition = harness.wrap === undefined ? tool.definition : harness.wrap(tool, options.hostContext as H);
    result = withOutcome(await definition.execute(call.input, ctx));
  } catch (error) {
    result = thrownResult(tool, error);
  }
  const writer = {
    session: io.session,
    now: io.clock.now,
    signal: ctx.signal,
    write: (body: Body) => io.write("tool", body),
  };
  const entry = await writeCodeCallResult(harness, writer, tool, call, result);
  return { status: "done", callId: call.callId, result, entryId: entry.id, effectKey: options.effectKey };
}

/** Signs the request for a call the pipeline asks about, and writes it before anyone can hear of it. */
async function ask<H>(
  harness: Harness<H>,
  io: Io,
  call: CodeCallEntry,
  decision: { reason: string; policyVersion: string | undefined; hostContext: H | undefined; effectKey: string },
): Promise<CodeCallResult> {
  const { reason, policyVersion, hostContext } = decision;
  const pending = await createPendingRequest(
    {
      kind: "approval",
      callId: call.callId,
      tool: call.tool,
      input: call.input,
      ...(policyVersion === undefined ? {} : { policyVersion }),
      ...(reason === "" ? {} : { reason }),
      ...(hostContext === undefined ? {} : { app: hostContext }),
    },
    // checkHarness() refused a harness without a signer before anything was written.
    harness.signer as NonNullable<Harness<H>["signer"]>,
    { generateId: io.newId, now: () => new Date(io.clock.now()) },
  );
  await io.write("harness", { type: "approval_requested", request: pending, input: call.input });
  return { status: "awaiting_approval", callId: call.callId, pending, effectKey: decision.effectKey };
}

/** Checks everything a code call needs before its first entry, and returns its tool, input hash and effect key. */
async function prepare<H>(harness: Harness<H>, session: Session, call: CodeCall<H>, callId: string) {
  checkHarness(harness);
  const tool = toolFor(harness, call.tool);
  const inputHash = await hashOf(call.input, "input");
  if (call.hostContext !== undefined) await hashOf(call.hostContext, "host context");
  const key = await codeCallEffectKey(session, harness, tool, { callId, input: call.input });
  return { tool, inputHash, key };
}

/** `Harness.invokeTool()`: see its documentation. */
export async function invokeCodeCall<H>(
  harness: Harness<H>,
  session: Session,
  call: CodeCall<H>,
): Promise<CodeCallResult> {
  // Checked before the queue too, so an aborted call never waits behind another.
  call.signal?.throwIfAborted();
  return inCodeCallQueue(session, () => invokeQueued(harness, session, call));
}

async function invokeQueued<H>(harness: Harness<H>, session: Session, call: CodeCall<H>): Promise<CodeCallResult> {
  const io = ioOf(session, call);
  const callId = io.newId();
  const { tool, inputHash, key } = await prepare(harness, session, call, callId);
  const path = await session.path();
  if (call.compensates !== undefined) {
    await checkCompensation(session, harness, codeCallsOf(path), call.compensates, key);
  }
  call.signal?.throwIfAborted();
  await recordSessionStart(harness, (origin, body) => io.write(origin, body), harness.model, path);
  await settleCodeCalls(await session.path(), harness, io);
  const entry: CodeCallEntry = {
    type: "code_call",
    callId,
    tool: tool.canonicalName,
    input: call.input,
    inputHash,
    ...(call.compensates === undefined ? {} : { compensates: call.compensates }),
  };
  await io.write("harness", entry, callId);
  const { decision, policyVersion } = await decide(harness, session, io, entry, call.hostContext);
  if (decision.decision === "deny") return deny(io, entry, decision.reason);
  const run = { ...call, effectKey: key };
  if (decision.decision === "allow") return runTool(harness, io, tool, entry, run);
  const covered = await findSticky(await session.path(), { ...entry, policyVersion }, harness.registry);
  if (covered === undefined) {
    return ask(harness, io, entry, {
      reason: decision.reason,
      policyVersion,
      hostContext: call.hostContext,
      effectKey: key,
    });
  }
  await io.write("harness", await stickyDecision(entry, covered, policyVersion));
  return runTool(harness, io, tool, entry, run);
}

/**
 * Checks a resolution against the waiting call's signed request before anything is written: the signature under a key
 * the signer holds, the host context the request binds, the call and tool, and the input, which must hash to the signed
 * hash in the `code_call` entry, in the `approval_requested` entry and in the request alike. Throws `approval_refused`
 * with the cause, which names no key, signature or input.
 */
export async function checkCodeCallRequest<H>(
  harness: Harness<H>,
  waiting: WaitingCodeCall,
  resolution: Resolution,
  hostContext: H | undefined,
): Promise<void> {
  const { call, request, input } = waiting;
  const check = await verifyResolution(request, resolution, {
    signer: harness.signer as NonNullable<Harness<H>["signer"]>,
    call: { callId: call.callId, tool: call.tool, input: call.input },
    ...(hostContext === undefined ? {} : { app: hostContext }),
  });
  const cause = check.ok ? await inputCause(call, input) : check.cause;
  if (cause !== undefined) {
    throw new HarnessError(
      "approval_refused",
      `the request for code call ${call.callId} failed its check (${cause}), so nothing ran and nothing was written`,
    );
  }
}

/** `input_changed` unless the recorded input and the input shown to the approver both hash to the recorded hash. */
async function inputCause(call: CodeCallEntry, shown: unknown): Promise<"input_changed" | undefined> {
  const hash = async (value: unknown) => canonicalInputHash(value).catch(() => undefined);
  const [recorded, asked] = await Promise.all([hash(call.input), hash(shown)]);
  return recorded === call.inputHash && asked === call.inputHash ? undefined : "input_changed";
}

/** What the resolution of a code call is given: the answer the quorum settled on, if any, and the entries to write. */
export interface SettledCodeCall {
  readonly forRun: Resolution | undefined;
  readonly records: readonly ResolutionRecord[];
  readonly effectKey: string;
}

/**
 * Applies a code call's settled resolution: it writes the answers, then leaves the call waiting when the quorum still
 * waits, denies it for a person's or the policy's refusal, and otherwise decides it again with the pipeline, so a deny
 * written since the pause wins, and runs the tool itself, with no model step.
 */
export async function finishCodeCall<H>(
  harness: Harness<H>,
  session: Session,
  waiting: WaitingCodeCall,
  settled: SettledCodeCall,
  options: RunOptions<H>,
): Promise<CodeCallResult> {
  options.signal?.throwIfAborted();
  const io = ioOf(session, options);
  for (const record of settled.records) await io.write("user", { type: "approval_resolved", ...record });
  const { call } = waiting;
  const { forRun, effectKey: key } = settled;
  if (forRun === undefined) {
    return { status: "awaiting_approval", callId: call.callId, pending: waiting.request, effectKey: key };
  }
  if (!("decision" in forRun) || forRun.decision !== "allow") {
    return deny(io, call, ("reason" in forRun ? forRun.reason : undefined) ?? "A person denied the call.");
  }
  const tool = harness.registry.get(call.tool);
  if (tool?.canonicalName !== call.tool || tool.pattern !== "in_process") {
    return deny(io, call, `The tool "${call.tool}" is no longer registered for code calls, so the call did not run.`);
  }
  const { decision } = await decide(harness, session, io, call, options.hostContext);
  // A person approved the call, so a question the pipeline would ask again doesn't stop it; a deny does.
  if (decision.decision === "deny") return deny(io, call, decision.reason);
  return runTool(harness, io, tool, call, { ...options, effectKey: key });
}
