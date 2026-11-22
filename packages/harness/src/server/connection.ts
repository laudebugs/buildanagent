/**
 * One client's end of the dispatcher: what it may see, what it has asked, and what the server has asked it. A
 * connection receives only the events of the sessions it created or opened. It holds at most `limit` commands at a
 * time, counting each until its response has gone out, so a client that sends faster than it reads is refused with
 * `QueueFull` instead of growing the queue. At most `limit` refusals wait to go out, and past that the connection is
 * closed, because a client that neither reads nor waits would otherwise grow the queue with refusals. What waits also
 * bounds the server requests the connection holds: one per pending approval or clarification of a session it watches,
 * and one per `client_request` tool call that a turn it started makes.
 */
import {
  type ClientCommand,
  type ClientMessage,
  ErrorCodes,
  type Id,
  type RpcError,
  type ServerMessage,
  type ServerNotification,
  type ServerRequest,
} from "@buildanagent/protocol";
import { isHarnessError } from "../errors.js";
import { type Deliver, Outbox } from "./outbox.js";

/** A client's answer to a server request: its result, or the error it sent instead. */
export type ServerAnswer = { readonly result: unknown } | { readonly error: RpcError };

/** A server request the client has not answered yet. */
export interface Asked {
  readonly session: string;
  /** For an approval or a clarification, the id of the signed request it asks about. */
  readonly pendingId?: string;
  /** Called once with the client's answer. */
  answer(answer: ServerAnswer): void;
  /** Called once if the connection closes before an answer. */
  lost(): void;
}

/** What a connection asks of the dispatcher it belongs to. */
export interface ConnectionHost {
  /** Runs one command and returns its result, with what to do once the response has gone out. */
  dispatch(connection: ServerConnection, command: ClientCommand & { id: Id }): Promise<Dispatched>;
  /** Forgets a connection that closed. */
  detach(connection: ServerConnection): void;
}

/** A command's outcome: its result, and what runs right after its response has been queued. */
export interface Dispatched {
  readonly result: unknown;
  readonly after?: () => void;
}

/** An error the dispatcher answers a command with. */
export class Failure extends Error {
  readonly rpc: RpcError;
  constructor(code: number, message: string) {
    super(message);
    this.rpc = { code, message };
  }
}

type EventMessage = Extract<ServerNotification, { method: "event" }>;
type SettledMessage = Extract<ServerNotification, { method: "turn/settled" }>;

/**
 * What a session sent while a `session/open` was reading its log, waiting to go out after the replay. Events count
 * against the bound. A `turn/settled` is always kept, and needs no bound of its own: the session runs one turn at a
 * time, so one read of the log sees few of them.
 */
interface Held {
  readonly messages: (EventMessage | SettledMessage)[];
  events: number;
  /** Dropped events that are not entries, and the latest `seq` among them. */
  dropped: number;
  lastDroppedSeq: number;
  /**
   * The first and last `seq` of the dropped entries. Once the hold is full every later entry is dropped, so the range
   * has no hole, and the replay may already carry its start.
   */
  droppedEntries: { first: number; last: number } | undefined;
  /** How many of `messages` came before the first drop, so the marker goes out where the drops were. */
  gapAt: number | undefined;
}

const isId = (value: unknown): value is Id =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

/** One client's connection to the dispatcher, as the module comment describes. */
export class ServerConnection {
  readonly #host: ConnectionHost;
  readonly #outbox: Outbox;
  readonly #limit: number;
  readonly #watching = new Set<string>();
  readonly #held = new Map<string, Held>();
  readonly #optedIn = new Set<string>();
  readonly #asked = new Map<string, Asked>();
  readonly #turns = new Map<Id, () => void>();
  #inFlight = 0;
  #refusals = 0;
  #open = true;

  constructor(host: ConnectionHost, deliver: Deliver, limit: number) {
    this.#host = host;
    this.#outbox = new Outbox(deliver, limit);
    this.#limit = limit;
  }

  /** Whether the client is still connected. */
  get open(): boolean {
    return this.#open;
  }

  /** Sends a message that belongs to no session's stream: a response or a cancel. */
  send(message: ServerMessage): void {
    this.#outbox.push(message);
  }

  /** Sends a session's `turn/settled` to a connection that watches it, after any replay that is being prepared. */
  settled(message: SettledMessage): void {
    const held = this.#held.get(message.params.session);
    if (held !== undefined) held.messages.push(message);
    else if (this.#watching.has(message.params.session)) this.#outbox.push(message);
  }

  /** Sends a live event of a session this connection watches, or holds it while the session is being opened. */
  event(message: EventMessage): void {
    const held = this.#held.get(message.params.session);
    if (held === undefined) {
      if (this.#watching.has(message.params.session)) this.#outbox.push(message);
      return;
    }
    // A hold lasts one read of the log, and is bounded as the queue is: past the bound, events are counted as dropped.
    if (held.events < this.#limit) {
      held.messages.push(message);
      held.events += 1;
    } else {
      held.gapAt ??= held.messages.length;
      const { seq } = message.params;
      if (message.params.event.type === "entry_appended") {
        held.droppedEntries = { first: held.droppedEntries?.first ?? seq, last: seq };
      } else {
        held.dropped += 1;
        held.lastDroppedSeq = Math.max(held.lastDroppedSeq, seq);
      }
    }
  }

  watch(session: string): void {
    this.#watching.add(session);
  }

  /** Whether this connection created or opened the session. */
  watching(session: string): boolean {
    return this.#watching.has(session);
  }

  /** Starts holding a session's live events, so none is lost or sent early while its log is read. False if one is already held. */
  hold(session: string): boolean {
    if (this.#held.has(session)) return false;
    this.#held.set(session, {
      messages: [],
      events: 0,
      dropped: 0,
      lastDroppedSeq: -1,
      droppedEntries: undefined,
      gapAt: undefined,
    });
    return true;
  }

  /**
   * Ends the hold of a failed open, and leaves the session as watched or unwatched as it was. A connection that
   * already watched the session still gets what was held, because those messages are its live stream; one that did
   * not gets nothing.
   */
  unhold(session: string): void {
    if (this.#watching.has(session)) this.release(session, [], -1);
    else this.#held.delete(session);
  }

  /**
   * Watches the session: sends `replay`, which is never dropped, then what was held since `hold()`, leaving out an
   * appended entry whose `seq` is at or before `replayedTo` because the replay already carried it.
   */
  release(session: string, replay: readonly EventMessage[], replayedTo: number): void {
    const held = this.#held.get(session);
    this.#held.delete(session);
    this.#watching.add(session);
    for (const message of replay) this.#outbox.push(message, { keep: true });
    const marker = () => {
      const gap = held === undefined ? undefined : gapOf(held, replayedTo);
      if (gap !== undefined) this.#outbox.pushGap(session, gap.count, gap.seq);
    };
    for (const [index, message] of (held?.messages ?? []).entries()) {
      // The drops began once the hold was full, so their marker goes out before what was held after them.
      if (index === held?.gapAt) marker();
      if (message.method === "event" && message.params.event.type === "entry_appended") {
        if (message.params.seq <= replayedTo) continue;
      }
      this.#outbox.push(message);
    }
    if (held?.gapAt !== undefined && held.gapAt >= held.messages.length) marker();
  }

  optIn(methods: readonly string[]): void {
    for (const method of methods) this.#optedIn.add(method);
  }

  optedIn(method: string): boolean {
    return this.#optedIn.has(method);
  }

  /** Sends a server request and remembers it until the client answers, the server withdraws it, or the connection closes. */
  ask(request: ServerRequest, asked: Asked): void {
    if (!this.#open) {
      asked.lost();
      return;
    }
    this.#asked.set(request.id, asked);
    this.#outbox.push(request);
  }

  /** Whether an approval or clarification about this signed request waits for this client's answer. */
  asking(pendingId: string): boolean {
    for (const asked of this.#asked.values()) if (asked.pendingId === pendingId) return true;
    return false;
  }

  /** Withdraws a server request with `$/cancelRequest`. Returns false when it was already answered or withdrawn. */
  withdraw(id: string): boolean {
    if (!this.#asked.delete(id)) return false;
    if (this.#open) this.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
    return true;
  }

  /** Withdraws every request this client holds about one signed request, because someone else answered it. */
  withdrawPending(pendingId: string): void {
    for (const [id, asked] of [...this.#asked]) if (asked.pendingId === pendingId) this.withdraw(id);
  }

  /** Lets the client cancel its own `turn/start` by id until the turn settles. */
  trackTurn(id: Id, cancel: () => void): void {
    this.#turns.set(id, cancel);
  }

  /** Stops tracking a turn, unless a later `turn/start` that reused the id has replaced its canceller. */
  untrackTurn(id: Id, cancel: () => void): void {
    if (this.#turns.get(id) === cancel) this.#turns.delete(id);
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#outbox.close();
    const asked = [...this.#asked.values()];
    this.#asked.clear();
    this.#turns.clear();
    this.#held.clear();
    this.#host.detach(this);
    for (const request of asked) request.lost();
  }

  /** Handles one message from the client, and resolves once its response, if it has one, is queued. */
  async receive(message: ClientMessage): Promise<void> {
    if (!this.#open) return;
    if (!("method" in message)) {
      this.#answered(message);
      return;
    }
    if (!("id" in message)) {
      if (message.method === "$/cancelRequest") this.#cancel(message.params?.id);
      return;
    }
    await this.#command(message as ClientCommand & { id: Id });
  }

  /**
   * Answers a command the full queue can't take with `QueueFull`. The refusal takes no command's place, but it waits to
   * go out like any response, so a client that keeps sending without reading would grow the queue: once `limit`
   * refusals wait, the server closes the connection instead.
   */
  #refuse(id: Id): void {
    if (this.#refusals >= this.#limit) {
      this.close();
      return;
    }
    this.#refusals += 1;
    this.#outbox.push(
      {
        jsonrpc: "2.0",
        id,
        error: { code: ErrorCodes.QueueFull, message: `the queue holds ${this.#limit} commands; send again later` },
      },
      {
        onSent: () => {
          this.#refusals -= 1;
        },
      },
    );
  }

  /** A client's answer to a server request. One with an id this connection is not waiting on is ignored. */
  #answered(message: Exclude<ClientMessage, ClientCommand>): void {
    if (typeof message.id !== "string") return;
    const asked = this.#asked.get(message.id);
    if (asked === undefined) return;
    this.#asked.delete(message.id);
    asked.answer("error" in message ? { error: message.error } : { result: message.result });
  }

  #cancel(id: unknown): void {
    if (isId(id)) this.#turns.get(id)?.();
  }

  async #command(command: ClientCommand & { id: Id }): Promise<void> {
    if (this.#inFlight >= this.#limit) {
      this.#refuse(command.id);
      return;
    }
    this.#inFlight += 1;
    // The command holds its place until its response has gone out, so a client that doesn't read is refused soon.
    const onSent = () => {
      this.#inFlight -= 1;
    };
    let after: (() => void) | undefined;
    try {
      const outcome = await this.#host.dispatch(this, command);
      after = outcome.after;
      this.#outbox.push({ jsonrpc: "2.0", id: command.id, result: outcome.result as never }, { onSent });
    } catch (error) {
      this.#outbox.push({ jsonrpc: "2.0", id: command.id, error: rpcErrorOf(error) }, { onSent });
    } finally {
      // A closed outbox drops the response, so it never calls back.
      if (!this.#open) this.#inFlight = 0;
      after?.();
    }
  }
}

/**
 * What a hold really lost: its dropped events, less the entries the replay carried up to `replayedTo`. The marker's
 * `seq` is never below `replayedTo`, because the client has everything up to there. `undefined` when nothing was lost.
 */
function gapOf(held: Held, replayedTo: number): { count: number; seq: number } | undefined {
  const entries = held.droppedEntries;
  const lostEntries =
    entries === undefined ? 0 : Math.max(0, entries.last - Math.max(entries.first, replayedTo + 1) + 1);
  const count = held.dropped + lostEntries;
  if (count === 0) return undefined;
  return { count, seq: Math.max(held.lastDroppedSeq, entries?.last ?? -1, replayedTo) };
}

/** The error a failed command answers with. */
function rpcErrorOf(error: unknown): RpcError {
  if (error instanceof Failure) return error.rpc;
  const message = error instanceof Error ? error.message : String(error);
  if (isHarnessError(error) && error.code === "entry_not_found") return { code: ErrorCodes.InvalidParams, message };
  if (isHarnessError(error) && error.code === "session_locked") return { code: ErrorCodes.SessionLocked, message };
  return { code: ErrorCodes.InternalError, message };
}
