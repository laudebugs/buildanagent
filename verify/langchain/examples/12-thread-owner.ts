// A thread id finds a thread and proves nothing about who may open it: MemorySaver files a thread by thread_id
// alone. So the server records each thread's owner when it creates the thread, and checks that owner before every
// later call. Bob's call with Ada's thread id and his call with an id nobody created get the same "not found",
// neither reaches the model, and Ada's next call still sees her earlier messages.
// Docs: langchain/short-term-memory.mdx, langgraph/persistence.mdx
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, fakeModel } from "langchain";
import { check, text } from "./lib/check.ts";

const model = fakeModel().respond(new AIMessage("Nice to meet you, Ada.")).respond(new AIMessage("You are Ada."));
const checkpointer = new MemorySaver();
const agent = createAgent({ model, tools: [], checkpointer });
const BOB_QUESTION = "What did Ada tell you?";

// #region server
const NOT_FOUND = { status: 404, error: "thread not found" } as const;
const owners = new Map<string, string>(); // book:note owners

async function chat(user: string, message: string, threadId?: string) {
  if (threadId === undefined) {
    threadId = crypto.randomUUID(); // book:note server-id
    owners.set(threadId, user);
  }
  const owner = owners.get(threadId); // book:note owner-check
  if (owner !== user) return NOT_FOUND; // book:note not-found
  const result = await agent.invoke(
    { messages: [{ role: "user", content: message }] },
    { configurable: { thread_id: threadId } },
  );
  return { status: 200, threadId, reply: result.messages.at(-1)?.content } as const;
}

const ada = await chat("ada", "I am Ada.");
check(ada.status === 200, "Ada's first call starts a thread");
const bobOnAdas = await chat("bob", BOB_QUESTION, ada.threadId); // book:note bob-adas
const bobUnknown = await chat("bob", BOB_QUESTION, "no-such-thread"); // book:note bob-unknown
const adaAgain = await chat("ada", "Who am I?", ada.threadId); // book:note ada-again
// #endregion

check(ada.reply === "Nice to meet you, Ada.", "Ada's first call reaches the model");
check(bobOnAdas.status === 404, "Bob's call with Ada's thread id is refused");
check(bobUnknown.status === 404, "Bob's call with an id nobody created is refused");
check(
  JSON.stringify(bobOnAdas) === JSON.stringify(bobUnknown),
  "Bob's two calls get the same response, so neither tells him that Ada's thread exists",
);
check(model.calls.length === 2, "only Ada's two calls reached the model; Bob's never did");
check(adaAgain.status === 200 && adaAgain.reply === "You are Ada.", "Ada's next call resumes her thread");
check(model.calls[1].messages.length === 3, "Ada's second request carries her first exchange and the new question");
const saved = await checkpointer.getTuple({ configurable: { thread_id: ada.threadId } });
const messages = (saved?.checkpoint.channel_values.messages ?? []) as AIMessage[];
check(
  messages.length === 4 && !messages.some((m) => text(m) === BOB_QUESTION),
  "Ada's thread holds only her own four messages",
);
