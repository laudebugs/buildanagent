/**
 * `assertStreamContract()`: checks the stream rule every adapter and test model must follow (SDK plan §3.2).
 *
 * 1. `start` comes first, once.
 * 2. Each content index goes `*_start` → `*_delta`* → `*_end`, with one kind (text, reasoning or tool input) per index.
 * 3. Exactly one terminal event, `done` or `error`, ends the stream, and nothing follows it.
 * 4. An `error` terminal's message has `stopReason` `"error"` or `"aborted"`; a `done` terminal's has neither, and
 *    every block it started has ended.
 */
import type { ModelEvent } from "./spec.ts";

export class StreamContractError extends Error {
  override readonly name = "StreamContractError";
  constructor(
    message: string,
    /** Position of the offending event in the stream, or the stream length when the stream ended early. */
    readonly position: number,
  ) {
    super(message);
  }
}

type BlockKind = "text" | "reasoning" | "tool_input";

function blockPhase(type: ModelEvent["type"]): { kind: BlockKind; phase: "start" | "delta" | "end" } | undefined {
  const match = /^(text|reasoning|tool_input)_(start|delta|end)$/.exec(type);
  if (!match) return undefined;
  return { kind: match[1] as BlockKind, phase: match[2] as "start" | "delta" | "end" };
}

/** Consumes the stream, throws `StreamContractError` at the first violation, and returns every event it read. */
export async function assertStreamContract(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const seen: ModelEvent[] = [];
  const open = new Map<number, BlockKind>();
  const closed = new Set<number>();
  let terminal = false;

  for await (const event of events) {
    const position = seen.length;
    seen.push(event);
    const fail = (message: string): never => {
      throw new StreamContractError(`${message} (event ${position}: ${event.type})`, position);
    };

    if (terminal) fail("an event followed the terminal event");
    if (position === 0 && event.type !== "start") fail("the stream must begin with start");
    if (position > 0 && event.type === "start") fail("start appeared twice");

    if (event.type === "done" || event.type === "error") {
      terminal = true;
      const { stopReason } = event.message;
      const failed = stopReason === "error" || stopReason === "aborted";
      if (event.type === "error" && !failed)
        fail(`an error terminal needs stopReason error or aborted, got ${stopReason}`);
      if (event.type === "done" && failed) fail(`a done terminal cannot have stopReason ${stopReason}`);
      if (event.type === "done" && open.size > 0)
        fail(`done arrived with open blocks at index ${[...open.keys()].join(", ")}`);
      continue;
    }

    const block = blockPhase(event.type);
    if (!block) continue; // start
    const { index } = event as { index: number };
    if (block.phase === "start") {
      if (open.has(index) || closed.has(index)) fail(`index ${index} started twice`);
      open.set(index, block.kind);
      continue;
    }
    if (closed.has(index)) fail(`a ${block.kind}_${block.phase} arrived after index ${index} ended`);
    const kind = open.get(index);
    if (kind === undefined) fail(`a ${block.kind}_${block.phase} arrived before index ${index} started`);
    if (kind !== block.kind) fail(`index ${index} started as ${kind} but got ${block.kind}_${block.phase}`);
    if (block.phase === "end") {
      open.delete(index);
      closed.add(index);
    }
  }

  if (!terminal) throw new StreamContractError("the stream ended without a done or error event", seen.length);
  return seen;
}
