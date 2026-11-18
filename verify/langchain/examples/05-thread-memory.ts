// A checkpointer keeps a thread's messages between invocations with the same thread_id; a new
// thread starts empty. Invoking a checkpointed agent without a thread_id throws.
// Docs: langchain/short-term-memory.mdx, langgraph/persistence.mdx
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, fakeModel } from "langchain";
import { check } from "./lib/check.ts";

const model = fakeModel()
  .respond(new AIMessage("Nice to meet you, Ada."))
  .respond(new AIMessage("You are Ada."))
  .respond(new AIMessage("I don't know your name."))
  .respond(new AIMessage("Hello."));
const agent = createAgent({ model, tools: [], checkpointer: new MemorySaver() });
const a = { configurable: { thread_id: "a" } };
await agent.invoke({ messages: [{ role: "user", content: "I am Ada." }] }, a);
const second = await agent.invoke({ messages: [{ role: "user", content: "Who am I?" }] }, a);
check(second.messages.length === 4, "the same thread_id carries the earlier turn into the second invocation");
check(model.calls[1].messages.length === 3, "the model sees the full thread history");
const fresh = await agent.invoke(
  { messages: [{ role: "user", content: "Who am I?" }] },
  { configurable: { thread_id: "b" } },
);
check(fresh.messages.length === 2, "a new thread_id starts empty");

let error: unknown;
try {
  await agent.invoke({ messages: [{ role: "user", content: "hi" }] });
} catch (e) {
  error = e;
}
check(error instanceof Error && /thread_id/.test(error.message), "without a thread_id, a checkpointed agent throws");
