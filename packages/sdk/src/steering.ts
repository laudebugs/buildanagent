/**
 * Steering and follow-up (SDK plan §3.3). A caller queues a user message while a run goes on; the loop applies it
 * only at a step boundary, so a running model call or tool batch is never cut. A steer is applied before the run's
 * next model call. A follow-up waits until the run would otherwise end. Each queued message returns a receipt once
 * it has entered the transcript.
 */
import type { ContentBlock } from "@buildanagent/gateway";
import { SdkError } from "./errors.js";

/** Whether a message steers the run now or follows up once it would otherwise end. */
export type DeliveryKind = "steer" | "follow_up";

/**
 * Proof that a queued message entered the transcript. `id` is unique within the run, `message` is the content the
 * run added as a user message, and `stepIndex` is the step at whose start the run added it. That step's model call is
 * the first to see the message, unless the run ends before the call, which a budget stop or a failed hook can cause.
 */
export interface DeliveryReceipt {
  readonly id: string;
  readonly kind: DeliveryKind;
  readonly message: readonly ContentBlock[];
  readonly stepIndex: number;
}

interface Queued {
  readonly id: string;
  readonly kind: DeliveryKind;
  readonly message: readonly ContentBlock[];
  readonly resolve: (receipt: DeliveryReceipt) => void;
  readonly reject: (error: unknown) => void;
}

/** A message the loop took from the queue, with the function that settles its receipt. */
export interface Delivery {
  readonly kind: DeliveryKind;
  readonly message: readonly ContentBlock[];
  /** Settles the receipt once the message is in the transcript. */
  readonly deliver: (stepIndex: number) => DeliveryReceipt;
}

/** A copy of one block of a steering message that holds only the block's own fields. */
function checkBlock(block: unknown): ContentBlock {
  const candidate = block as { type?: unknown; text?: unknown; mediaType?: unknown; data?: unknown } | null;
  if (candidate?.type === "text" && typeof candidate.text === "string") {
    // Providers refuse an empty text block, so it is refused here rather than failing the next model call.
    if (candidate.text.trim().length === 0) {
      throw new SdkError("invalid_run_options", "a steering message's text block must not be empty");
    }
    return { type: "text", text: candidate.text };
  }
  if (candidate?.type === "image" && typeof candidate.mediaType === "string" && typeof candidate.data === "string") {
    return { type: "image", mediaType: candidate.mediaType, data: candidate.data };
  }
  throw new SdkError("invalid_run_options", "a steering message holds only text and image blocks");
}

/** The content of a steering message: a string that isn't blank, or a non-empty list of text and image blocks. */
function contentOf(message: unknown): ContentBlock[] {
  if (typeof message === "string") {
    if (message.trim().length === 0) throw new SdkError("invalid_run_options", "a steering message must not be empty");
    return [{ type: "text", text: message }];
  }
  if (!Array.isArray(message) || message.length === 0) {
    throw new SdkError("invalid_run_options", "a steering message must be a string or a non-empty list of blocks");
  }
  return message.map(checkBlock);
}

/**
 * The queue between a caller and the loop. The caller adds with `steer()` and `followUp()`; the loop takes with
 * `take()` at a step boundary, and closes the queue when the run has its outcome.
 */
export class SteeringQueue {
  readonly #runId: string;
  #queue: Queued[] = [];
  #count = 0;
  #closed = false;

  constructor(runId: string) {
    this.#runId = runId;
  }

  /**
   * Queues a message. The promise rejects, never throws, for an unusable message or a run that has ended. A caller who
   * ignores the promise must not crash the process when the run ends first, so a rejection is always marked handled;
   * a caller who awaits it still sees it.
   */
  add(kind: DeliveryKind, message: string | readonly ContentBlock[]): Promise<DeliveryReceipt> {
    const receipt = this.#enqueue(kind, message);
    receipt.catch(() => undefined);
    return receipt;
  }

  #enqueue(kind: DeliveryKind, message: string | readonly ContentBlock[]): Promise<DeliveryReceipt> {
    let content: ContentBlock[];
    try {
      content = contentOf(message);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#closed) return Promise.reject(undelivered(kind));
    this.#count += 1;
    const id = `${this.#runId}:message-${this.#count}`;
    return new Promise<DeliveryReceipt>((resolve, reject) => {
      this.#queue.push({ id, kind, message: content, resolve, reject });
    });
  }

  /** True while a steer is waiting. */
  hasSteers(): boolean {
    return this.#queue.some((entry) => entry.kind === "steer");
  }

  /** True while any message is waiting. */
  hasPending(): boolean {
    return this.#queue.length > 0;
  }

  /**
   * Removes and returns the waiting steers, and the waiting follow-ups too when `withFollowUps` is set, all in the
   * order they were sent.
   */
  take(withFollowUps: boolean): Delivery[] {
    const taken = this.#queue.filter((entry) => withFollowUps || entry.kind === "steer");
    this.#queue = this.#queue.filter((entry) => !taken.includes(entry));
    return taken.map((entry) => ({
      kind: entry.kind,
      message: entry.message,
      deliver: (stepIndex) => {
        const receipt: DeliveryReceipt = { id: entry.id, kind: entry.kind, message: entry.message, stepIndex };
        entry.resolve(receipt);
        return receipt;
      },
    }));
  }

  /** Ends the queue: every message still waiting is rejected, and later calls are too. */
  close(): void {
    this.#closed = true;
    const waiting = this.#queue;
    this.#queue = [];
    for (const entry of waiting) entry.reject(undelivered(entry.kind));
  }
}

function undelivered(kind: DeliveryKind): SdkError {
  return new SdkError(
    "undelivered_message",
    `the ${kind === "steer" ? "steer" : "follow-up"} was not applied: the run ended before its next step boundary`,
  );
}
