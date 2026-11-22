/**
 * The dispatcher: the one place every interface talks to. It takes the protocol's commands, runs turns through
 * `runTurn()`, and sends the replies, the events and one `turn/settled` per turn back through each connection. The
 * dispatcher holds no session state of its own beyond which turn runs where and which questions it has asked: the log
 * is the state, so a client that joins late reads the log and a restart loses nothing. A turn holds the session's
 * writer lock only while it runs, so another process that wants the session gets `locked` from its own `turn/start`.
 *
 * A call that needs a person ends its turn `awaiting_approval`. Once its `approval_requested` entry is durable, every
 * connection that watches the session is asked with `approval/request` or `clarification/request`. The first answer
 * wins: the others are withdrawn with `$/cancelRequest`, and the answer goes through `Approvals.resolve()`, which runs
 * as a turn of its own once the session is free. A client that reconnects finds the request in `initialize` and is
 * asked again when it opens the session.
 */
import {
  type ClientCommand,
  type ClientMessage,
  type ClientResultMap,
  type Disposition,
  ErrorCodes,
  type HarnessEvent,
  type Id,
  type InitializeResult,
  type ServerNotification,
  type SessionEntry,
  type TurnResultSummary,
} from "@buildanagent/protocol";
import {
  type AgentEvent,
  CAPABILITIES,
  type Observer,
  type Resolution,
  type Run,
  SDK_VERSION,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import { HarnessError, isHarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import { type Approvals, createApprovals } from "../session/approvals.js";
import type { SessionLock } from "../session/lock.js";
import type { SessionIndex } from "../session/pointer.js";
import { pendingApprovals } from "../session/rebuild.js";
import { type ClientToolRunner, runTurn, type TurnOptions, type TurnResult } from "../session/runner.js";
import { listSessions, openSession, type Session } from "../session/session.js";
import type { SessionKey, SessionStore } from "../session/store.js";
import { resolutionOf, toolError, toolResultOf } from "./answers.js";
import { type ConnectionHost, type Dispatched, Failure, type ServerAnswer, ServerConnection } from "./connection.js";
import type { Deliver } from "./outbox.js";

/** The methods a client must opt into, by listing each in the `capabilities` of its `initialize`. */
export const EXPERIMENTAL_METHODS = ["session/checkout", "session/fork"] as const;

const PAGE_SIZE = 50;
const DEFAULT_QUEUE_SIZE = 128;

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
  /** Settings every turn takes besides its input, resumes included. */
  readonly turn?: Pick<TurnOptions<H>, "maxSteps" | "turnRetries" | "budgetUsd" | "modelOptions">;
  /** Makes session and turn ids. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
  /**
   * How many commands each connection may have unanswered, and how many events may wait for a slow client before
   * the server drops them. A whole number of at least 1. Default 128.
   */
  readonly queueSize?: number;
  /** The approvals a client's answers go through. Default `createApprovals(harness)`. */
  readonly approvals?: Approvals<H>;
}

/** One client's end of the dispatcher: send it messages, and it calls back with what the server sends. */
export interface Connection {
  /** Handles one message and resolves once its response, if it has one, is queued to go out. */
  receive(message: ClientMessage): Promise<void>;
  /**
   * Stops delivering to this client. A turn it started goes on, and a tool call that waits on this client gets an
   * error result. A request for a person stays in the log for the next client.
   */
  close(): void;
}

/** The dispatcher `createDispatcher()` returns. */
export interface Dispatcher {
  /**
   * Adds a client. `send` gets every message the server sends it, one at a time and in order. A `send` that returns a
   * promise holds the next message until it settles; while it waits, events past the queue size are dropped and an
   * `events_dropped` event stands in for them.
   */
  connect(send: Deliver): Connection;
  /** Interrupts every running turn and waits for each to settle. */
  close(): Promise<void>;
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
  /** The client a `client_request` tool's call goes to: the one that started the turn or gave the answer it resumes. */
  readonly owner: ServerConnection | undefined;
}

/** An answer a client gave, held until the session is free to resume. */
interface Answer {
  readonly resolution: Resolution;
  readonly by: ServerConnection;
  applying: boolean;
}

interface Opened {
  readonly cwd: string;
  running?: Running | undefined;
  /** True while a checkout or fork holds the session's lock. */
  branching?: boolean;
  /** The first answer to each signed request, by its id, until a resume has applied it. */
  readonly answers: Map<string, Answer>;
}

/** The command whose method union holds `M`, for the methods that share one command shape. */
type Command<M extends string> = ClientCommand extends infer C
  ? C extends { method: infer X }
    ? M extends X
      ? C
      : never
    : never
  : never;

type EventMessage = Extract<ServerNotification, { method: "event" }>;

const failure = (code: number, message: string): Failure => new Failure(code, message);

const newOpened = (cwd: string): Opened => ({ cwd, answers: new Map() });

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

/**
 * A store that tells `onAppend` about each batch it stores, with the file it went to, so the dispatcher can announce
 * entries as they land. Delivery never fails a write that has landed.
 */
function watched(
  store: SessionStore,
  onAppend: (key: SessionKey, entries: readonly SessionEntry[]) => void,
): SessionStore {
  return {
    async append(key, entries, options) {
      const stored = await store.append(key, entries, options);
      onAppend(key, stored);
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

const replayEvent = (session: string, entry: SessionEntry): EventMessage => ({
  jsonrpc: "2.0",
  method: "event",
  params: { session, seq: entry.seq, event: { type: "entry_appended", entry } },
});

async function collect(entries: AsyncIterable<SessionEntry>): Promise<SessionEntry[]> {
  const out: SessionEntry[] = [];
  for await (const entry of entries) out.push(entry);
  return out;
}

function checkQueueSize(size: number | undefined): number {
  if (size === undefined) return DEFAULT_QUEUE_SIZE;
  if (!Number.isInteger(size) || size < 1) {
    throw new HarnessError("invalid_dispatcher_options", `queueSize must be a whole number of at least 1, got ${size}`);
  }
  return size;
}

class HarnessDispatcher<H> implements Dispatcher, ConnectionHost {
  readonly #options: DispatcherOptions<H>;
  #closed = false;
  readonly #connections = new Set<ServerConnection>();
  readonly #opened = new Map<string, Opened>();
  readonly #lastSeq = new Map<string, number>();
  readonly #newId: () => string;
  readonly #queueSize: number;
  readonly #approvals: Approvals<H>;
  #requests = 0;

  constructor(options: DispatcherOptions<H>) {
    this.#options = options;
    this.#newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.#queueSize = checkQueueSize(options.queueSize);
    this.#approvals = options.approvals ?? createApprovals(options.harness);
  }

  /**
   * The store a turn on `session` writes through. Each batch written to the session's current file is announced under
   * the session's own id; a batch that goes to another file, such as a child's, belongs to that file's session.
   */
  #storeFor(session: string, handle: () => Session | undefined): SessionStore {
    return watched(this.#options.store, (key, entries) => {
      const current = handle();
      if (current === undefined || key.sessionId === current.file()) this.#appended(session, entries);
    });
  }

  connect(send: Deliver): Connection {
    if (this.#closed) throw new Error("the dispatcher is closed");
    const connection = new ServerConnection(this, send, this.#queueSize);
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

  detach(connection: ServerConnection): void {
    this.#connections.delete(connection);
  }

  key(session: string): SessionKey {
    return { userId: this.#options.userId, sessionId: session };
  }

  #watchers(session: string): ServerConnection[] {
    return [...this.#connections].filter((connection) => connection.watching(session));
  }

  /** Sends to every connection that has opened the session. `seq` is the log's sequence number at that moment. */
  emit(session: string, event: AgentEvent | HarnessEvent, seq?: number): void {
    const at = seq ?? this.#lastSeq.get(session) ?? -1;
    const message: EventMessage = { jsonrpc: "2.0", method: "event", params: { session, seq: at, event } };
    for (const connection of this.#connections) connection.event(message);
  }

  #appended(session: string, entries: readonly SessionEntry[]): void {
    for (const entry of entries) {
      this.#lastSeq.set(session, entry.seq);
      this.emit(session, { type: "entry_appended", entry }, entry.seq);
      // The entry is durable now, so a client that hears of the request can always find it in the log.
      if (entry.type === "approval_requested") {
        for (const connection of this.#watchers(session)) this.#ask(connection, session, entry.request);
      }
    }
  }

  settled(session: string, turn: string, result: TurnResultSummary): void {
    for (const connection of this.#watchers(session)) {
      connection.send({ jsonrpc: "2.0", method: "turn/settled", params: { session, turn, result } });
    }
  }

  async dispatch(connection: ServerConnection, command: ClientCommand & { id: Id }): Promise<Dispatched> {
    switch (command.method) {
      case "initialize":
        return { result: await this.#initialize(connection, command.params.capabilities) };
      case "session/create":
        return { result: await this.#create(connection, command.params) };
      case "session/open":
        return this.#open(connection, command.params);
      case "session/list":
        return { result: await this.#list(command.params.cursor) };
      case "turn/start":
        return this.#start(connection, command.id, command.params.session, command.params.input);
      case "turn/steer":
      case "turn/followUp":
        return { result: this.#redirect(connection, command.method, command.params.session, command.params.input) };
      case "turn/interrupt":
        return { result: this.#interrupt(connection, command.params.session, command.params.reason) };
      case "approval/list":
        return { result: await this.#approvalList(connection, command.params.session) };
      case "session/checkout":
      case "session/fork":
        return { result: await this.#branch(connection, command) };
      default:
        throw failure(ErrorCodes.MethodNotFound, `unknown method ${String((command as { method: string }).method)}`);
    }
  }

  async #initialize(connection: ServerConnection, requested: readonly string[]): Promise<InitializeResult> {
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
    connection: ServerConnection,
    params: Command<"session/create">["params"],
  ): Promise<ClientResultMap["session/create"]> {
    const id = params.session ?? this.#newId();
    if (this.#opened.has(id)) throw failure(ErrorCodes.InvalidParams, `session ${id} already exists`);
    // Reserve the id before the first await, so two creates of one id cannot both pass.
    const reserved = newOpened(params.cwd);
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

  /**
   * Opens a session for the connection. Its live events are held from the start, so that none is sent before the
   * response, lost, or sent twice: after the response, the connection gets the replay from `fromSeq`, then what was
   * held, then the live stream, and is asked again about every request that still waits.
   */
  async #open(connection: ServerConnection, params: Command<"session/open">["params"]): Promise<Dispatched> {
    const id = params.session ?? "";
    const { fromSeq } = params;
    if (fromSeq !== undefined && !(Number.isInteger(fromSeq) && fromSeq >= 0))
      throw failure(ErrorCodes.InvalidParams, "fromSeq must be a whole number of at least 0");
    if (!connection.hold(id)) throw failure(ErrorCodes.InvalidParams, `session ${JSON.stringify(id)} is being opened`);
    try {
      return await this.#openHeld(connection, id, params.cwd, fromSeq);
    } catch (error) {
      // A failed open leaves the client with no access and nothing of what was held.
      connection.unhold(id);
      throw error;
    }
  }

  async #openHeld(
    connection: ServerConnection,
    id: string,
    cwd: string,
    fromSeq: number | undefined,
  ): Promise<Dispatched> {
    // A session this dispatcher created has no file until its first turn, but a second client may still open it.
    const exists = id !== "" && (await this.#exists(id));
    if (id === "" || !(exists || this.#opened.has(id)))
      throw failure(ErrorCodes.InvalidParams, `no session ${JSON.stringify(id)}`);
    const reader = exists
      ? await openSession({ store: this.#options.store, index: this.#options.index, key: this.key(id) })
      : undefined;
    const replay = fromSeq === undefined ? [] : await this.#replay(reader?.file(), fromSeq);
    if (!this.#opened.has(id)) this.#opened.set(id, newOpened(cwd));
    const replayedTo = fromSeq === undefined ? -1 : (replay.at(-1)?.seq ?? fromSeq - 1);
    return {
      result: { session: id, head: reader?.head() ?? null } satisfies ClientResultMap["session/open"],
      after: () => {
        connection.release(
          id,
          replay.map((entry) => replayEvent(id, entry)),
          replayedTo,
        );
        void this.#armFor(connection, id);
      },
    };
  }

  /**
   * The entries of the session's current file from `fromSeq` on, read from the log, which holds every entry: the log is
   * the replay window, so no `fromSeq` is too old. A `fromSeq` past the entry after the last refuses the open.
   */
  async #replay(file: string | undefined, fromSeq: number): Promise<SessionEntry[]> {
    if (file === undefined) {
      if (fromSeq === 0) return [];
      throw failure(ErrorCodes.InvalidParams, `fromSeq ${fromSeq} is past the end of the session's log`);
    }
    // One entry before fromSeq is read too, to tell a client that has everything from one whose fromSeq is too far.
    const entries = await collect(this.#options.store.load(this.key(file), { fromSeq: Math.max(0, fromSeq - 1) }));
    if (fromSeq === 0) return entries;
    if (entries[0]?.seq !== fromSeq - 1)
      throw failure(ErrorCodes.InvalidParams, `fromSeq ${fromSeq} is past the end of the session's log`);
    return entries.slice(1);
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

  /** Marks the session busy with a new turn, before any await, so a second command in the same tick sees it busy. */
  #claim(opened: Opened, owner: ServerConnection | undefined): Running {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const running: Running = {
      turn: this.#newId(),
      run: undefined,
      done,
      finish,
      controller: new AbortController(),
      queued: [],
      owner,
    };
    opened.running = running;
    return running;
  }

  /** Opens the session with its lock, writing through a store that announces what lands in its current file. */
  async #lockedHandle(session: string): Promise<Session> {
    let handle: Session | undefined;
    handle = await openSession({
      store: this.#storeFor(session, () => handle),
      index: this.#options.index,
      lock: this.#options.lock,
      key: this.key(session),
    });
    return handle;
  }

  async #start(
    connection: ServerConnection,
    requestId: Id,
    session: string,
    input: Command<"turn/start">["params"]["input"],
  ): Promise<Dispatched> {
    const opened = connection.watching(session) ? this.#opened.get(session) : undefined;
    if (opened === undefined) return { result: { accepted: false, reason: "invalid" } satisfies Disposition };
    if (this.#closed) throw failure(ErrorCodes.InternalError, "the dispatcher is closed");
    if (opened.running !== undefined || opened.branching === true) {
      return { result: { accepted: false, reason: "busy" } satisfies Disposition };
    }
    const running = this.#claim(opened, connection);
    // The client may cancel the turn by the id of its turn/start until the turn settles.
    connection.trackTurn(requestId, () => running.controller.abort("the client cancelled the turn"));
    const refuse = () => {
      connection.untrackTurn(requestId);
      opened.running = undefined;
      running.finish();
    };
    let handle: Session;
    try {
      handle = await this.#lockedHandle(session);
    } catch (error) {
      refuse();
      if (isHarnessError(error) && error.code === "session_locked")
        return { result: { accepted: false, reason: "locked" } satisfies Disposition };
      throw error;
    }
    if (this.#closed) {
      // close() returned while this turn was still taking the lock: give it back and refuse.
      await handle.close().catch(() => undefined);
      refuse();
      throw failure(ErrorCodes.InternalError, "the dispatcher is closed");
    }
    // The response goes out first; the run starts after it, so no event can reach a client before its disposition.
    let begin!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    void this.#run(handle, session, opened, running, input, started).finally(() => connection.untrackTurn(requestId));
    return { result: { accepted: true, turn: running.turn } satisfies Disposition, after: begin };
  }

  /** What every turn and every resume passes to the runner besides its own settings. */
  #turnHooks(session: string, running: Running) {
    const observer: Observer = (event) => this.emit(session, event);
    return {
      ...this.#options.turn,
      observers: [observer],
      signal: running.controller.signal,
      clientTool: this.#clientTool(session, running.owner),
      onRun: (run: Run<unknown>) => {
        running.run = run;
        for (const apply of running.queued.splice(0)) apply(run);
      },
    };
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
    let summary: TurnResultSummary;
    try {
      await this.#seed(handle, session);
      const result = await runTurn(handle, this.#options.harness, {
        ...this.#turnHooks(session, running),
        input,
        // The first run has ended and a retry may follow: a steer sent now waits in the queue for the retry's run.
        onOverflowRetry: () => {
          running.run = undefined;
        },
        onContextFill: (fill) => this.emit(session, { type: "context_fill", tokens: fill.tokens, budget: fill.budget }),
      });
      summary = summaryOf(result);
    } catch (error) {
      summary = summaryOf(undefined, error);
    } finally {
      // A lock that will not release must not leave the session busy or the turn unsettled.
      await handle.close().catch(() => undefined);
      this.#release(opened, running);
    }
    this.settled(session, running.turn, summary);
    running.finish();
    // An answer that came while the turn ran resumes it now.
    this.#pump(session);
  }

  /**
   * Frees the session. A steer or follow-up still queued for a run that never started ends with its turn: its
   * disposition named the turn, `turn/settled` says the turn ended, and the log has no message for it.
   */
  #release(opened: Opened, running: Running): void {
    running.queued.length = 0;
    running.run = undefined;
    opened.running = undefined;
  }

  /** Seeds the sequence a run's own events carry, so a session an earlier process wrote does not start at -1. */
  async #seed(handle: Session, session: string): Promise<void> {
    const last = (await handle.path()).at(-1);
    if (last !== undefined) this.#lastSeq.set(session, Math.max(last.seq, this.#lastSeq.get(session) ?? -1));
  }

  #redirect(
    connection: ServerConnection,
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
    connection: ServerConnection,
    session: string,
    reason: string | undefined,
  ): ClientResultMap["turn/interrupt"] {
    const running = connection.watching(session) ? this.#opened.get(session)?.running : undefined;
    if (running === undefined) return { interrupted: false };
    running.controller.abort(reason);
    return { interrupted: true };
  }

  async #approvalList(connection: ServerConnection, session: string): Promise<ClientResultMap["approval/list"]> {
    if (!connection.watching(session) || !this.#opened.has(session))
      throw failure(ErrorCodes.InvalidParams, `no session ${JSON.stringify(session)} is open`);
    const reader = await openSession({
      store: this.#options.store,
      index: this.#options.index,
      key: this.key(session),
    });
    const waiting = await this.#approvals.pending(reader);
    return { pending: waiting.map((entry) => entry.request) };
  }

  /** A fresh id for a server request, unique within this dispatcher. */
  #requestId(): string {
    this.#requests += 1;
    return `sr-${this.#requests}`;
  }

  /**
   * Asks one connection about a signed request, unless it already waits on that connection or someone has answered
   * it. Only a connection that watches the session is asked.
   */
  #ask(connection: ServerConnection, session: string, request: SignedPendingRequest): void {
    const opened = this.#opened.get(session);
    if (!connection.watching(session) || opened === undefined) return;
    if (opened.answers.has(request.id) || connection.asking(request.id)) return;
    const id = this.#requestId();
    connection.ask(
      request.kind === "clarification"
        ? { jsonrpc: "2.0", id, method: "clarification/request", params: { session, request } }
        : { jsonrpc: "2.0", id, method: "approval/request", params: { session, request } },
      {
        session,
        pendingId: request.id,
        answer: (answer) => this.#answer(connection, session, request, answer),
        // A request for a person lives in the log, so a lost connection loses nothing: the next client is asked.
        lost: () => undefined,
      },
    );
  }

  /** Asks one connection about every request of the session that still waits, as the log says now. */
  async #armFor(connection: ServerConnection, session: string): Promise<void> {
    let waiting: SignedPendingRequest[];
    try {
      const reader = await openSession({
        store: this.#options.store,
        index: this.#options.index,
        key: this.key(session),
      });
      waiting = pendingApprovals(await reader.path()).map((entry) => entry.request);
    } catch {
      // A session with no file yet has nothing to ask, and an unreadable one is listed by initialize as it can be.
      return;
    }
    for (const request of waiting) this.#ask(connection, session, request);
  }

  /**
   * Takes a client's answer to an approval or a clarification. The first well-formed answer to a signed request wins
   * and the others are withdrawn; a malformed one is asked again on the same connection; an error leaves the request
   * waiting in the log for the next time the session is opened.
   */
  #answer(connection: ServerConnection, session: string, request: SignedPendingRequest, answer: ServerAnswer): void {
    if ("error" in answer) return;
    const opened = this.#opened.get(session);
    if (opened === undefined || opened.answers.has(request.id)) return;
    const resolution = resolutionOf(answer.result, request);
    if (resolution === undefined) {
      this.#ask(connection, session, request);
      return;
    }
    opened.answers.set(request.id, { resolution, by: connection, applying: false });
    for (const other of this.#connections) other.withdrawPending(request.id);
    this.#pump(session);
  }

  /** Starts a resume with the answers that wait, once the session is free. */
  #pump(session: string): void {
    const opened = this.#opened.get(session);
    if (opened === undefined || opened.running !== undefined || opened.branching === true || this.#closed) return;
    const answers = [...opened.answers.entries()].filter(([, answer]) => !answer.applying);
    if (answers.length === 0) return;
    for (const [, answer] of answers) answer.applying = true;
    const running = this.#claim(opened, answers[0]?.[1].by);
    void this.#resume(session, opened, running, answers);
  }

  /**
   * Resumes the session with the answers through `Approvals.resolve()`, as a turn of its own that ends with
   * `turn/settled`. An answer whose request no longer waits, because another process settled it, is dropped, and a
   * resume with no answer left runs nothing and settles nothing.
   */
  async #resume(session: string, opened: Opened, running: Running, answers: [string, Answer][]): Promise<void> {
    let summary: TurnResultSummary | undefined;
    try {
      const handle = await this.#lockedHandle(session);
      try {
        const waiting = new Set(pendingApprovals(await handle.path()).map((entry) => entry.request.id));
        const resolutions = answers.flatMap(([id, answer]) => (waiting.has(id) ? [answer.resolution] : []));
        if (resolutions.length > 0) {
          await this.#seed(handle, session);
          summary = summaryOf(await this.#approvals.resolve(handle, resolutions, this.#turnHooks(session, running)));
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch (error) {
      summary = summaryOf(undefined, error);
    } finally {
      for (const [id] of answers) opened.answers.delete(id);
      this.#release(opened, running);
    }
    if (summary !== undefined) this.settled(session, running.turn, summary);
    running.finish();
    // A request the resume left waiting, such as one a quorum still needs, is asked again; a failed resume asks nothing,
    // so a client is not asked in a loop while another process holds the session.
    if (summary !== undefined && summary.error === undefined) {
      for (const connection of this.#watchers(session)) void this.#armFor(connection, session);
    }
    this.#pump(session);
  }

  /**
   * Runs a `client_request` tool's call by sending `tool/call` to the turn's owner, and resolves with its answer. A call
   * never hangs on a client that is gone: with no owner, or once the owner closes, it resolves with an error result,
   * and an abort withdraws the request with `$/cancelRequest` and rejects.
   */
  #clientTool(session: string, owner: ServerConnection | undefined): ClientToolRunner {
    return (call) =>
      new Promise((resolve, reject) => {
        if (call.signal.aborted) {
          reject(call.signal.reason);
          return;
        }
        if (owner === undefined || !owner.open || !owner.watching(session)) {
          resolve(toolError(`no client is connected to run ${call.tool}`));
          return;
        }
        const id = this.#requestId();
        const onAbort = () => {
          owner.withdraw(id);
          reject(call.signal.reason);
        };
        call.signal.addEventListener("abort", onAbort, { once: true });
        const settle = (result: ReturnType<typeof toolError>) => {
          call.signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        owner.ask(
          {
            jsonrpc: "2.0",
            id,
            method: "tool/call",
            params: { session, callId: call.callId, tool: call.tool, input: call.input },
          },
          {
            session,
            answer: (answer) =>
              settle(
                "error" in answer
                  ? toolError(`the client could not run ${call.tool}: ${answer.error.message}`)
                  : toolResultOf(answer.result, call.tool),
              ),
            lost: () => settle(toolError(`the client closed before it answered the call to ${call.tool}`)),
          },
        );
      });
  }

  async #branch(
    connection: ServerConnection,
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
      this.#pump(session);
    }
  }

  async #branchLocked(
    connection: ServerConnection,
    command: Command<"session/checkout" | "session/fork">,
    opened: Opened,
  ): Promise<ClientResultMap["session/fork"]> {
    const { session, entryId } = command.params;
    // A checkout is announced under its own session; a fork's entries belong to the new session, nobody watches yet.
    const handle =
      command.method === "session/checkout"
        ? await this.#lockedHandle(session)
        : await openSession({
            store: this.#options.store,
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
        this.#opened.set(id, newOpened(opened.cwd));
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

/** Creates the dispatcher that serves `options.harness` over the protocol's commands. */
export function createDispatcher<H = unknown>(options: DispatcherOptions<H>): Dispatcher {
  return new HarnessDispatcher(options);
}
