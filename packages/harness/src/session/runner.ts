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
import { HarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import type { PolicySession } from "../permissions/types.js";
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
  /** The conversation so far, as messages. Rebuilding it from the log is the resume's job; a caller passes it until then. */
  readonly history?: readonly Message[];
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

async function lastLoadout(session: Session): Promise<SessionEntry | undefined> {
  const path = await session.path();
  return path.findLast((entry) => entry.type === "loadout");
}

/** Writes what a new session starts with, and a `loadout` when the tools or the model differ from the last one recorded. */
async function recordLoadout<H>(
  session: Session,
  harness: Harness<H>,
  writer: EntryWriter,
  model: Model,
  tools: readonly ToolDefinition<unknown, unknown, unknown>[],
): Promise<void> {
  if (session.head() === null) {
    await writer.write("harness", {
      type: "session_header",
      formatVersion: FORMAT_VERSION,
      harnessVersion: harness.harnessVersion,
      sdkVersion: SDK_VERSION,
      defaultsHash: DEFAULTS_HASH,
      capabilities: [...CAPABILITIES],
      ablationHash: harness.ablationHash,
    });
    await writer.write("harness", { type: "env_stamp", ...harness.env, model: model.ref });
  }
  const names = tools.map((tool) => tool.name);
  const last = await lastLoadout(session);
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

  async #usage(message: ModelMessage): Promise<void> {
    await this.#writer.write("harness", {
      type: "usage",
      source: "model_call",
      usage: message.usage,
      cost: message.cost,
    });
  }

  /** Writes the held-back message: its blocks, its end and its usage. */
  async #flush(): Promise<void> {
    const message = this.#pending;
    if (message === undefined) return;
    this.#pending = undefined;
    const messageId = this.#newId();
    for (const [index, block] of message.content.entries()) {
      await this.#writer.write("model", { type: "message_block", messageId, role: "assistant", index, block });
    }
    await this.#writer.write("model", {
      type: "message_end",
      messageId,
      model: message.model,
      stopReason: message.stopReason,
      ...(message.error === undefined ? {} : { error: message.error }),
    });
    await this.#usage(message);
  }

  async handle(event: AgentEvent): Promise<void> {
    if (event.type === "retry" && event.layer === "turn" && this.#pending !== undefined) {
      // The call's message is superseded and not in the transcript, but the provider billed it.
      const superseded = this.#pending;
      this.#pending = undefined;
      await this.#usage(superseded);
      return;
    }
    await this.#flush();
    await this.#record(event);
  }

  async #record(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "run_start":
        await this.#writer.write("harness", {
          type: "turn_start",
          runId: event.runId,
          mode: "run",
          system: this.#system,
        });
        return;
      case "model_call_end":
        this.#pending = event.message;
        return;
      case "tool_call_start":
        this.#tools.set(event.callId, event.tool);
        return;
      case "tool_call_end":
        await this.#toolResult(event);
        return;
      case "steer_applied":
        for (const [index, block] of event.receipt.message.entries()) {
          await this.#writer.write("user", {
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
        await this.#writer.write("harness", {
          type: "turn_end",
          runId: event.runId,
          stopReason: event.result.stopReason,
          steps: event.result.steps,
        });
        return;
      default:
    }
  }

  async #toolResult(event: Extract<AgentEvent, { type: "tool_call_end" }>): Promise<void> {
    const tool = this.#tools.get(event.callId) ?? "";
    const trust = this.#harness.registry.get(tool)?.outputTrust ?? "trusted";
    const { result } = event;
    await this.#writer.write("tool", {
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
  hostContext: H | undefined,
  turnModel: Model,
): Interceptors {
  const policySession: PolicySession = { append: (entry) => writer.write("harness", entry) };
  const gate = harness.pipeline?.gate(async () => ({
    session: policySession,
    hostContext,
    entries: await session.path(),
  }));
  const composed = composeInterceptors(harness.interceptors ?? {}, gate ?? {});
  const inner = composed.beforeModelCall;
  return {
    ...composed,
    async beforeModelCall(event) {
      const patch = await inner?.(event);
      if (patch !== undefined && "model" in patch && patch.model !== undefined && patch.model !== turnModel) {
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
  const newId = () => globalThis.crypto.randomUUID();
  const writer = new EntryWriter(
    session,
    newId,
    () => new Date(),
    () => stop.abort(),
  );
  await recordLoadout(session, harness, writer, model, tools);
  await writeInput(writer, options, newId);
  const recorder = new EventRecorder(writer, harness as Harness<unknown>, system, newId);
  const observer: Observer = (event) => recorder.handle(event);
  const handle = run({
    model,
    system,
    input: options.input,
    tools,
    signal,
    interceptors: interceptorsOf(harness, session, writer, options.hostContext, model),
    observers: [observer, ...(harness.observers ?? [])],
    ...(options.history === undefined ? {} : { history: options.history }),
    ...(options.hostContext === undefined ? {} : { app: options.hostContext }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    ...(options.turnRetries === undefined ? {} : { turnRetries: options.turnRetries }),
    ...(options.modelOptions === undefined ? {} : { modelOptions: options.modelOptions }),
    ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
    ...(harness.signer === undefined ? {} : { signer: harness.signer }),
  } as never);
  options.onRun?.(handle);
  const result = (await handle.result) as RunResult<unknown>;
  await writer.settled();
  const failed = writer.failure();
  if (failed !== undefined) throw failed.error;
  return { ...result, sessionKey: session.key.sessionId, lastEntryId: session.head() as string };
}
