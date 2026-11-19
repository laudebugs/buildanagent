/** `complete()`: folds a model stream into its final message (SDK plan §3.2). */
import type { ModelEvent } from "./spec.ts";
import type { AssistantMessage } from "./types.ts";

/**
 * Reads the stream to its terminal event and returns that event's message. An `error` terminal is returned, not
 * thrown: its message carries `stopReason` `"error"` or `"aborted"`, the partial content and the usage so far. A stream
 * that ends without a terminal event breaks the stream rule, so that case throws.
 */
export async function complete(events: AsyncIterable<ModelEvent>): Promise<AssistantMessage> {
  for await (const event of events) {
    if (event.type === "done" || event.type === "error") return event.message;
  }
  throw new Error("the model stream ended without a done or error event");
}
