/**
 * `runTurn()`: one SDK run, written into a session's log. The user entries are durable before the run starts, so a turn
 * that dies before its first model call leaves the question in the file. The run's own events then become entries
 * through one observer: a message's blocks and end when its call ends, a tool's result when the call ends, usage, and the
 * turn's end. Every write goes through one queue, so the permission pipeline's entries and the observer's never race for
 * the same parent.
 */
import { addCost, addUsage, type ContentBlock, type Message, type Model, type ModelRef } from "@buildanagent/gateway";
import { FORMAT_VERSION, type Origin, type SessionEntry } from "@buildanagent/protocol";
import {
  type AgentEvent,
  CAPABILITIES,
  type CallOptions,
  canonicalInputHash,
  composeInterceptors,
  continueRun,
  DEFAULTS_HASH,
  type Interceptors,
  type Observer,
  type Recheck,
  type Resolution,
  type Run,
  type RunResult,
  run,
  SDK_VERSION,
  type ToolDefinition,
} from "@buildanagent/sdk";
import type { Clock } from "@buildanagent/sdk/testing";
import type { ContextFill, TurnContext } from "../context/types.js";
import { HarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import type { PolicySession } from "../permissions/types.js";
import { contextOf } from "./rebuild.js";
import { settleOpenCalls, unansweredCalls } from "./resume.js";
import type { Session } from "./session.js";
import { findSticky } from "./sticky.js";
import type { EntryInput } from "./store.js";

/** The options of one turn. Anything left out takes the harness's setting. */
export interface TurnOptions<H = unknown> {
  readonly input: string | ContentBlock[];
  /** The `origin` of the input blocks: `operator` for text the host wrote, such as a scheduled prompt. Default `user`. */
  readonly inputOrigin?: "user" | "operator";
  readonly budgetUsd?: number;
  readonly signal?: AbortSignal;
  /** This turn's host context. A tool reads it as `ctx.app`; it reaches no schema, event or entry. */
  readonly hostContext?: H;
  readonly system?: string;
  /** The registered tools this turn may use, by name or alias. A name the registry lacks throws. Default every tool. */
  readonly tools?: readonly string[];
  readonly output?: ToolDefinition<unknown, unknown, unknown>;
  /** The model for this turn. A change from the session's last model is recorded as a `loadout` entry. */
  readonly model?: Model;
  readonly maxSteps?: number;
  /** How many times the loop re-issues a call that ended with a retryable error. Default none. */
  readonly turnRetries?: number;
  readonly modelOptions?: CallOptions;
  /** Called with the run as soon as it starts, so a caller can `steer()`, `followUp()` or abort it. */
  readonly onRun?: (run: Run<unknown>) => void;
  /** Called with how full the request view is after each model call's view is built, when the harness has a context policy. */
  readonly onContextFill?: (fill: ContextFill) => void;
  /** Observers for this turn alone. Unlike `Run.on()`, they also see `run_start`. They run after the harness's own. */
  readonly observers?: readonly Observer[];
  /**
   * The conversation so far. Left out, it is rebuilt from the session's log, so a turn in any process goes on from
   * what the log holds. Pass it only to run on a conversation the log doesn't hold.
   */
  readonly history?: readonly Message[];
  /** The clock of the entries and the run, for a test that needs the same bytes twice. Default the system clock. */
  readonly clock?: Clock;
  /** Makes the ids of the entries and of the run, for a test that needs the same bytes twice. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/** What a turn returns: the SDK's result, and where the turn left the log. */
export type TurnResult = RunResult<unknown> & { sessionKey: string; lastEntryId: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistributiveOmit<EntryInput, "id" | "parentId" | "timestamp" | "origin">;

/** Writes entries one at a time, each after the one before, so every entry's parent is the entry before it. */
class EntryWriter {
  readonly #session: Session;
  readonly #newId: () => string;
  readonly #now: () => Date;
  readonly #onFailure: () => void;
  #chain: Promise<unknown> = Promise.resolve();
  #failure: unknown;
  #failed = false;

  constructor(session: Session, newId: () => string, now: () => Date, onFailure: () => void) {
    this.#session = session;
    this.#newId = newId;
    this.#now = now;
    this.#onFailure = onFailure;
  }

  /** The first write that failed, once one has. */
  failure(): { readonly error: unknown } | undefined {
    return this.#failed ? { error: this.#failure } : undefined;
  }

  write(origin: Origin, body: Body): Promise<SessionEntry> {
    const next = this.#chain.then(async () => {
      if (this.#failed) throw this.#failure;
      const entry = {
        ...body,
        id: this.#newId(),
        parentId: this.#session.head(),
        timestamp: this.#now().toISOString(),
        origin,
      };
      const [stored] = await this.#session.append([entry as EntryInput]);
      return stored as SessionEntry;
    });
    this.#chain = next.catch((error) => {
      if (!this.#failed) {
        this.#failed = true;
        this.#failure = error;
        // A log that can't be written can't be trusted to hold the turn, so the run stops.
        this.#onFailure();
      }
    });
    return next;
  }

  /** Waits for every write queued so far. */
  settled(): Promise<unknown> {
    return this.#chain;
  }
}

const refKey = (ref: ModelRef): string => `${ref.api}\u0000${ref.provider}\u0000${ref.id}`;

/** The turn's tools: the registry's definitions for this host context, cut to the allowlist. */
function toolsOf<H>(harness: Harness<H>, options: TurnOptions<H>): ToolDefinition<unknown, unknown, unknown>[] {
  const all = harness.registry.definitions(harness.wrap, options.hostContext as H);
  if (options.tools === undefined) return all;
  const allowed = new Set<string>();
  for (const name of options.tools) {
    const tool = harness.registry.get(name);
    if (tool === undefined)
      throw new HarnessError(
        "invalid_turn_options",
        `the tool allowlist names "${name}", which no tool is registered under`,
      );
    allowed.add(tool.canonicalName);
  }
  return all.filter((definition) => allowed.has(definition.name));
}

/** Writes what a new session starts with, and a `loadout` when the tools or the model differ from the last one recorded. */
async function recordLoadout<H>(
  harness: Harness<H>,
  writer: EntryWriter,
  model: Model,
  tools: readonly ToolDefinition<unknown, unknown, unknown>[],
  started: readonly SessionEntry[],
): Promise<void> {
  if (started.length === 0) {
    await writer.write("harness", {
      type: "session_header",
      formatVersion: FORMAT_VERSION,
      harnessVersion: harness.harnessVersion,
      sdkVersion: SDK_VERSION,
      defaultsHash: DEFAULTS_HASH,
      capabilities: [...CAPABILITIES],
      ablationHash: harness.ablationHash,
    });
  }
  if (!started.some((entry) => entry.type === "env_stamp")) {
    await writer.write("harness", { type: "env_stamp", ...harness.env, model: model.ref });
  }
  const names = tools.map((tool) => tool.name);
  const last = started.findLast((entry) => entry.type === "loadout");
  const same =
    last?.type === "loadout" &&
    last.model !== undefined &&
    refKey(last.model) === refKey(model.ref) &&
    [...last.tools].sort().join() === [...names].sort().join();
  if (!same) await writer.write("harness", { type: "loadout", tools: names, model: model.ref });
}

async function writeInput(
  writer: EntryWriter,
  options: { input: string | ContentBlock[]; inputOrigin?: "user" | "operator" },
  newId: () => string,
) {
  const blocks: ContentBlock[] =
    typeof options.input === "string" ? [{ type: "text", text: options.input }] : options.input;
  const messageId = newId();
  for (const [index, block] of blocks.entries()) {
    await writer.write(options.inputOrigin ?? "user", {
      type: "message_block",
      messageId,
      role: "user",
      index,
      block,
      delivery: "input",
    });
  }
}

type ModelMessage = Extract<AgentEvent, { type: "model_call_end" }>["message"];

/** Turns the run's events into entries. It keeps the last model message back until the next event shows it was kept. */
class EventRecorder {
  readonly #writer: EntryWriter;
  readonly #harness: Harness<unknown>;
  readonly #system: string;
  readonly #newId: () => string;
  readonly #tools = new Map<string, string>();
  #pending: ModelMessage | undefined;

  readonly #mode: "run" | "continue";
  readonly #spillOf: TurnContext["spillOf"] | undefined;

  constructor(
    writer: EntryWriter,
    harness: Harness<unknown>,
    system: string,
    newId: () => string,
    mode: "run" | "continue" = "run",
    spillOf?: TurnContext["spillOf"],
  ) {
    this.#spillOf = spillOf;
    this.#mode = mode;
    this.#writer = writer;
    this.#harness = harness;
    this.#system = system;
    this.#newId = newId;
  }

  /** Queues a write and returns at once. A failure is recorded by the writer and rethrown by `runTurn()`. */
  #queue(origin: Origin, body: Body): void {
    this.#writer.write(origin, body).catch(() => undefined);
  }

  #usage(message: ModelMessage): void {
    this.#queue("harness", {
      type: "usage",
      source: "model_call",
      usage: message.usage,
      ...(message.lastAttemptUsage === undefined ? {} : { lastAttemptUsage: message.lastAttemptUsage }),
      cost: message.cost,
    });
  }

  /**
   * Queues the held-back message: its blocks, its end and its usage. The gate calls it before it writes, so a call's
   * decision never lands ahead of the message that made the call.
   */
  flush(): void {
    const message = this.#pending;
    if (message === undefined) return;
    this.#pending = undefined;
    const messageId = this.#newId();
    for (const [index, block] of message.content.entries()) {
      this.#queue("model", { type: "message_block", messageId, role: "assistant", index, block });
    }
    this.#queue("model", {
      type: "message_end",
      messageId,
      model: message.model,
      stopReason: message.stopReason,
      ...(message.error === undefined ? {} : { error: message.error }),
    });
    this.#usage(message);
  }

  /** Handles an event without waiting for the store, so the observer is never behind and the SDK never drops it. */
  handle(event: AgentEvent): void {
    if (event.type === "retry" && event.layer === "turn" && this.#pending !== undefined) {
      // The call's message is superseded and not in the transcript, but the provider billed it.
      const superseded = this.#pending;
      this.#pending = undefined;
      this.#usage(superseded);
      return;
    }
    this.flush();
    this.#record(event);
  }

  #record(event: AgentEvent): void {
    switch (event.type) {
      case "run_start":
        this.#queue("harness", {
          type: "turn_start",
          runId: event.runId,
          mode: this.#mode,
          system: this.#system,
        });
        return;
      case "approval_request":
        // The request is in the log before any client hears of it: the harness's own observers wait for the writes.
        this.#queue("harness", { type: "approval_requested", request: event.request, input: event.input });
        return;
      case "model_call_end":
        this.#pending = event.message;
        // A call the SDK refuses to start (unknown tool, bad input) gets no tool_call_start, so its name comes from here.
        for (const block of event.message.content) {
          if (block.type === "tool_call") this.#tools.set(block.callId, block.name);
        }
        return;
      case "tool_call_start":
        this.#tools.set(event.callId, event.tool);
        return;
      case "tool_call_end":
        this.#toolResult(event);
        return;
      case "steer_applied":
        for (const [index, block] of event.receipt.message.entries()) {
          this.#queue("user", {
            type: "message_block",
            messageId: event.receipt.id,
            role: "user",
            index,
            block,
            delivery: event.receipt.kind,
          });
        }
        return;
      case "run_end":
        this.#queue("harness", {
          type: "turn_end",
          runId: event.runId,
          stopReason: event.result.stopReason,
          steps: event.result.steps,
        });
        return;
      default:
    }
  }

  #toolResult(event: Extract<AgentEvent, { type: "tool_call_end" }>): void {
    const tool = this.#tools.get(event.callId) ?? "";
    const trust = this.#harness.registry.get(tool)?.outputTrust ?? "untrusted";
    const { result } = event;
    const spill = this.#spillOf?.(event.callId);
    this.#queue("tool", {
      type: "tool_result",
      callId: event.callId,
      tool,
      content: [...result.content],
      isError: result.isError === true,
      ...(result.details === undefined ? {} : { details: result.details }),
      ...(spill === undefined ? {} : { spill }),
      trust,
    });
  }
}

/** What the layers that write inside a run are given: the turn's writer, and a way to wait for the run's entries. */
function attachment(writer: EntryWriter, recorder: EventRecorder) {
  return {
    append: (origin: Origin, body: Body) => writer.write(origin, body),
    settle: async () => {
      recorder.flush();
      await writer.settled();
    },
  };
}

/** The turn's context layers, when the harness has a policy. */
function contextFor<H>(
  harness: Harness<H>,
  session: Session,
  model: Model,
  options: { readonly onContextFill?: (fill: ContextFill) => void; readonly history?: readonly Message[] },
): TurnContext | undefined {
  return harness.context?.forTurn({
    session,
    model,
    ownHistory: options.history !== undefined,
    ...(options.onContextFill === undefined ? {} : { onFill: options.onContextFill }),
  });
}

/** The interceptors of a turn: the harness's, the pipeline's gate, and a guard that refuses a model change inside a turn. */
function interceptorsOf<H>(
  harness: Harness<H>,
  session: Session,
  writer: EntryWriter,
  recorder: EventRecorder,
  hostContext: H | undefined,
  turnModel: Model,
  turnContext: TurnContext | undefined,
): Interceptors {
  const policySession: PolicySession = { append: (entry) => writer.write("harness", entry) };
  const pipelineGate = harness.pipeline?.gate(async () => {
    // The model's message and the earlier results are queued first, so the gate's entries follow them in the log.
    recorder.flush();
    await writer.settled();
    return { session: policySession, hostContext, entries: await session.path() };
  });
  const gate =
    pipelineGate === undefined ? undefined : withStickyAllowances(pipelineGate, harness, session, writer, recorder);
  // The context policy runs first, so it reads and indexes the run's own transcript, and the harness's hooks see its view.
  const composed = composeInterceptors(turnContext?.interceptors ?? {}, harness.interceptors ?? {}, gate ?? {});
  const inner = composed.beforeModelCall;
  return {
    ...composed,
    async beforeModelCall(event) {
      const patch = await inner?.(event);
      if (
        patch !== undefined &&
        "model" in patch &&
        patch.model !== undefined &&
        refKey(patch.model.ref) !== refKey(turnModel.ref)
      ) {
        throw new HarnessError(
          "invalid_turn_options",
          "a hook changed the model inside a turn; set TurnOptions.model for the next turn so it is recorded",
        );
      }
      return patch;
    },
  };
}

/**
 * The pipeline's gate with the sticky allowances applied: a call the pipeline would ask about, and that a person's
 * earlier sticky `allow` covers, runs. A deny stays a deny, and the pipeline's own entry for the ask stays in the log
 * beside the entry that records the allowance.
 */
function withStickyAllowances<H>(
  gate: NonNullable<ReturnType<NonNullable<Harness<H>["pipeline"]>["gate"]>>,
  harness: Harness<H>,
  session: Session,
  writer: EntryWriter,
  recorder: EventRecorder,
): Pick<Interceptors, "beforeToolCall"> {
  return {
    async beforeToolCall(event) {
      // The pipeline's gate always has a `beforeToolCall`; a gate without one has nothing to ask.
      const decision = (await gate.beforeToolCall?.(event)) ?? { decision: "allow" as const };
      if (decision.decision !== "ask") return decision;
      recorder.flush();
      await writer.settled();
      const covered = await findSticky(
        await session.path(),
        { tool: event.tool, input: event.input, policyVersion: decision.policyVersion },
        harness.registry,
      );
      if (covered === undefined) return decision;
      await writer.write("harness", {
        type: "permission_decision",
        callId: event.callId,
        tool: harness.registry.get(event.tool)?.canonicalName ?? event.tool,
        decision: "allow",
        rule: `sticky:${covered}`,
        by: "sticky",
        policyVersion: decision.policyVersion ?? "",
        inputHash: await canonicalInputHash(event.input),
      });
      return { decision: "allow", reason: "a sticky allowance a person gave earlier covers this call" };
    },
  };
}

/**
 * The harness's own observers, each held back on an approval request until the entries written so far are durable. An
 * observer that hears of a request can therefore always find its `approval_requested` entry in the log.
 */
function afterWrites(observers: readonly Observer[] | undefined, writer: EntryWriter): Observer[] {
  return (observers ?? []).map(
    (observer): Observer =>
      async (event) => {
        // Only a request needs its entry first, and `settled()` never rejects: a failed write is the writer's to report.
        if (event.type === "approval_request") await writer.settled();
        await observer(event);
      },
  );
}

/** The run options a turn sets only when it has a value, so a missing one leaves the SDK's default. */
type RunSettings<H> = Pick<
  TurnOptions<H>,
  | "clock"
  | "newId"
  | "hostContext"
  | "output"
  | "maxSteps"
  | "turnRetries"
  | "modelOptions"
  | "budgetUsd"
  | "onContextFill"
>;

function optionalRunOptions<H>(options: RunSettings<H>, harness: Harness<H>, history: readonly Message[]) {
  return {
    ...(history.length === 0 ? {} : { history }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.newId === undefined ? {} : { idGenerator: options.newId }),
    ...(options.hostContext === undefined ? {} : { app: options.hostContext }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    ...(options.turnRetries === undefined ? {} : { turnRetries: options.turnRetries }),
    ...(options.modelOptions === undefined ? {} : { modelOptions: options.modelOptions }),
    ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
    ...(harness.signer === undefined ? {} : { signer: harness.signer }),
  };
}

/** Waits for the run and for every queued write, and returns the result with where the log ends. */
async function settleTurn(handle: Run<unknown>, writer: EntryWriter, session: Session): Promise<TurnResult> {
  let result: RunResult<unknown> | undefined;
  let runError: unknown;
  try {
    result = (await handle.result) as RunResult<unknown>;
  } catch (error) {
    runError = error;
  }
  await writer.settled();
  // A store failure is the cause of an aborted run, so it comes before the run's own error.
  const failed = writer.failure();
  if (failed !== undefined) throw failed.error;
  if (result === undefined) throw runError;
  return { ...result, sessionKey: session.key.sessionId, lastEntryId: session.head() as string };
}

/** What every turn and every resume needs: a writer whose failure aborts the run, the run's signal and its id source. */
function turnPlumbing(session: Session, options: { signal?: AbortSignal; clock?: Clock; newId?: () => string }) {
  const stop = new AbortController();
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const writer = new EntryWriter(
    session,
    newId,
    options.clock === undefined ? () => new Date() : () => new Date((options.clock as Clock).now()),
    () => stop.abort(),
  );
  return { signal, newId, writer };
}

/**
 * Runs one turn on a session and writes it to the log. The session must be open with a lock. The first turn of a new
 * session writes its header and `env_stamp`; a turn whose model or tools differ from the last recorded ones writes a
 * `loadout` first; the input blocks follow, and the run's events after them. The returned result is the SDK's, with the
 * session id and the id of the last entry the turn wrote. When the harness has a context policy and the run ends because
 * the provider said the request was too large, the policy compacts once and the turn goes on from the rebuilt context;
 * a second overflow ends the turn with that error.
 */
export async function runTurn<H = unknown>(
  session: Session,
  harness: Harness<H>,
  options: TurnOptions<H>,
): Promise<TurnResult> {
  return retryAfterOverflow(session, harness, options, await runTurnOnce(session, harness, options));
}

async function runTurnOnce<H = unknown>(
  session: Session,
  harness: Harness<H>,
  options: TurnOptions<H>,
): Promise<TurnResult> {
  const model = options.model ?? harness.model;
  const system = options.system ?? harness.system;
  const tools = toolsOf(harness, options);
  const { signal, newId, writer } = turnPlumbing(session, options);
  // What a crash left open is settled first, so the log reads as a whole and the context has no call without a result.
  let path = await session.path();
  const wrote = await settleOpenCalls(
    path,
    harness,
    (origin, body) => writer.write(origin, body as Body),
    !session.headMoved(),
  );
  if (wrote) path = await session.path();
  await recordLoadout(harness, writer, model, tools, path);
  const turnContext = contextFor(harness, session, model, options);
  const waiting = options.history === undefined ? unansweredCalls(path, true) : [];
  if (waiting.length > 0) {
    throw new HarnessError(
      "invalid_turn_options",
      `the session waits on tool calls with no result (${waiting.map((call) => call.callId).join(", ")}); resolve them before another turn, or pass history`,
    );
  }
  // Between turns, before the input is written, the summary layer may replace an outgrown span with a summary. It
  // runs only once no call waits for a result, so a paused turn's own message is never in the span.
  if (
    options.history === undefined &&
    (await turnContext?.compact({ path, signal, append: (origin, body) => writer.write(origin, body) }))
  ) {
    path = await session.path();
  }
  const history = options.history ?? contextOf(path).messages;
  await writeInput(writer, options, newId);
  const recorder = new EventRecorder(writer, harness as Harness<unknown>, system, newId, "run", turnContext?.spillOf);
  turnContext?.attach(attachment(writer, recorder));
  const observer: Observer = (event) => recorder.handle(event);
  const handle = run({
    model,
    system,
    input: options.input,
    tools,
    signal,
    interceptors: interceptorsOf(harness, session, writer, recorder, options.hostContext, model, turnContext),
    observers: [observer, ...afterWrites(harness.observers, writer), ...afterWrites(options.observers, writer)],
    ...optionalRunOptions(options, harness, history),
  });
  options.onRun?.(handle);
  return settleTurn(handle, writer, session);
}

/**
 * Re-runs from an entry: HEAD moves to `entryId` with a `checkout` entry, and a new turn follows it as a new branch of
 * the same log. The entries of the branch it left stay as they were. The entry must not leave a tool call without its
 * result, because that call never ran on the new branch.
 */
export async function rerunFrom<H = unknown>(
  session: Session,
  harness: Harness<H>,
  entryId: string,
  options: TurnOptions<H>,
): Promise<TurnResult> {
  const waiting = unansweredCalls(await session.path(entryId), true).map((call) => call.callId);
  if (waiting.length > 0) {
    throw new HarnessError(
      "invalid_turn_options",
      `entry ${entryId} follows tool calls with no result (${waiting.join(", ")}), so a re-run from it would send calls that never ran`,
    );
  }
  await session.checkout(entryId);
  return runTurn(session, harness, options);
}

/** One `approval_resolved` entry as written: the answer, and what it covers beyond its own call. */
export interface ResolutionRecord {
  readonly resolution: Resolution;
  readonly sticky?: "run" | "session";
  readonly allowance?: { tool: string; inputHash?: string; commandPrefix?: string[]; policyVersion?: string };
  readonly groupId?: string;
  readonly quorum?: "pending";
}

/** What resuming a paused turn takes: the answers, and the same per-turn settings a turn has. */
export interface ResumeOptions<H = unknown> extends RunSettings<H> {
  /** The answers the SDK checks and applies: one per request whose answer is settled. */
  readonly resolutions: readonly Resolution[];
  /**
   * The `approval_resolved` entries to write before the run, with what each covers. Left out, each resolution is
   * written as it is. A request a quorum still waits on has a record here and no resolution.
   */
  readonly records?: readonly ResolutionRecord[];
  /**
   * The caller's app data. A request bound to app data when it paused runs only when the resume passes the same value,
   * so this is the caller's identity. The tools are the paused turn's, from the log. The model is the harness's, or
   * `model`, and one that differs from the paused turn's is recorded as a `loadout`. Pass the turn's `maxSteps`,
   * `output`, `turnRetries` and `modelOptions` again, because the log does not hold them.
   */
  readonly hostContext?: H;
  readonly model?: Model;
  readonly signal?: AbortSignal;
  readonly onRun?: (run: Run<unknown>) => void;
}

/** The resume's policy check: the pipeline decides the call again, so a deny written after the pause wins. */
function recheckThrough<H>(
  session: Session,
  harness: Harness<H>,
  writer: EntryWriter,
  recorder: EventRecorder,
  hostContext: H | undefined,
): Recheck {
  return async (pending, input) => {
    // The earlier results and decisions are queued first, so the pipeline reads a log that holds them.
    recorder.flush();
    await writer.settled();
    const decision = await harness.pipeline?.decide(
      { callId: pending.callId, tool: pending.tool, input, initiator: "model" },
      { session: { append: (entry) => writer.write("harness", entry) }, hostContext, entries: await session.path() },
    );
    // A person approved the call, so a question the pipeline would ask again doesn't stop it; a deny does.
    return decision?.decision === "deny" ? { deny: decision.reason } : "allow";
  };
}

/**
 * Resumes a paused turn from the log alone. The context, with its waiting requests, is rebuilt before anything is
 * written; each resolution is then written as an `approval_resolved` entry, and `continueRun()` verifies the requests
 * against the harness's signer. Each approved call goes through the permission pipeline again first, and a deny now
 * turns the approval into a denial.
 */
export async function resumeTurn<H = unknown>(
  session: Session,
  harness: Harness<H>,
  options: ResumeOptions<H>,
): Promise<TurnResult> {
  if (harness.signer === undefined) {
    throw new HarnessError("approval_unavailable", "the harness has no signer, so no approval can be checked");
  }
  const { signal, newId, writer } = turnPlumbing(session, options);
  const path = await session.path();
  const context = contextOf(path);
  const waiting = new Set((context.pending ?? []).map((request) => request.id));
  const answered = new Set<string>();
  for (const resolution of options.resolutions) {
    if (answered.has(resolution.requestId)) {
      throw new HarnessError("approval_not_pending", `request ${resolution.requestId} is answered twice in one resume`);
    }
    answered.add(resolution.requestId);
    if (!waiting.has(resolution.requestId)) {
      throw new HarnessError("approval_not_pending", `no request ${resolution.requestId} is waiting in this session`);
    }
  }
  // The paused turn's tools: the latest `loadout` names them, and one the registry has lost stops the resume.
  const names = path.findLast((entry) => entry.type === "loadout");
  const tools = toolsOf(harness, {
    input: "",
    ...(names?.type === "loadout" ? { tools: names.tools } : {}),
    ...(options.hostContext === undefined ? {} : { hostContext: options.hostContext }),
  });
  const records = options.records ?? options.resolutions.map((resolution) => ({ resolution }));
  for (const record of records) await writer.write("user", { type: "approval_resolved", ...record });
  const model = options.model ?? harness.model;
  await recordLoadout(harness, writer, model, tools, path);
  const turnContext = contextFor(harness, session, model, options);
  const recorder = new EventRecorder(
    writer,
    harness as Harness<unknown>,
    context.system,
    newId,
    "continue",
    turnContext?.spillOf,
  );
  turnContext?.attach(attachment(writer, recorder));
  const handle = continueRun(context, {
    model,
    tools,
    resolutions: [...options.resolutions],
    recheck: recheckThrough(session, harness, writer, recorder, options.hostContext),
    signer: harness.signer,
    signal,
    interceptors: interceptorsOf(harness, session, writer, recorder, options.hostContext, model, turnContext),
    observers: [(event: AgentEvent) => recorder.handle(event), ...afterWrites(harness.observers, writer)],
    ...optionalRunOptions(options, harness, []),
  });
  options.onRun?.(handle);
  return settleTurn(handle, writer, session);
}

/**
 * Layer 5: after a run that ended because the request was too large, asks the context policy to compact once and
 * goes on from the rebuilt context with `continueRun()`, which asks the model again because the gateway leaves the
 * failed response out of the request. Only one retry is made, so a second overflow is the turn's result.
 */
async function retryAfterOverflow<H>(
  session: Session,
  harness: Harness<H>,
  options: TurnOptions<H>,
  first: TurnResult,
): Promise<TurnResult> {
  if (first.stopReason !== "error" || first.error.kind !== "overflow" || options.history !== undefined) return first;
  const model = options.model ?? harness.model;
  const turnContext = contextFor(harness, session, model, options);
  if (turnContext === undefined) return first;
  // The retry has what the first attempt left of `maxSteps`; with none left there is nothing to retry into.
  const stepsLeft = options.maxSteps === undefined ? undefined : options.maxSteps - first.steps;
  if (stepsLeft !== undefined && stepsLeft < 1) return first;
  const { signal, newId, writer } = turnPlumbing(session, options);
  let compacted: boolean;
  try {
    compacted = await turnContext.onOverflow({
      path: await session.path(),
      signal,
      append: (origin, body) => writer.write(origin, body),
    });
  } catch (error) {
    // An abort during the summary call ends the turn as aborted, not as the overflow it was trying to cure.
    if (signal.aborted) return { ...withoutError(first), stopReason: "aborted" };
    throw error;
  }
  await writer.settled();
  if (!compacted) return first;
  const context = contextOf(await session.path());
  const recorder = new EventRecorder(
    writer,
    harness as Harness<unknown>,
    context.system,
    newId,
    "continue",
    turnContext.spillOf,
  );
  turnContext.attach(attachment(writer, recorder));
  const handle = continueRun(context, {
    model,
    tools: toolsOf(harness, options),
    resolutions: [],
    signal,
    interceptors: interceptorsOf(harness, session, writer, recorder, options.hostContext, model, turnContext),
    observers: [
      (event: AgentEvent) => recorder.handle(event),
      ...afterWrites(harness.observers, writer),
      ...afterWrites(options.observers, writer),
    ],
    ...optionalRunOptions(stepsLeft === undefined ? options : { ...options, maxSteps: stepsLeft }, harness, []),
  });
  options.onRun?.(handle);
  const retried = await settleTurn(handle, writer, session);
  // The turn's result counts both attempts: what the first one spent and the steps it took.
  return {
    ...retried,
    steps: first.steps + retried.steps,
    usage: addUsage(first.usage, retried.usage),
    cost: addCost(first.cost, retried.cost),
  };
}

/** A result without its `error`, for a turn that was cut short before the error mattered. */
function withoutError(result: TurnResult): TurnResult {
  const { error: _error, ...rest } = result as TurnResult & { error?: unknown };
  return rest as TurnResult;
}
