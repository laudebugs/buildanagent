/**
 * `runTurn()`: one SDK run, written into a session's log. The user entries are durable before the run starts, so a turn
 * that dies before its first model call leaves the question in the file. The run's own events then become entries
 * through one observer: a message's blocks and end when its call ends, a tool's result when the call ends, usage, and the
 * turn's end. Every write goes through one queue, so the permission pipeline's entries and the observer's never race for
 * the same parent.
 */
import type { ContentBlock, Message, Model, ModelRef } from "@buildanagent/gateway";
import { FORMAT_VERSION, type Origin, type SessionEntry } from "@buildanagent/protocol";
import {
  type AgentEvent,
  CAPABILITIES,
  type CallOptions,
  composeInterceptors,
  DEFAULTS_HASH,
  type Interceptors,
  type Observer,
  type Run,
  type RunResult,
  run,
  SDK_VERSION,
  type ToolDefinition,
} from "@buildanagent/sdk";
import type { Clock } from "@buildanagent/sdk/testing";
import { HarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import type { PolicySession } from "../permissions/types.js";
import { contextOf } from "./rebuild.js";
import { settleOpenCalls } from "./resume.js";
import type { Session } from "./session.js";
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

  constructor(writer: EntryWriter, harness: Harness<unknown>, system: string, newId: () => string) {
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
          mode: "run",
          system: this.#system,
        });
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
    this.#queue("tool", {
      type: "tool_result",
      callId: event.callId,
      tool,
      content: [...result.content],
      isError: result.isError === true,
      ...(result.details === undefined ? {} : { details: result.details }),
      trust,
    });
  }
}

/** The interceptors of a turn: the harness's, the pipeline's gate, and a guard that refuses a model change inside a turn. */
function interceptorsOf<H>(
  harness: Harness<H>,
  session: Session,
  writer: EntryWriter,
  recorder: EventRecorder,
  hostContext: H | undefined,
  turnModel: Model,
): Interceptors {
  const policySession: PolicySession = { append: (entry) => writer.write("harness", entry) };
  const gate = harness.pipeline?.gate(async () => {
    // The model's message and the earlier results are queued first, so the gate's entries follow them in the log.
    recorder.flush();
    await writer.settled();
    return { session: policySession, hostContext, entries: await session.path() };
  });
  const composed = composeInterceptors(harness.interceptors ?? {}, gate ?? {});
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

/** The run options a turn sets only when it has a value, so a missing one leaves the SDK's default. */
function optionalRunOptions<H>(options: TurnOptions<H>, harness: Harness<H>, history: readonly Message[]) {
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

/**
 * Runs one turn on a session and writes it to the log. The session must be open with a lock. The first turn of a new
 * session writes its header and `env_stamp`; a turn whose model or tools differ from the last recorded ones writes a
 * `loadout` first; the input blocks follow, and the run's events after them. The returned result is the SDK's, with the
 * session id and the id of the last entry the turn wrote.
 */
export async function runTurn<H = unknown>(
  session: Session,
  harness: Harness<H>,
  options: TurnOptions<H>,
): Promise<TurnResult> {
  const model = options.model ?? harness.model;
  const system = options.system ?? harness.system;
  const tools = toolsOf(harness, options);
  const stop = new AbortController();
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const writer = new EntryWriter(
    session,
    newId,
    options.clock === undefined ? () => new Date() : () => new Date((options.clock as Clock).now()),
    () => stop.abort(),
  );
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
  const history = options.history ?? contextOf(path).messages;
  await writeInput(writer, options, newId);
  const recorder = new EventRecorder(writer, harness as Harness<unknown>, system, newId);
  const observer: Observer = (event) => recorder.handle(event);
  const handle = run({
    model,
    system,
    input: options.input,
    tools,
    signal,
    interceptors: interceptorsOf(harness, session, writer, recorder, options.hostContext, model),
    observers: [observer, ...(harness.observers ?? [])],
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
  const context = await session.toContext(entryId);
  const answered = new Set(context.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : [])));
  const waiting = context.messages.flatMap((message) =>
    message.role === "assistant"
      ? message.content.flatMap((block) =>
          block.type === "tool_call" && !answered.has(block.callId) ? [block.callId] : [],
        )
      : [],
  );
  if (waiting.length > 0) {
    throw new HarnessError(
      "invalid_turn_options",
      `entry ${entryId} follows tool calls with no result (${waiting.join(", ")}), so a re-run from it would send calls that never ran`,
    );
  }
  await session.checkout(entryId);
  return runTurn(session, harness, options);
}
