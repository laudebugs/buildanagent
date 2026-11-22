/**
 * One session as the CLI's client sees it: the events the server streams for it, the turns that settle, and the
 * requests for a person that wait for an answer. Opening a stored session replays its log first, and the replayed
 * events are marked, so the meter counts what the session has already cost while the screen shows only what is new.
 */
import type { InProcessClient } from "@buildanagent/harness/server";
import { RpcFailure } from "@buildanagent/harness/server";
import {
  ErrorCodes,
  type HarnessEvent,
  type ResponseMessage,
  type ServerMessage,
  type ServerRequest,
  type SessionEntry,
  type TurnResultSummary,
} from "@buildanagent/protocol";
import type { AgentEvent, Resolution } from "@buildanagent/sdk";
import { CliError } from "./errors.js";

/** A request for a person: an approval or a clarification. */
export type PersonRequest = Extract<ServerRequest, { method: "approval/request" | "clarification/request" }>;

/** Called with each event of the session; `replayed` is true for an event read back from the log on open. */
export type EventListener = (event: AgentEvent | HarnessEvent, seq: number, replayed: boolean) => void;

/** A settled turn. */
export interface Settled {
  readonly turn: string;
  readonly result: TurnResultSummary;
}

/** The stop reasons that mean a turn waits for a person. */
export const WAITING_REASONS: ReadonlySet<string> = new Set(["awaiting_approval", "clarification_requested"]);

/** How long `whenAsked()` waits for the server to ask about a request before it checks the log. */
export const ASK_WAIT_MS = 5_000;

/**
 * The `error.kind` of a resume's `turn/settled` when the server wrote none of its answers. The server forgets those
 * answers and asks about each request again.
 */
const NOT_APPLIED = "answer_not_applied";

/** Watches one session on `client`. Call `stop()` when done with it. */
export class SessionWatch {
  readonly session: string;
  /** The requests for a person that wait on this client, by request id. */
  readonly asked = new Map<string, PersonRequest>();
  /** The input each approval request's call would run with, from its `approval_requested` entry. */
  readonly inputs = new Map<string, unknown>();
  readonly #client: InProcessClient;
  readonly #answered = new Set<string>();
  /** The answers this client gave that no resume has written yet. */
  readonly #unwritten = new Set<string>();
  /** The answers a resume has written whose turn has not settled yet. */
  readonly #written = new Set<string>();
  readonly #settled: Settled[] = [];
  readonly #waiters: ((settled: Settled) => void)[] = [];
  readonly #changes: (() => void)[] = [];
  readonly #unsubscribe: () => void;
  #replaying = false;

  constructor(client: InProcessClient, session: string, listener: EventListener) {
    this.#client = client;
    this.session = session;
    this.#unsubscribe = client.onMessage((message) => {
      if (!("method" in message)) return;
      if (message.method === "$/cancelRequest") this.#withdraw(message.params.id);
      else if ((message.params as { session?: unknown }).session === session) this.#take(message, listener);
    });
  }

  /** Takes one message of this session. */
  #take(message: Exclude<ServerMessage, ResponseMessage<unknown>>, listener: EventListener): void {
    if (message.method === "event") {
      const { event, seq } = message.params;
      if (event.type === "entry_appended") this.#entry(event.entry);
      listener(event, seq, this.#replaying);
    } else if (message.method === "turn/settled") {
      this.#written.clear();
      // The server forgot the answers it could not write and asks about their requests again.
      if (message.params.result.error?.kind === NOT_APPLIED) this.#unwritten.clear();
      const settled = { turn: message.params.turn, result: message.params.result };
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#settled.push(settled);
      else waiter(settled);
    } else if (message.method === "approval/request" || message.method === "clarification/request") {
      this.asked.set(message.params.request.id, message);
      this.#unwritten.delete(message.params.request.id);
      this.#changed();
    } else if (message.method === "tool/call") {
      // The terminal has no client side for a tool to run on, so the call fails at once instead of waiting forever.
      this.#client.fail(message, {
        code: ErrorCodes.MethodNotFound,
        message: `the buildanagent CLI runs no client tools, so register ${message.params.tool} to run in process`,
      });
    }
  }

  /** Notes what an entry says about the requests: the input an approval would run with, or an answer written. */
  #entry(entry: SessionEntry): void {
    if (entry.type === "approval_requested") this.inputs.set(entry.request.id, entry.input);
    else if (entry.type === "approval_resolved" && this.#unwritten.delete(entry.resolution.requestId)) {
      this.#written.add(entry.resolution.requestId);
    }
  }

  #withdraw(id: string | number): void {
    for (const [requestId, request] of this.asked) if (request.id === id) this.asked.delete(requestId);
    this.#changed();
  }

  #changed(): void {
    for (const notify of this.#changes.splice(0)) notify();
  }

  /** Resolves `true` at the next change to `asked`, or `false` once `ms` pass without one. */
  #changeWithin(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const notify = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const at = this.#changes.indexOf(notify);
        if (at >= 0) this.#changes.splice(at, 1);
        resolve(false);
      }, ms);
      this.#changes.push(notify);
    });
  }

  /** Marks the events that follow as replayed until `replayed` is called with false. */
  replaying(on: boolean): void {
    this.#replaying = on;
  }

  /** The next turn to settle, or one that settled and has not been taken yet. */
  nextSettled(): Promise<Settled> {
    const ready = this.#settled.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /**
   * Resolves once every request in `ids` has been asked on this client, answered, withdrawn or settled elsewhere. The
   * server asks about a stored session's requests when it opens, but it skips them when it can't read the log in
   * time, so after `waitMs` without a change the log decides. Throws a `CliError`, code `session_unavailable`, when a
   * request still waits there that the server never asked about.
   */
  async whenAsked(ids: readonly string[], waitMs = ASK_WAIT_MS): Promise<void> {
    const unasked = (id: string) => !this.asked.has(id) && !this.#answered.has(id);
    let left = ids.filter(unasked);
    while (left.length > 0) {
      const changed = await this.#changeWithin(waitMs);
      left = left.filter(unasked);
      if (changed || left.length === 0) continue;
      const waiting = await this.#waitingIds();
      left = left.filter((id) => waiting.has(id) && unasked(id));
      if (left.length > 0) {
        throw new CliError(
          "session_unavailable",
          `session ${this.session} still waits on ${left.join(", ")}, which the server never asked about: ` +
            "run resume again",
        );
      }
    }
  }

  /** Answers one request for a person. */
  answer(request: PersonRequest, resolution: Resolution): void {
    const id = request.params.request.id;
    this.asked.delete(id);
    this.#answered.add(id);
    this.#unwritten.add(id);
    this.#client.respond(request, { resolutions: [resolution] });
  }

  /**
   * Whether another turn will settle for an answer this client gave: a settled turn is ready to take, a resume has
   * written one of the answers and still runs, or the log still shows an answered request waiting, so a resume will
   * take it. An answered request the log no longer shows, and that no resume of ours wrote, was settled by another
   * process, and no turn settles for it here.
   */
  async settlePending(): Promise<boolean> {
    if (this.#settled.length > 0 || this.#written.size > 0) return true;
    if (this.#unwritten.size === 0) return false;
    const waiting = await this.#waitingIds();
    for (const id of this.#unwritten) if (!waiting.has(id)) this.#unwritten.delete(id);
    return this.#settled.length > 0 || this.#written.size > 0 || this.#unwritten.size > 0;
  }

  async #waitingIds(): Promise<Set<string>> {
    const { pending } = await this.#client.request("approval/list", { session: this.session });
    return new Set(pending.map((request) => request.id));
  }

  /** Stops listening. */
  stop(): void {
    this.#unsubscribe();
  }
}

const isUnknownSession = (error: unknown): boolean =>
  error instanceof RpcFailure && /^no session /.test(error.rpc.message);

/**
 * Opens a stored session on `watch`'s client and replays its log into the watch, marked as replayed. Resolves with
 * the ids of the requests that still wait, once the replay is in: the `approval/list` answer comes after it. Throws a
 * `CliError`, code `unknown_session`, when no session has the id.
 */
export async function openStored(client: InProcessClient, watch: SessionWatch, cwd: string): Promise<string[]> {
  watch.replaying(true);
  try {
    await client.request("session/open", { session: watch.session, cwd, fromSeq: 0 });
    const { pending } = await client.request("approval/list", { session: watch.session });
    return pending.map((request) => request.id);
  } catch (error) {
    if (isUnknownSession(error)) throw new CliError("unknown_session", `no session ${JSON.stringify(watch.session)}`);
    throw error;
  } finally {
    watch.replaying(false);
  }
}

/** Starts a turn with `text` and resolves once it settles. Throws a `CliError` when the session refuses the turn. */
export async function runTurn(client: InProcessClient, watch: SessionWatch, text: string): Promise<TurnResultSummary> {
  const disposition = await client.request("turn/start", {
    session: watch.session,
    input: [{ type: "text", text }],
  });
  if (!disposition.accepted) {
    const why =
      disposition.reason === "locked" ? "another process is writing it" : `the server said ${disposition.reason}`;
    throw new CliError("session_unavailable", `session ${watch.session} can't take a turn: ${why}`);
  }
  // A settlement of another turn taken here is dropped safely. The server runs one turn of a session at a time and
  // refuses `turn/start` while a resume runs, so such a settlement is a resume that ended before this turn started;
  // and `settlePending()` never waits on it, because every `turn/settled` clears the written answers as it arrives,
  // whoever takes it, and an unwritten answer counts only while the log still shows its request waiting.
  for (;;) {
    const settled = await watch.nextSettled();
    if (settled.turn === disposition.turn) return settled.result;
  }
}
