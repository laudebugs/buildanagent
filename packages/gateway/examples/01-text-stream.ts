// A streamed answer arrives as deltas, and the stream's one closing event carries the message they fold into. The
// book's Chapter 2 lists it beside the AI SDK's streamText.
import type { AssistantMessage, ModelContext } from "@buildanagent/gateway";
import { check, scripted } from "./lib/check.js";

// #region text-stream
const { model, requests } = scripted("Streams arrive in pieces."); // book:note scripted
const context: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Stream something." }] }],
  tools: [],
};
const deltas: string[] = [];
let answer: AssistantMessage | undefined;
for await (const event of model.stream(context)) {
  if (event.type === "text_delta") deltas.push(event.delta); // book:note deltas
  if (event.type === "done" || event.type === "error") answer = event.message; // book:note closing
}
// #endregion
check(deltas.length > 1, `the stream yields several text deltas (${deltas.length})`);
check(deltas.join("") === "Streams arrive in pieces.", "the deltas join to the full text");
check(
  answer?.content[0]?.type === "text" && answer.content[0].text === deltas.join(""),
  "the closing message holds the same text",
);
check(answer?.stopReason === "stop", "the closing message says why the model stopped");
check(requests.length === 1, "one request went out");
check(JSON.stringify(requests[0]?.body).includes("Stream something."), "the user's message travels with the request");
