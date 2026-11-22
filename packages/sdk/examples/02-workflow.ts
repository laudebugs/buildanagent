// A fixed workflow on our packages: a writer call, then a reviewer call, in an order plain TypeScript sets. The SDK
// has no workflow agent class, so the code itself is the workflow. The book's Chapter 1 lists it beside ADK's
// SequentialAgent.
import type { AssistantMessage } from "@buildanagent/gateway";
import { check, scripted } from "./lib/check.js";

/** The text of a model's answer. */
const textOf = (answer: AssistantMessage): string =>
  answer.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

// #region sequential
const writer = scripted([{ content: [{ type: "text", text: "DRAFT-TEXT" }] }]);
const reviewer = scripted([{ content: [{ type: "text", text: "LGTM" }] }]);
const ask = (system: string) => ({
  system,
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Write a haiku." }] }],
  tools: [],
});
const draft = textOf(await writer.model.complete(ask("Write."))); // book:note writer
const review = textOf(await reviewer.model.complete(ask(`Review this: ${draft}`))); // book:note reviewer
// #endregion
check(draft === "DRAFT-TEXT", "the writer's answer is the draft");
check(writer.adapter.calls[0]?.context.system === "Write.", "the writer's call carries its own instruction only");
check(
  reviewer.adapter.calls[0]?.context.system === "Review this: DRAFT-TEXT",
  "the code pastes the draft into the reviewer's instruction",
);
check(review === "LGTM", "the reviewer answers last, because the code calls it second");
writer.adapter.assertComplete();
reviewer.adapter.assertComplete();
