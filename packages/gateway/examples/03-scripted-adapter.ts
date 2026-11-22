// A provider adapter implements one method, stream(), and createModel() derives the rest. The scripted adapter below
// streams one answer; model.complete() folds that stream into the final message, so a test double never writes a
// second code path. The book's Chapter 9 lists it beside the AI SDK's scripted model, which implements two methods.
import {
  type AssistantMessage,
  createModel,
  type ModelAdapter,
  type ModelContext,
  type ModelEvent,
  unreportedUsage,
} from "@buildanagent/gateway";
import { assertStreamContract } from "@buildanagent/gateway/testing";
import { check } from "./lib/check.js";

const context: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "How long do refunds take?" }] }],
  tools: [],
};

// #region scripted
const adapter: ModelAdapter = {
  specificationVersion: "v1",
  api: "scripted",
  provider: "scripted",
  defaultCaps: { contextWindow: 10_000, maxOutputTokens: 1_000, images: false, reasoning: false },
  async *stream(ref): AsyncGenerator<ModelEvent> {
    const block = { type: "text" as const, text: "Refunds take five days." };
    const cost = { total: null, basis: "unknown" as const, currency: "USD" as const };
    const message: AssistantMessage = {
      role: "assistant",
      content: [block],
      model: ref,
      stopReason: "stop",
      usage: unreportedUsage(),
      cost,
    };
    yield { type: "start" }; // book:note one-method
    yield { type: "text_start", index: 0 };
    yield { type: "text_delta", index: 0, delta: block.text };
    yield { type: "text_end", index: 0, block };
    yield { type: "done", message };
  },
};
const model = createModel({ adapter, id: "scripted-model" }); // book:note derived
const answer = await model.complete(context); // book:note folds
// #endregion

const events = await assertStreamContract(model.stream(context));
check(events.at(-1)?.type === "done", "stream() ends with its one terminal event, and the stream follows the contract");
check(
  answer.content[0]?.type === "text" && answer.content[0].text === "Refunds take five days.",
  "complete() returns the text stream() streamed",
);
check(answer.stopReason === "stop", "complete() returns the stream's closing message");
check(answer.cost.total === null, "the scripted answer reports no usage, so its price is unknown, never zero");
check(
  Object.keys(adapter)
    .filter((key) => typeof adapter[key as keyof ModelAdapter] === "function")
    .join() === "stream",
  "the adapter's only method is stream()",
);
