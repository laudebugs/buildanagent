// A session is named by its user and its id, on our harness: the same key continues a conversation, a new id starts an
// empty one, and another user's turn under the same id starts an empty one too, because the store never finds a
// session by its id alone. The book's Chapter 5 lists it beside LangChain's thread_id. The model is a scripted one,
// so the example runs offline.
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn, type SessionKey } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";

// #region sessions
const { adapter, model } = scripted([
  { content: [{ type: "text", text: "Hello, Ada." }] },
  { content: [{ type: "text", text: "You are Ada." }] },
  { content: [{ type: "text", text: "I don't know your name." }] },
  { content: [{ type: "text", text: "I don't know you." }] },
]); // book:note scripted
const harness = createHarness({ registry: createToolRegistry(), model, system: "You are terse." });
const store = memoryStore();
const [index, lock] = [memoryIndex(), memoryLock()]; // book:note lock
const open = (key: SessionKey) => openSession({ store, index, lock, key });
const adaA = { userId: "ada", sessionId: "a" };

const first = await open(adaA);
await runTurn(first, harness, { input: "I am Ada." });
await first.close();
const second = await open(adaA);
await runTurn(second, harness, { input: "Who am I?" }); // book:note same-key
await second.close();
const adaB = await open({ userId: "ada", sessionId: "b" });
await runTurn(adaB, harness, { input: "What is my name?" }); // book:note new-id
await adaB.close();
const before = await countEntries(adaA);
const bobA = await open({ userId: "bob", sessionId: "a" });
await runTurn(bobA, harness, { input: "Do you know me?" }); // book:note other-user
await bobA.close();

const sent = adapter.calls.map((call) => call.context.messages.length);
check(sent[1] === 3, "the second call on ada's session a sees the first exchange and the new question");
check(sent[2] === 1, "ada's new session b starts empty: only the new question");
check(sent[3] === 1, "bob's session a starts empty: only the new question");
check((await countEntries(adaA)) === before, "bob's turn writes nothing to ada's log");
const bobs = [];
for await (const entry of store.load({ userId: "bob", sessionId: "a" })) bobs.push(entry);
check(bobs.length > 0 && !JSON.stringify(bobs).includes("I am Ada."), "bob's log holds his turn and none of ada's"); // book:note isolation

async function countEntries(key: SessionKey) {
  let entries = 0;
  for await (const _entry of store.load(key)) entries += 1;
  return entries;
}
// #endregion
adapter.assertComplete();
