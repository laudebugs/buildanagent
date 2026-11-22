/**
 * The dispatcher: the one place every interface talks to. It takes the protocol's commands, runs turns through
 * `runTurn()`, and sends the replies, the events and one `turn/settled` per turn back through a connection. The
 * dispatcher holds no session state of its own beyond which turn runs where: the log is the state, so a client that
 * joins late reads the log and a restart loses nothing. A turn holds the session's writer lock only while it runs, so
 * another process that wants the session gets `locked` from its own `turn/start` and nothing else changes.
 */
import {
  type ClientCommand,
  type ClientMessage,
  type ClientResultMap,
  type Disposition,
  ErrorCodes,
  type HarnessEvent,
  type InitializeResult,
  type ResponseMessage,
  type RpcError,
  type ServerMessage,
  type SessionEntry,
  type TurnResultSummary,
} from "@buildanagent/protocol";
import { type AgentEvent, CAPABILITIES, type Observer, type Run, SDK_VERSION } from "@buildanagent/sdk";
import { isHarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import { createApprovals } from "../session/approvals.js";
import type { SessionLock } from "../session/lock.js";
import type { SessionIndex } from "../session/pointer.js";
import { pendingApprovals } from "../session/rebuild.js";
import { runTurn, type TurnOptions, type TurnResult } from "../session/runner.js";
import { listSessions, openSession, type Session } from "../session/session.js";
import type { SessionKey, SessionStore } from "../session/store.js";

/** The methods a client must opt into, by listing each in the `capabilities` of its `initialize`. */
export const EXPERIMENTAL_METHODS = ["session/checkout", "session/fork"] as const;

const PAGE_SIZE = 50;

/** The settings of `createDispatcher()`. */
export interface DispatcherOptions<H = unknown> {
  readonly harness: Harness<H>;
  readonly store: SessionStore;
  readonly index: SessionIndex;
  /** The writer lock a turn takes while it runs. Two dispatchers over one lock serve one session at a time. */
  readonly lock: SessionLock;
  /** Whose sessions this dispatcher serves. Every store call names this user. */
  readonly userId: string;
  /** What the harness adds to the SDK's capabilities in `initialize`. Default none. */
  readonly capabilities?: readonly string[];
  /** The name `initialize` reports. Default `buildanagent-harness`. */
  readonly serverName?: string;
  /** Settings every turn takes besides its input. */
  readonly turn?: Pick<TurnOptions<H>, "maxSteps" | "turnRetries" | "budgetUsd" | "modelOptions">;
  /** Makes session and turn ids. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/** One client's end of the dispatcher: send it messages, and it calls back with what the server sends. */
export interface Connection {
  /** Handles one message and resolves once its response, if it has one, has been sent. */
  receive(message: ClientMessage): Promise<void>;
  /** Stops delivering to this client. A turn it started goes on. */
  close(): void;
}

/** The dispatcher `createDispatcher()` returns. */
export interface Dispatcher {
  /** Adds a client. `send` gets every message the server sends it, one at a time. */
  connect(send: (message: ServerMessage) => void): Connection;
  /** Interrupts every running turn and waits for each to settle. */
  close(): Promise<void>;
}

/** A failed command, which becomes the response's error. */
class Failure extends Error {
  readonly rpc: RpcError;
  constructor(code: number, message: string) {
    super(message);
    this.rpc = { code, message };
  }
}

interface Running {
  readonly turn: string;
  run: Run<unknown> | undefined;
  readonly done: Promise<void>;
  /** Resolves `done`. */
  readonly finish: () => void;
  /** Aborts the turn even before its run exists. */
  readonly controller: AbortController;
  /** Steers and follow-ups that arrived before the run existed; they go in as soon as it does. */
  readonly queued: ((run: Run<unknown>) => void)[];
}

interface Opened {
  readonly cwd: string;
  running?: Running | undefined;
  /** True while a checkout or fork holds the session's lock. */
  branching?: boolean;
}

/** The command whose method union holds `M`, for the methods that share one command shape. */
type Command<M extends string> = ClientCommand extends infer C
  ? C extends { method: infer X }
    ? M extends X
      ? C
      : never
    : never
  : never;

const failure = (code: number, message: string): Failure => new Failure(code, message);

function errorResponse(id: number | string, error: RpcError): ResponseMessage<never> {
  return { jsonrpc: "2.0", id, error };
}

/** What `turn/settled` says about a finished turn, or about a turn that failed before it could finish. */
function summaryOf(result: TurnResult | undefined, error?: unknown): TurnResultSummary {
  if (result === undefined) {
    return {
      stopReason: "error",
      steps: 0,
      costUsd: null,
      error: { kind: "harness", message: error instanceof Error ? error.message : String(error) },
    };
  }
  const failed = "error" in result ? (result.error as { kind: string; message: string } | undefined) : undefined;
  return {
    stopReason: result.stopReason,
    steps: result.steps,
    costUsd: result.cost.total,
    ...(failed === undefined ? {} : { error: { kind: failed.kind, message: failed.message } }),
  };
}

/** A store that tells `onAppend` about each batch it stores, so the dispatcher can announce entries as they land. Delivery never fails a write that has landed. */
function watched(store: SessionStore, onAppend: (entries: readonly SessionEntry[]) => void): SessionStore {
  return {
    async append(key, entries, options) {
      const stored = await store.append(key, entries, options);
      onAppend(stored);
      return stored;
    },
    load: (key, options) => store.load(key, options),
    list: (userId) => store.list(userId),
    delete: (key) => store.delete(key),
    ...(store.loadRaw === undefined
      ? {}
      : { loadRaw: (key: SessionKey) => (store.loadRaw as NonNullable<SessionStore["loadRaw"]>)(key) }),
  };
}

class HarnessDispatcher<H> implements Dispatcher {
  readonly #options: DispatcherOptions<H>;
  #closed = false;
  readonly #connections = new Set<ConnectionImpl<H>>();
  readonly #opened = new Map<string, Opened>();
  readonly #lastSeq = new Map<string, number>();
  readonly #newId: () => string;

  constructor(options: DispatcherOptions<H>) {
    this.#options = options;
    this.#newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  /** The store a turn on `session` writes through: each batch is announced under the session's own id, whichever file holds it. */
  #storeFor(session: string): SessionStore {
    return watched(this.#options.store, (entries) => this.#appended(session, entries));
  }

  get closed(): boolean {
    return this.#closed;
  }

  connect(send: (message: ServerMessage) => void): Connection {
    if (this.#closed) throw new Error("the dispatcher is closed");
    const connection = new ConnectionImpl(this, send);
    this.#connections.add(connection);
    return connection;
  }

  async close(): Promise<void> {
    this.#closed = true;
    const running = [...this.#opened.values()].flatMap((opened) =>
      opened.running === undefined ? [] : [opened.running],
    );
    for (const turn of running) turn.controller.abort("the dispatcher closed");
    await Promise.all(running.map((turn) => turn.done));
    this.#connections.clear();
  }

  detach(connection: ConnectionImpl<H>): void {
    this.#connections.delete(connection);
  }

  key(session: string): SessionKey {
    return { userId: this.#options.userId, sessionId: session };
  }

  /** Sends to every connection that has opened the session. `seq` is the log's sequence number at that moment. */
  emit(session: string, event: AgentEvent | HarnessEvent, seq?: number): void {
    const at = seq ?? this.#lastSeq.get(session) ?? -1;
    for (const connection of this.#connections) {
      if (connection.watching(session)) {
        connection.send({ jsonrpc: "2.0", method: "event", params: { session, seq: at, event } });
      }
    }
  }

  #appended(session: string, entries: readonly SessionEntry[]): void {
    for (const entry of entries) {
      this.#lastSeq.set(session, entry.seq);
      this.emit(session, { type: "entry_appended", entry }, entry.seq);
    }
  }

  settled(session: string, turn: string, result: TurnResultSummary): void {
    for (const connection of this.#connections) {
      if (connection.watching(session)) {
        connection.send({ jsonrpc: "2.0", method: "turn/settled", params: { session, turn, result } });
      }
    }
  }

  async dispatch(
    connection: ConnectionImpl<H>,
    command: ClientCommand,
  ): Promise<{ result: unknown; after?: () => void }> {
    switch (command.method) {
      case "initialize":
        return { result: await this.#initialize(connection, command.params.capabilities) };
      case "session/create":
        return { result: await this.#create(connection, command.params) };
      case "session/open":
        return { result: await this.#open(connection, command.params) };
      case "session/list":
        return { result: await this.#list(command.params.cursor) };
      case "turn/start":
        return this.#start(connection, command.params.session, command.params.input);
      case "turn/steer":
      case "turn/followUp":
        return { result: this.#redirect(connection, command.method, command.params.session, command.params.input) };
      case "turn/interrupt":
        return { result: this.#interrupt(connection, command.params.session, command.params.reason) };
      case "approval/list":
        return { result: await this.#approvals(connection, command.params.session) };
      case "session/checkout":
      case "session/fork":
        return { result: await this.#branch(connection, command) };
      default:
        throw failure(ErrorCodes.MethodNotFound, `unknown method ${String((command as { method: string }).method)}`);
    }
  }

  async #initialize(connection: ConnectionImpl<H>, requested: readonly string[]): Promise<InitializeResult> {
    connection.optIn(requested);
    const pending: InitializeResult["pending"] = [];
    for await (const summary of listSessions(this.#options.store, this.#options.userId)) {
      // One unreadable session must not stop every client from connecting.
      try {
        const session = await openSession({
          store: this.#options.store,
          index: this.#options.index,
          key: this.key(summary.sessionId),
        });
        for (const entry of pendingApprovals(await session.path()))
          pending.push({ session: summary.sessionId, request: entry.request });
      } catch {
        // skipped
      }
    }
    return {
      serverInfo: {
        name: this.#options.serverName ?? "buildanagent-harness",
        version: this.#options.harness.harnessVersion,
        sdkVersion: SDK_VERSION,
        specVersion: "v1",
      },
      capabilities: [...CAPABILITIES, ...(this.#options.capabilities ?? [])],
      experimental: [...EXPERIMENTAL_METHODS],
      pending,
    };
  }

  async #exists(session: string): Promise<boolean> {
    for await (const _ of this.#options.store.load(this.key(session), { fromSeq: 0 })) return true;
    return false;
  }

  async #create(
    connection: ConnectionImpl<H>,
    params: Command<"session/create">["params"],
  ): Promise<ClientResultMap["session/create"]> {
    const id = params.session ?? this.#newId();
    if (this.#opened.has(id)) throw failure(ErrorCodes.InvalidParams, `session ${id} already exists`);
    // Reserve the id before the first await, so two creates of one id cannot both pass.
    const reserved: Opened = { cwd: params.cwd };
    this.#opened.set(id, reserved);
    try {
      if (await this.#exists(id)) throw failure(ErrorCodes.InvalidParams, `session ${id} already exists`);
    } catch (error) {
      if (this.#opened.get(id) === reserved) this.#opened.delete(id);
      throw error;
    }
    connection.watch(id);
    return { session: id, head: null };
  }

  async #open(
    connection: ConnectionImpl<H>,
    params: Command<"session/open">["params"],
  ): Promise<ClientResultMap["session/open"]> {
    const id = params.session ?? "";
    // A session this dispatcher created has no file until its first turn, but a second client may still open it.
    const exists = id !== "" && (await this.#exists(id));
    if (id === "" || !(exists || this.#opened.has(id)))
      throw failure(ErrorCodes.InvalidParams, `no session ${JSON.stringify(id)}`);
    const reader = exists
      ? await openSession({ store: this.#options.store, index: this.#options.index, key: this.key(id) })
      : undefined;
    if (!this.#opened.has(id)) this.#opened.set(id, { cwd: params.cwd });
    // Subscribe only once the session has opened, so a failed open leaves the client with no access.
    connection.watch(id);
    return { session: id, head: reader?.head() ?? null };
  }

  async #list(cursor: string | undefined): Promise<ClientResultMap["session/list"]> {
    const from = cursor === undefined ? 0 : /^\d+$/.test(cursor) ? Number(cursor) : -1;
    if (from < 0) throw failure(ErrorCodes.InvalidParams, "the cursor is not one this server gave");
    const all: ClientResultMap["session/list"]["sessions"] = [];
    for await (const item of listSessions(this.#options.store, this.#options.userId)) {
      all.push({
        session: item.sessionId,
        startedAt: item.startedAt,
        lastEntryAt: item.lastEntryAt,
        entryCount: item.entryCount,
      });
    }
    const page = all.slice(from, from + PAGE_SIZE);
    return from + PAGE_SIZE < all.length
      ? { sessions: page, nextCursor: String(from + PAGE_SIZE) }
      : { sessions: page };
  }

  async #start(connection: ConnectionImpl<H>, session: string, input: Command<"turn/start">["params"]["input"]) {
    const opened = connection.watching(session) ? this.#opened.get(session) : undefined;
    if (opened === undefined) return { result: { accepted: false, reason: "invalid" } satisfies Disposition };
    if (this.#closed) throw failure(ErrorCodes.InternalError, "the dispatcher is closed");
    if (opened.running !== undefined || opened.branching === true) {
      return { result: { accepted: false, reason: "busy" } satisfies Disposition };
    }
    // Claim the session before the first await, so a second start in the same tick sees it busy.
    const turn = this.#newId();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const running: Running = {
      turn,
      run: undefined,
      done,
      finish,
      controller: new AbortController(),
      queued: [],
    };
    opened.running = running;
    let handle: Session;
    try {
      handle = await openSession({
        store: this.#storeFor(session),
        index: this.#options.index,
        lock: this.#options.lock,
        key: this.key(session),
      });
    } catch (error) {
      opened.running = undefined;
      finish();
      if (isHarnessError(error) && error.code === "session_locked")
        return { result: { accepted: false, reason: "locked" } satisfies Disposition };
      throw error;
    }
    if (this.#closed) {
      // close() returned while this turn was still taking the lock: give it back and refuse.
      await handle.close().catch(() => undefined);
      opened.running = undefined;
      finish();
      throw failure(ErrorCodes.InternalError, "the dispatcher is closed");
    }
    // The response goes out first; the run starts after it, so no event can reach a client before its disposition.
    let begin!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    void this.#run(handle, session, opened, running, input, started);
    return { result: { accepted: true, turn } satisfies Disposition, after: begin };
  }

  async #run(
    handle: Session,
    session: string,
    opened: Opened,
    running: Running,
    input: Command<"turn/start">["params"]["input"],
    started: Promise<void>,
  ): Promise<void> {
    await started;
    const observer: Observer = (event) => this.emit(session, event);
    let summary: TurnResultSummary;
    try {
      await this.#seed(handle, session);
      const result = await runTurn(handle, this.#options.harness, {
        ...this.#options.turn,
        input,
        observers: [observer],
        signal: running.controller.signal,
        // The first run has ended and a retry may follow: a steer sent now waits in the queue for the retry's run.
        onOverflowRetry: () => {
          running.run = undefined;
        },
        onContextFill: (fill) => this.emit(session, { type: "context_fill", tokens: fill.tokens, budget: fill.budget }),
        onCompletionCheck: (entry) => this.emit(session, { type: "completion_check", entry }, entry.seq),
        onRun: (run) => {
          running.run = run;
          for (const apply of running.queued.splice(0)) apply(run);
        },
      });
      summary = summaryOf(result);
    } catch (error) {
      summary = summaryOf(undefined, error);
    } finally {
      // A lock that will not release must not leave the session busy or the turn unsettled.
      await handle.close().catch(() => undefined);
      running.run = undefined;
      opened.running = undefined;
    }
    this.settled(session, running.turn, summary);
    running.finish();
  }

  /** Seeds the sequence a run's own events carry, so a session an earlier process wrote does not start at -1. */
  async #seed(handle: Session, session: string): Promise<void> {
    const last = (await handle.path()).at(-1);
    if (last !== undefined) this.#lastSeq.set(session, Math.max(last.seq, this.#lastSeq.get(session) ?? -1));
  }

  #redirect(
    connection: ConnectionImpl<H>,
    method: "turn/steer" | "turn/followUp",
    session: string,
    input: Command<"turn/steer">["params"]["input"],
  ): Disposition {
    const running = connection.watching(session) ? this.#opened.get(session)?.running : undefined;
    if (running === undefined) return { accepted: false, reason: "invalid" };
    const apply = (run: Run<unknown>): boolean => {
      try {
        const queued = method === "turn/steer" ? run.steer([...input]) : run.followUp([...input]);
        // A message the run ends before applying is rejected as undelivered: the turn's own end says what happened.
        Promise.resolve(queued).catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    };
    if (running.run === undefined) {
      running.queued.push((run) => void apply(run));
      return { accepted: true, turn: running.turn };
    }
    return apply(running.run) ? { accepted: true, turn: running.turn } : { accepted: false, reason: "invalid" };
  }

  #interrupt(
    connection: ConnectionImpl<H>,
    session: string,
    reason: string | undefined,
  ): ClientResultMap["turn/interrupt"] {
    const running = connection.watching(session) ? this.#opened.get(session)?.running : undefined;
    if (running === undefined) return { interrupted: false };
    running.controller.abort(reason);
    return { interrupted: true };
  }

  async #approvals(connection: ConnectionImpl<H>, session: string): Promise<ClientResultMap["approval/list"]> {
    if (!connection.watching(session) || !this.#opened.has(session))
      throw failure(ErrorCodes.InvalidParams, `no session ${JSON.stringify(session)} is open`);
    const reader = await openSession({
      store: this.#options.store,
      index: this.#options.index,
      key: this.key(session),
    });
    const waiting = await createApprovals(this.#options.harness).pending(reader);
    return { pending: waiting.map((entry) => entry.request) };
  }

  async #branch(
    connection: ConnectionImpl<H>,
    command: Command<"session/checkout" | "session/fork">,
  ): Promise<ClientResultMap["session/fork"]> {
    if (!connection.optedIn(command.method)) {
      throw failure(
        ErrorCodes.NotOptedIn,
        `${command.method} is experimental: list it in the capabilities of initialize`,
      );
    }
    const { session } = command.params;
    const opened = this.#opened.get(session);
    if (opened === undefined || !connection.watching(session)) {
      throw failure(ErrorCodes.InvalidParams, `no session ${JSON.stringify(session)} is open`);
    }
    if (opened.running !== undefined || opened.branching === true) {
      throw failure(ErrorCodes.SessionLocked, "a turn is running in this session");
    }
    if (this.#closed) throw failure(ErrorCodes.InternalError, "the dispatcher is closed");
    opened.branching = true;
    try {
      return await this.#branchLocked(connection, command, opened);
    } finally {
      opened.branching = false;
    }
  }

  async #branchLocked(
    connection: ConnectionImpl<H>,
    command: Command<"session/checkout" | "session/fork">,
    opened: Opened,
  ): Promise<ClientResultMap["session/fork"]> {
    const { session, entryId } = command.params;
    // A checkout is announced under its own session; a fork's entries belong to the new session, nobody watches yet.
    const handle = await openSession({
      store: command.method === "session/checkout" ? this.#storeFor(session) : this.#options.store,
      index: this.#options.index,
      lock: this.#options.lock,
      key: this.key(session),
    });
    try {
      if (command.method === "session/checkout") {
        await handle.checkout(entryId);
        return { session, head: handle.head() as string };
      }
      const forked = await handle.fork(entryId);
      try {
        const id = forked.key.sessionId;
        this.#opened.set(id, { cwd: opened.cwd });
        connection.watch(id);
        return { session: id, head: forked.head() as string };
      } finally {
        // The change has landed; a lock that will not release must not turn it into an error.
        await forked.close().catch(() => undefined);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

class ConnectionImpl<H> implements Connection {
  readonly #dispatcher: HarnessDispatcher<H>;
  readonly #send: (message: ServerMessage) => void;
  readonly #watching = new Set<string>();
  readonly #optedIn = new Set<string>();
  #open = true;

  constructor(dispatcher: HarnessDispatcher<H>, send: (message: ServerMessage) => void) {
    this.#dispatcher = dispatcher;
    this.#send = send;
  }

  send(message: ServerMessage): void {
    if (!this.#open) return;
    try {
      this.#send(message);
    } catch {
      // A client's own failure to take a message must not fail the write or the turn that produced it.
    }
  }

  watch(session: string): void {
    this.#watching.add(session);
  }

  watching(session: string): boolean {
    return this.#watching.has(session);
  }

  optIn(methods: readonly string[]): void {
    for (const method of methods) this.#optedIn.add(method);
  }

  optedIn(method: string): boolean {
    return this.#optedIn.has(method);
  }

  close(): void {
    this.#open = false;
    this.#dispatcher.detach(this);
  }

  async receive(message: ClientMessage): Promise<void> {
    if (!("method" in message)) return;
    if (!("id" in message)) return;
    const command = message as ClientCommand & { id: number | string };
    let begin: (() => void) | undefined;
    try {
      const { result, after } = await this.#dispatcher.dispatch(this, command);
      begin = after;
      this.send({ jsonrpc: "2.0", id: command.id, result: result as ClientResultMap[keyof ClientResultMap] });
    } catch (error) {
      const rpc = error instanceof Failure ? error.rpc : internal(error);
      this.send(errorResponse(command.id, rpc));
    } finally {
      begin?.();
    }
  }
}

function internal(error: unknown): RpcError {
  if (isHarnessError(error) && error.code === "entry_not_found")
    return { code: ErrorCodes.InvalidParams, message: error.message };
  if (isHarnessError(error) && error.code === "session_locked")
    return { code: ErrorCodes.SessionLocked, message: error.message };
  return { code: ErrorCodes.InternalError, message: error instanceof Error ? error.message : String(error) };
}

/** Creates the dispatcher that serves `options.harness` over the protocol's commands. */
export function createDispatcher<H = unknown>(options: DispatcherOptions<H>): Dispatcher {
  return new HarnessDispatcher(options);
}
