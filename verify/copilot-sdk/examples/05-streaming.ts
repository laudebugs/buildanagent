// Behavior: with streaming: true the session emits assistant.message_delta events whose deltaContent
// concatenates to the final assistant.message content; with streaming off it emits none.
// Docs: nodejs/README.md "Streaming", docs/features/streaming-events.md.
import { approveAll, CopilotClient } from "@github/copilot-sdk";
import { check, MODEL, mockProvider } from "./lib/harness.ts";

const client = new CopilotClient({ useLoggedInUser: false });
async function run(streaming: boolean) {
  const session = await client.createSession({
    model: MODEL,
    provider: mockProvider(),
    onPermissionRequest: approveAll,
    streaming,
  });
  const deltas: string[] = [];
  let final = "";
  session.on("assistant.message_delta", (e) => deltas.push(e.data.deltaContent));
  session.on("assistant.message", (e) => (final = e.data.content));
  const idle = new Promise<void>((resolve) => session.on("session.idle", () => resolve()));
  await session.send({ prompt: "Tell me a short story\nmock-reply: Once upon a time, the end." });
  await idle;
  await session.disconnect();
  return { deltas, final };
}

const on = await run(true);
check(on.deltas.length >= 2, `streaming: true emits deltas (got ${on.deltas.length})`);
check(on.deltas.join("") === on.final, "the deltas concatenate to the final message");
const off = await run(false);
check(off.deltas.length === 0, "streaming off emits no deltas");
check(off.final === on.final, "and the final message is the same");
await client.stop();
