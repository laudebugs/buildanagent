/** `complete()`: folds a model stream into its final message (SDK plan §3.2). */
import type { GatewayEvent } from "./runtime-types.ts";
import type { AssistantMessage } from "./types.ts";

/**
 * Reads the stream to its terminal event and returns that event's message. An `error` terminal is returned, not
 * thrown: its message carries `stopReason` `"error"` or `"aborted"`, the partial content and the usage so far. A stream
 * that ends without a terminal event breaks the stream rule, so that case throws. `retry` events are skipped.
 */
export async function complete(events: AsyncIterable<GatewayEvent>): Promise<AssistantMessage> {
  for await (const event of events) {
    if (event.type === "done" || event.type === "error") return event.message;
  }
  throw new Error("the model stream ended without a done or error event");
}
