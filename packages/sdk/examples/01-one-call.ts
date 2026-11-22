// One model call through the gateway: complete() sends one request and returns the model's one answer. The book's
// Chapter 1 lists it beside the AI SDK's generateText.
import { check, scripted } from "./lib/check.js";

// #region call
const { adapter, model } = scripted([{ content: [{ type: "text", text: "Hello from the mock." }] }]); // book:note mock
const answer = await model.complete({
  system: "You are terse.", // book:note request
  messages: [{ role: "user", content: [{ type: "text", text: "Say hello." }] }],
  tools: [],
});
check(answer.content[0]?.type === "text" && answer.content[0].text === "Hello from the mock.", "the answer is text");
check(answer.stopReason === "stop", "stopReason is 'stop'"); // book:note finish
check(adapter.calls.length === 1, "one request went out");
check(adapter.calls[0]?.context.system === "You are terse.", "the system prompt travels with the request");
// #endregion
adapter.assertComplete();
