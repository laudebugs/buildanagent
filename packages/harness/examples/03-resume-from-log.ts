// Resuming a session from its log, on our harness: a second turn runs with a new harness, a new model and a new
// session object, so nothing but the store, its index and its lock carries the first turn over, and its request still
// holds the first exchange. The store is in memory because a book example writes no file; jsonlStore() and fileIndex()
// write the same entries to disk, and their folder is what a second process would open. The book's Chapter 5 lists it
// beside the Claude Agent SDK's resume. The models are scripted ones, so the example runs offline.
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";

// #region resume
const key = { userId: "ada", sessionId: "chat-1" };
const [store, index, lock] = [memoryStore(), memoryIndex(), memoryLock()]; // book:note store

function fresh(reply: string) {
  const { adapter, model } = scripted([{ content: [{ type: "text", text: reply }] }]); // book:note scripted
  return { adapter, harness: createHarness({ registry: createToolRegistry(), model, system: "You keep notes." }) };
}

const one = fresh("Noted: PELICAN.");
const sessionOne = await openSession({ store, index, lock, key }); // book:note fresh
const first = await runTurn(sessionOne, one.harness, { input: "Remember the codeword PELICAN." });
await sessionOne.close();

const two = fresh("The codeword was PELICAN.");
const sessionTwo = await openSession({ store, index, lock, key });
const second = await runTurn(sessionTwo, two.harness, { input: "What was the codeword?" });
await sessionTwo.close();

check(first.stopReason === "done" && second.stopReason === "done", "both turns finish");
const logged = [];
for await (const entry of store.load(key)) logged.push(entry);
const resumed = logged.find((entry) => entry.parentId === first.lastEntryId);
check(resumed?.type === "message_block", "the second turn's first entry follows the first turn's last"); // book:note linked
const sent = two.adapter.calls[0]?.context.messages ?? [];
check(sent.length === 3, "the resumed request carries the first question and answer, then the new question");
check(JSON.stringify(sent).includes("PELICAN"), "the earlier turn's codeword is in the request"); // book:note rebuilt
// #endregion
two.adapter.assertComplete();
