// Resuming a session from its log, on our harness: a second turn runs with a new harness, a new model and a new
// session object, so nothing but the store carries the first turn over, and its request still holds the first
// exchange. The store is in memory because a book example writes no file; jsonlStore() writes the same entries to disk
// and its folder is what a second process would open. The book's Chapter 5 lists it beside the Claude Agent SDK's
// resume. The models are scripted ones, so the example runs offline.
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";

// #region resume
const key = { userId: "ada", sessionId: "chat-1" };
const [store, index, lock] = [memoryStore(), memoryIndex(), memoryLock()]; // book:note store

async function turn(input: string, reply: string) {
  const { adapter, model } = scripted([{ content: [{ type: "text", text: reply }] }]); // book:note scripted
  const harness = createHarness({ registry: createToolRegistry(), model, system: "You keep notes." });
  const session = await openSession({ store, index, lock, key }); // book:note fresh
  const result = await runTurn(session, harness, { input });
  await session.close();
  return { adapter, result };
}

const first = await turn("Remember the codeword PELICAN.", "Noted: PELICAN.");
const second = await turn("What was the codeword?", "The codeword was PELICAN.");

check(first.result.stopReason === "done" && second.result.stopReason === "done", "both turns finish");
check(second.result.sessionKey === first.result.sessionKey, "the resumed turn keeps the same session key"); // book:note same-key
const sent = second.adapter.calls[0]?.context.messages ?? [];
check(sent.length === 3, "the resumed request carries the first question and answer, then the new question");
const texts = JSON.stringify(sent);
check(texts.includes("PELICAN"), "the earlier turn's codeword is in the request"); // book:note rebuilt
// #endregion
second.adapter.assertComplete();
