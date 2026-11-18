// Behavior: createSession + sendAndWait returns the final assistant.message, after the runtime has
// emitted the documented event sequence, and the session goes idle.
// Docs: nodejs/README.md "Quick Start" and "sendAndWait".
import { approveAll, CopilotClient, type SessionEvent } from "@github/copilot-sdk";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const client = new CopilotClient({ useLoggedInUser: false });
await client.start();
const session = await client.createSession({ model: MODEL, provider: mockProvider(), onPermissionRequest: approveAll });
const events: SessionEvent[] = [];
session.on((e) => events.push(e));

const reply = await session.sendAndWait({ prompt: "What is 2+2?\nmock-reply: 4" }, 30_000);
check(reply?.type === "assistant.message", "sendAndWait resolves with an assistant.message event");
check(reply?.data.content === "4", `the reply carries the model's text (got ${JSON.stringify(reply?.data.content)})`);

const types = events.map((e) => e.type);
const order: SessionEvent["type"][] = [
  "user.message",
  "assistant.turn_start",
  "assistant.message",
  "assistant.turn_end",
  "session.idle",
];
const at = order.map((t) => types.indexOf(t));
check(
  at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])),
  `events arrive in order: ${order.join(" → ")}`,
);
check(typeof session.sessionId === "string" && session.sessionId.length > 0, "the session has an id");

const reqs = mockRequests();
check(reqs.length === 1, `one model request reached the mock (got ${reqs.length})`);
check(reqs[0].tools?.includes("bash") === true, "by default the runtime offers its built-in tools, bash included");

// Printed last: scripts/factcheck-api.mjs reads it from results/run-examples.json.
console.log(`observed-events: ${JSON.stringify([...new Set(types)])}`);
await session.disconnect();
await client.stop();
