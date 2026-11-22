// A check proves only the rule it states. An agent that answers with nothing passes a check that asks whether it
// answered at all, and only a check on what the answer holds tells the two apart. The book's Chapter 7 lists it
// beside the AI SDK's version.
import { run } from "@buildanagent/sdk";
import { check, scripted } from "./lib/check.js";

// The agent under test does nothing useful: its one scripted answer is empty.
const { model } = scripted([{ content: [{ type: "text", text: "" }] }]);
const result = await run({ model, system: "You report the weather.", input: "What is the weather in Lisbon?" }).result;
const last = result.messages.at(-1);
const answer =
  last?.role === "assistant" ? last.content.map((block) => (block.type === "text" ? block.text : "")).join("") : "";

// #region weak-and-strong
const weak = () => check(typeof answer === "string", "the agent answered"); // book:note weak
const strong = () => check(answer.includes("Lisbon"), "the answer names the city"); // book:note strong
// #endregion

/** Says whether an assertion holds, without stopping the example when it throws. */
function holds(assertion: () => void) {
  try {
    assertion();
    return true;
  } catch {
    return false;
  }
}

check(result.stopReason === "done" && answer === "", "the scripted agent answered with nothing");
check(holds(weak), "the weak check passes on an empty answer");
check(!holds(strong), "the strong check fails on an empty answer");
