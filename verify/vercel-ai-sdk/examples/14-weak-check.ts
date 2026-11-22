// A check proves only the rule it states. An agent that answers with nothing passes a check that asks whether it
// answered at all, and only a check on what the answer holds tells the two apart. Docs: ai-sdk-core/testing.mdx
import { generateText } from "ai";
import { check, scripted } from "./lib/check.ts";

// The agent under test does nothing useful: its one scripted answer is empty.
const { model } = scripted([""]);
const result = await generateText({ model, prompt: "What is the weather in Lisbon?" });

// #region weak-and-strong
const weak = () => check(typeof result.text === "string", "the agent answered"); // book:note weak
const strong = () => check(result.text.includes("Lisbon"), "the answer names the city"); // book:note strong
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

check(result.text === "", "the scripted agent answered with nothing");
check(holds(weak), "the weak check passes on an empty answer");
check(!holds(strong), "the strong check fails on an empty answer");
