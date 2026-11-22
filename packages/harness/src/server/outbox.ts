/**
 * A connection's outbound queue. Messages go out one at a time and in order, and a `send` that returns a promise holds
 * the next message until it settles, so a slow client is the only thing that makes the queue grow. Only live `event`
 * notifications count against the bound. Once `limit` of them wait, a new one is dropped and counted against its
 * session, and an `events_dropped` marker takes the place of a session's dropped events: before that session's next
 * message, or once the queue has emptied. Everything else is never dropped: responses, server requests, `turn/settled`,
 * `$/cancelRequest`, markers and replayed events. What produces each of those bounds it, as `connection.ts` says.
 */
import type { ServerMessage } from "@buildanagent/protocol";

/** Takes one message. A promise holds the next message until it settles; a throw or a rejection is the client's own. */
export type Deliver = (message: ServerMessage) => void | PromiseLike<void>;

interface Queued {
  readonly message: ServerMessage;
  readonly droppable: boolean;
  readonly onSent: (() => void) | undefined;
}

interface Gap {
  count: number;
  seq: number;
}

/** What `push()` takes besides the message. */
export interface PushOptions {
  /** Keep the message even when the queue is full. Every message but a live `event` is kept anyway. */
  readonly keep?: boolean;
  /** Called once the message has gone to the client, or failed to. */
  readonly onSent?: () => void;
}

const isThenable = (value: unknown): value is PromiseLike<void> =>
  typeof (value as { then?: unknown } | null | undefined)?.then === "function";

/** The session a message belongs to, for the messages that name one. */
function sessionOf(message: ServerMessage): string | undefined {
  if (!("method" in message)) return undefined;
  const params = message.params as { session?: unknown };
  return typeof params.session === "string" ? params.session : undefined;
}

/** One connection's outbound queue, as the module comment describes. */
export class Outbox {
  readonly #deliver: Deliver;
  readonly #limit: number;
  readonly #queue: Queued[] = [];
  readonly #gaps = new Map<string, Gap>();
  #waitingEvents = 0;
  #pumping = false;
  #closed = false;

  constructor(deliver: Deliver, limit: number) {
    this.#deliver = deliver;
    this.#limit = limit;
  }

  /** Queues a message, or drops it when it is a live event and `limit` events already wait. */
  push(message: ServerMessage, options: PushOptions = {}): void {
    if (this.#closed) return;
    const droppable = "method" in message && message.method === "event" && options.keep !== true;
    if (droppable && this.#waitingEvents >= this.#limit) {
      this.markGap(message.params.session, 1, message.params.seq);
      return;
    }
    const session = sessionOf(message);
    if (session !== undefined) this.#flushGap(session);
    this.#enqueue({ message, droppable, onSent: options.onSent });
    this.#pump();
  }

  /** Counts `count` events of `session` as dropped, the last of which carried `seq`. */
  markGap(session: string, count: number, seq: number): void {
    const gap = this.#gaps.get(session);
    if (gap === undefined) this.#gaps.set(session, { count, seq });
    else {
      gap.count += count;
      gap.seq = Math.max(gap.seq, seq);
    }
  }

  /** Drops everything still queued and refuses what comes after. */
  close(): void {
    this.#closed = true;
    this.#queue.length = 0;
    this.#gaps.clear();
    this.#waitingEvents = 0;
  }

  #enqueue(item: Queued): void {
    this.#queue.push(item);
    if (item.droppable) this.#waitingEvents += 1;
  }

  /** Queues the marker for a session's dropped events, so it goes out before the session's next message. */
  #flushGap(session: string): void {
    const gap = this.#gaps.get(session);
    if (gap === undefined) return;
    this.#gaps.delete(session);
    this.#enqueue({
      message: {
        jsonrpc: "2.0",
        method: "event",
        params: { session, seq: gap.seq, event: { type: "events_dropped", count: gap.count } },
      },
      droppable: false,
      onSent: undefined,
    });
  }

  /**
   * Sends what waits, one message at a time. A message pushed while a send is in progress joins the same loop, and a
   * client that takes each message at once gets it at once, with no wait between messages.
   */
  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    while (!this.#closed) {
      const next = this.#queue.shift();
      if (next === undefined) {
        // The queue has room again, so the sessions whose events were dropped are told now.
        if (this.#gaps.size === 0) break;
        for (const session of [...this.#gaps.keys()]) this.#flushGap(session);
        continue;
      }
      if (next.droppable) this.#waitingEvents -= 1;
      const sent = this.#send(next);
      if (sent !== undefined) {
        const resume = () => {
          next.onSent?.();
          this.#pumping = false;
          this.#pump();
        };
        // A rejection is the client's own failure, as a throw is.
        sent.then(resume, resume);
        return;
      }
      next.onSent?.();
    }
    this.#pumping = false;
  }

  /** Delivers one message, and returns the promise to wait for when the client returned one. */
  #send(item: Queued): PromiseLike<void> | undefined {
    try {
      const sent = this.#deliver(item.message);
      return isThenable(sent) ? sent : undefined;
    } catch {
      // A client's own failure to take a message must not fail the write or the turn that produced it.
      return undefined;
    }
  }
}
