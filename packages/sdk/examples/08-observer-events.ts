// An observer on our SDK. It is passed in the run's `observers` option, and the SDK calls it with each event, in order,
// and never reads what it returns. This one only records each event's type for one prompt. The book's Chapter 10
// lists it beside Pi's subscriber.
import { run } from "@buildanagent/sdk";
import { check, scripted } from "./lib/check.js";

const { adapter, model } = scripted([{ content: [{ type: "text", text: "Hello from our SDK." }] }]);
// #region events
const types: string[] = [];
const result = await run({
  model,
  system: "Greet the user.",
  input: "Say hello.", // book:note prompt
  observers: [
    (event) => {
      types.push(event.type); // book:note record
    },
  ],
}).result;
// #endregion

check(result.stopReason === "done" && result.steps === 1, "one model call for a text-only answer");
check(
  types.includes("text_delta") && types.includes("text_end") && types.includes("model_call_end"),
  "the observer hears the text deltas, then the finished text, then the finished model call",
);
check(
  types.indexOf("text_delta") < types.indexOf("text_end") &&
    types.indexOf("text_end") < types.indexOf("model_call_end"),
  "the deltas come before the end events that carry the finished item",
);
check(
  types.at(-2) === "agent_settled" && types.at(-1) === "run_end",
  "agent_settled comes second to last and run_end, which carries the result, comes last",
);
check(types[0] === "run_start", "an observer passed in the options hears run_start too");
adapter.assertComplete();
