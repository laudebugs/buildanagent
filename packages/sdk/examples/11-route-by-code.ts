// A router in code on our packages. The SDK has no router class: a regular expression picks the branch, the digit
// branch is a plain function that makes no model call, and the other branch runs the model. The book's Chapter 8 lists
// it beside ADK's graph route.
import { run } from "@buildanagent/sdk";
import { check, scripted } from "./lib/check.js";

const { adapter, model } = scripted([{ content: [{ type: "text", text: "from the model" }] }]);

// #region routing
/** The digit branch is a plain function, so it asks no model. */
const digits = (): string => "digits branch";
/** The other branch is one run, so it makes one model call. */
const words = async (input: string): Promise<string> => {
  const result = await run({ model, system: "Reply.", input }).result;
  const last = result.messages.at(-1);
  return last?.role === "assistant" ? last.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("") : "";
};
const route = (input: string) => (/\d/.test(input) ? digits() : words(input)); // book:note route
// #endregion

/** How many model calls the branches have made so far. */
const modelCalls = (): number => adapter.calls.length;
check(
  (await route("order 42")) === "digits branch" && modelCalls() === 0,
  "a digit sends the input to the plain function and asks no model",
);
check(
  (await route("hello")) === "from the model" && modelCalls() === 1,
  "any other input takes the model branch, one call",
);
check((await route("order 42")) === "digits branch", "the same input takes the same branch every time");
adapter.assertComplete();
