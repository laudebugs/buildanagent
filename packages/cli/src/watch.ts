/**
 * One session as the CLI's client sees it: the events the server streams for it, the turns that settle, and the
 * requests for a person that wait for an answer. Opening a stored session replays its log first, and the replayed
 * events are marked, so the meter counts what the session has already cost while the screen shows only what is new.
 */
import type { InProcessClient } from "@buildanagent/harness/server";
import { RpcFailure } from "@buildanagent/harness/server";
import type {
  HarnessEvent,
  ResponseMessage,
  ServerMessage,
  ServerRequest,
  TurnResultSummary,
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

/** Watches one session on `client`. Call `stop()` when done with it. */
export class SessionWatch {
  readonly session: string;
  /** The requests for a person that wait on this client, by request id. */
  readonly asked = new Map<string, PersonRequest>();
  /** The input each approval request's call would run with, from its `approval_requested` entry. */
  readonly inputs = new Map<string, unknown>();
  readonly #client: InProcessClient;
  readonly #answered = new Set<string>();
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
      if (event.type === "entry_appended" && event.entry.type === "approval_requested") {
        this.inputs.set(event.entry.request.id, event.entry.input);
      }
      listener(event, seq, this.#replaying);
    } else if (message.method === "turn/settled") {
      const settled = { turn: message.params.turn, result: message.params.result };
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#settled.push(settled);
      else waiter(settled);
    } else if (message.method === "approval/request" || message.method === "clarification/request") {
      this.asked.set(message.params.request.id, message);
      this.#changed();
    }
  }

  #withdraw(id: string | number): void {
    for (const [requestId, request] of this.asked) if (request.id === id) this.asked.delete(requestId);
    this.#changed();
  }

  #changed(): void {
    for (const notify of this.#changes.splice(0)) notify();
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

  /** Resolves once every request in `ids` has been asked on this client, answered or withdrawn. */
  async whenAsked(ids: readonly string[]): Promise<void> {
    while (ids.some((id) => !this.asked.has(id) && !this.#answered.has(id))) {
      await new Promise<void>((resolve) => this.#changes.push(resolve));
    }
  }

  /** Answers one request for a person. */
  answer(request: PersonRequest, resolution: Resolution): void {
    this.asked.delete(request.params.request.id);
    this.#answered.add(request.params.request.id);
    this.#client.respond(request, { resolutions: [resolution] });
  }

  /** Whether an answer this client gave still waits for its call to run, so another turn will settle. */
  async answerPending(): Promise<boolean> {
    const { pending } = await this.#client.request("approval/list", { session: this.session });
    return pending.some((request) => this.#answered.has(request.id));
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
  for (;;) {
    const settled = await watch.nextSettled();
    if (settled.turn === disposition.turn) return settled.result;
  }
}
