// A memory that expires, built on LangGraph's store. The installed store has no expiry setting, so the
// record carries its own expiry time, a clock the caller injects supplies "now", and the recall tool drops and
// deletes any record past its expiry. One run writes a sourced record, a run on another thread_id recalls it, and
// after the clock passes the expiry the recall tool returns nothing and the store no longer holds the record.
// Deleting the record leaves the first thread's checkpoint alone, so the fact is still in that session's log.
// Import the store from @langchain/langgraph: the same name from "langchain" is core's key-value store, which has no
// search(). Core's ToolRuntime type declares that key-value store, so runtime.store is cast, as in example 09.
// Docs: langchain/long-term-memory.mdx, langchain/runtime.mdx, langgraph/persistence.mdx
import { AIMessage } from "@langchain/core/messages";
import type { ToolRuntime } from "@langchain/core/tools";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { InMemoryStore as CoreKeyValueStore, createAgent, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check, kind, text } from "./lib/check.ts";

const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NAMESPACE = ["memories", "ada"];
let nowMs = Date.parse("2026-11-22T09:00:00Z"); // the injected clock; the tools never call Date.now()
const clock = () => nowMs;

const store = new InMemoryStore();
const checkpointer = new MemorySaver();
const executed: string[] = [];

// #region remember
const remember = tool(
  async ({ subject, fact, source }, runtime: ToolRuntime) => {
    executed.push("remember");
    const created = clock();
    const record = {
      subject,
      fact,
      source,
      created: new Date(created).toISOString(),
      expires: created + MEMORY_TTL_MS,
    }; // book:note record
    await (runtime.store as unknown as InMemoryStore).put(NAMESPACE, subject, record);
    return `stored ${subject}`;
  },
  {
    name: "remember",
    description: "Remember a fact with its source",
    schema: z.object({ subject: z.string(), fact: z.string(), source: z.string() }),
  },
);
// #endregion
// #region recall
const recall = tool(
  async ({ subject }, runtime: ToolRuntime) => {
    executed.push("recall");
    const memory = runtime.store as unknown as InMemoryStore;
    const live: unknown[] = [];
    for (const item of await memory.search(NAMESPACE, { filter: { subject } })) {
      if (item.value.expires <= clock())
        await memory.delete(item.namespace, item.key); // book:note expire
      else live.push(item.value);
    }
    return live.length === 0 ? "No unexpired memory." : JSON.stringify(live);
  },
  { name: "recall", description: "Recall memories about a subject", schema: z.object({ subject: z.string() }) },
);
// #endregion

const writerModel = fakeModel()
  .respondWithTools([
    {
      name: "remember",
      args: { subject: "deploys", fact: "Deploys freeze on Fridays.", source: "runbook.md#freeze" },
      id: "w1",
    },
  ])
  .respond(new AIMessage("Noted."));
const readerModel = fakeModel()
  .respondWithTools([{ name: "recall", args: { subject: "deploys" }, id: "r1" }])
  .respond(new AIMessage("Deploys freeze on Fridays."))
  .respondWithTools([{ name: "recall", args: { subject: "deploys" }, id: "r2" }])
  .respond(new AIMessage("I have nothing on that."));
const writer = createAgent({ model: writerModel, tools: [remember], store, checkpointer });
const reader = createAgent({ model: readerModel, tools: [recall], store, checkpointer });
const ask = (agent: typeof writer | typeof reader, thread_id: string, content: string) =>
  agent.invoke({ messages: [{ role: "user", content }] }, { configurable: { thread_id } });

check(typeof store.search === "function", "the store passed to createAgent has search()");
check(
  !("search" in CoreKeyValueStore.prototype),
  'the store that "langchain" exports under the same name has no search()',
);

await ask(writer, "write", "Remember that deploys freeze on Fridays.");
const written = await store.get(NAMESPACE, "deploys");
check(written?.value.fact === "Deploys freeze on Fridays.", "the write run put the fact in the store");
check(written?.value.source === "runbook.md#freeze", "the record carries its source");
check(
  written?.value.expires - Date.parse(written?.value.created) === MEMORY_TTL_MS,
  "the expiry is 30 days after created",
);

// #region recall-run
await ask(reader, "read-1", "What do you know about deploys?");
check(executed.join() === "remember,recall", "the recall tool ran in the second run");
const recalled = readerModel.calls[1].messages.at(-1);
check(
  kind(recalled) === "tool" && text(recalled).includes("Deploys freeze on Fridays."),
  "the second thread recalls the fact",
);
check(text(recalled).includes("runbook.md#freeze"), "the recalled record still names its source");
check((await store.get(NAMESPACE, "deploys")) !== null, "recalling an unexpired record leaves it in the store");

nowMs += MEMORY_TTL_MS + 1; // the clock passes the expiry
await ask(reader, "read-2", "What do you know about deploys?"); // book:note after-expiry
// #endregion
const dropped = readerModel.calls[3].messages.at(-1);
check(text(dropped) === "No unexpired memory.", "after the expiry the recall tool returns nothing");
check(!readerModel.calls[3].messages.some((m) => text(m).includes("Fridays")), "the model never sees the expired fact");
check((await store.get(NAMESPACE, "deploys")) === null, "the recall tool deleted the expired record from the store");
check((await store.search(NAMESPACE)).length === 0, "the store holds no record under that namespace");

// #region session-log
const tuple = await checkpointer.getTuple({ configurable: { thread_id: "write" } });
check(tuple !== undefined, "the first thread's checkpoint is still there");
const logged = (tuple.checkpoint.channel_values.messages as AIMessage[]).flatMap((m) => m.tool_calls ?? []);
check(
  logged.some((call) => call.args.fact === "Deploys freeze on Fridays."),
  "the first thread's log still holds the fact",
); // book:note log
// #endregion
check(executed.join() === "remember,recall,recall", "only the in-memory tools ran, and the host was never touched");
