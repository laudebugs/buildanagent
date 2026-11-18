// A store passed to createAgent reaches tools as runtime.store, and at run time it is LangGraph's
// store with get() and put(), as the docs use it. Core's ToolRuntime type declares a key-value
// BaseStore (mget/mset) instead, so typed code must cast (fact-check F-finding).
// Docs: langchain/long-term-memory.mdx, langchain/runtime.mdx
import { AIMessage } from "@langchain/core/messages";
import type { ToolRuntime } from "@langchain/core/tools";
import { InMemoryStore } from "@langchain/langgraph";
import { createAgent, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check } from "./lib/check.ts";

type GraphStore = InMemoryStore;
const remember = tool(
  async ({ fact }, runtime: ToolRuntime) => {
    const store = runtime.store as unknown as GraphStore;
    await store.put(["users", "ada"], "fact", { fact });
    const back = await store.get(["users", "ada"], "fact");
    return `stored: ${back?.value.fact}`;
  },
  { name: "remember", description: "Remember a fact", schema: z.object({ fact: z.string() }) },
);
const store = new InMemoryStore();
const model = fakeModel()
  .respondWithTools([{ name: "remember", args: { fact: "likes tea" }, id: "call_m" }])
  .respond(new AIMessage("Noted."));
await createAgent({ model, tools: [remember], store }).invoke({ messages: [{ role: "user", content: "I like tea" }] });

const item = await store.get(["users", "ada"], "fact");
check(item?.value.fact === "likes tea", "runtime.store.put() wrote to the store passed to createAgent");
check(typeof (store as any).mget !== "function", "the runtime store is LangGraph's store, which has no mget()");
