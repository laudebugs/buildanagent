/**
 * `assertStreamContract()`: checks the stream rule every adapter and test model must follow (SDK plan §3.2).
 *
 * 1. `start` comes first, once.
 * 2. Each content index goes `*_start` → `*_delta`* → `*_end`, with one kind (text, reasoning or tool input) per index.
 * 3. Exactly one terminal event, `done` or `error`, ends the stream, and nothing follows it.
 * 4. An `error` terminal's message has `stopReason` `"error"` or `"aborted"`; a `done` terminal's has neither, and
 *    every block it started has ended.
 * 5. A gateway `retry` event comes after `start` and before any block event, because output is never retried.
 * 6. A `warning` may come anywhere between `start` and the terminal event. It is not output, so a retry may follow it.
 */
import type { GatewayEvent } from "./runtime-types.js";
import type { ModelEvent } from "./spec.js";

export class StreamContractError extends Error {
  override readonly name = "StreamContractError";
  /** Position of the offending event in the stream, or the stream length when the stream ended early. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

type BlockKind = "text" | "reasoning" | "tool_input";
type BlockPhase = "start" | "delta" | "end";

function blockPhase(type: GatewayEvent["type"]): { kind: BlockKind; phase: BlockPhase } | undefined {
  const match = /^(text|reasoning|tool_input)_(start|delta|end)$/.exec(type);
  if (!match) return undefined;
  return { kind: match[1] as BlockKind, phase: match[2] as BlockPhase };
}

/** Tracks one stream's state and checks each event against the stream rule. */
class StreamChecker {
  readonly seen: GatewayEvent[] = [];
  readonly #open = new Map<number, BlockKind>();
  readonly #closed = new Set<number>();
  #terminal = false;
  #output = false;

  get ended(): boolean {
    return this.#terminal;
  }

  check(event: GatewayEvent): void {
    const position = this.seen.length;
    this.seen.push(event);
    const fail = (message: string): never => {
      throw new StreamContractError(`${message} (event ${position}: ${event.type})`, position);
    };
    this.#checkOrder(event, position, fail);
    if (event.type === "done" || event.type === "error") {
      this.#checkTerminal(event, fail);
      return;
    }
    if (event.type === "retry" && this.#output) fail("a retry arrived after output was streamed");
    const block = blockPhase(event.type);
    if (!block) return;
    this.#output = true;
    this.#checkBlock((event as { index: number }).index, block.kind, block.phase, fail);
  }

  #checkOrder(event: GatewayEvent, position: number, fail: (message: string) => never): void {
    if (this.#terminal) fail("an event followed the terminal event");
    if (position === 0 && event.type !== "start") fail("the stream must begin with start");
    if (position > 0 && event.type === "start") fail("start appeared twice");
  }

  #checkTerminal(event: Extract<ModelEvent, { type: "done" | "error" }>, fail: (message: string) => never): void {
    this.#terminal = true;
    const { stopReason } = event.message;
    const failed = stopReason === "error" || stopReason === "aborted";
    if (event.type === "error" && !failed)
      fail(`an error terminal needs stopReason error or aborted, got ${stopReason}`);
    if (event.type === "done" && failed) fail(`a done terminal cannot have stopReason ${stopReason}`);
    if (event.type === "done" && this.#open.size > 0) {
      fail(`done arrived with open blocks at index ${[...this.#open.keys()].join(", ")}`);
    }
  }

  #checkBlock(index: number, kind: BlockKind, phase: BlockPhase, fail: (message: string) => never): void {
    if (phase === "start") {
      if (this.#open.has(index) || this.#closed.has(index)) fail(`index ${index} started twice`);
      this.#open.set(index, kind);
      return;
    }
    if (this.#closed.has(index)) fail(`a ${kind}_${phase} arrived after index ${index} ended`);
    const openKind = this.#open.get(index);
    if (openKind === undefined) fail(`a ${kind}_${phase} arrived before index ${index} started`);
    if (openKind !== kind) fail(`index ${index} started as ${openKind} but got ${kind}_${phase}`);
    if (phase === "end") {
      this.#open.delete(index);
      this.#closed.add(index);
    }
  }
}

/**
 * Consumes the stream, throws `StreamContractError` at the first violation, and returns every event it read. It
 * checks an adapter's stream and a `Model.stream()` with its `retry` events alike.
 */
export async function assertStreamContract<E extends GatewayEvent>(events: AsyncIterable<E>): Promise<E[]> {
  const checker = new StreamChecker();
  const seen: E[] = [];
  for await (const event of events) {
    checker.check(event);
    seen.push(event);
  }
  if (!checker.ended) {
    throw new StreamContractError("the stream ended without a done or error event", checker.seen.length);
  }
  return seen;
}
