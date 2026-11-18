// createAgent runs a model-and-tools loop; the result's messages end with the model's answer, and
// systemPrompt reaches the model as a system message. fakeModel() from langchain scripts the model.
// Docs: langchain/agents.mdx, langchain/test/unit-testing.mdx
import { AIMessage } from "@langchain/core/messages";
import { createAgent, fakeModel } from "langchain";
import { check, kind, text } from "./lib/check.ts";

const model = fakeModel().respond(new AIMessage("Hello from the fake model."));
const agent = createAgent({ model, tools: [], systemPrompt: "You are terse." });
const result = await agent.invoke({ messages: [{ role: "user", content: "Say hello." }] });

check(text(result.messages.at(-1)) === "Hello from the fake model.", "the last message is the model's answer");
check(JSON.stringify(result.messages.map(kind)) === '["human","ai"]', "messages hold the user turn and the answer");
check(model.callCount === 1, "one model call without tools");
const sent = model.calls[0].messages;
check(kind(sent[0]) === "system" && text(sent[0]) === "You are terse.", "systemPrompt arrives as the system message");
