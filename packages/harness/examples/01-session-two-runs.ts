// Two turns on one session, on our harness: runTurn() writes each turn into the session's log, and the second turn
// rebuilds its conversation from that log, so its request carries the first turn. The book's Chapter 5 lists it
// beside the OpenAI Agents SDK's MemorySession. The model is a scripted one, so the example runs offline.
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";

// #region session
const { adapter, model } = scripted([
  { content: [{ type: "text", text: "Noted: PELICAN." }] },
  { content: [{ type: "text", text: "The codeword was PELICAN." }] },
]); // book:note scripted
const harness = createHarness({ registry: createToolRegistry(), model, system: "You keep notes." });
const key = { userId: "ada", sessionId: "chat-1" }; // book:note key
const store = memoryStore(); // book:note store
const session = await openSession({ store, index: memoryIndex(), lock: memoryLock(), key });

await runTurn(session, harness, { input: "Remember the codeword PELICAN." });
const first = adapter.calls[0]?.context.messages.length;
await runTurn(session, harness, { input: "What was the codeword?" }); // book:note second
const second = adapter.calls[1]?.context.messages;

check(first === 1, "the first request carries one message, the question"); // book:note first-run
check(second?.length === 3, "the second request carries the first question and answer, then the new question");
check(second?.[0]?.role === "user" && second[1]?.role === "assistant", "the first two are the first turn's");
const logged = [];
for await (const entry of store.load(key)) logged.push(entry.type);
check(
  logged.includes("turn_end") && logged.filter((type) => type === "turn_start").length === 2,
  "the log holds both turns",
);
// #endregion
await session.close();
adapter.assertComplete();
