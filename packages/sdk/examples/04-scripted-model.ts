// ScriptedModel, from @buildanagent/sdk/testing, is the strict test model behind every example on our packages: it
// plays back one scripted answer per model call, keeps a frozen copy of each request, and fails when a run makes more
// calls than the script holds. The book's Chapter 1 lists it beside the AI SDK harness's scripted() helper.
import { createModel } from "@buildanagent/gateway";
import { defineTool, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check } from "./lib/check.js";

const weather = defineTool({
  name: "weather",
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string() }),
  async execute({ city }) {
    return { content: [{ type: "text", text: `21C in ${city}` }] };
  },
});

/** Whether `run` throws. */
function throws(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

// #region scripted
const adapter = new ScriptedModel([
  { content: [{ type: "tool_call", callId: "call-1", name: "weather", input: { city: "Lisbon" } }] }, // book:note steps
]);
const model = createModel({ adapter, id: "scripted-model" }); // book:note gateway
const started = run({ model, system: "You report the weather.", tools: [weather], input: "Weather in Lisbon?" });
const result = await started.result;
check(result.stopReason === "error", "a call past the script ends the run with an error"); // book:note strict
check(adapter.calls.length === 1, "calls holds the one request the script answered"); // book:note calls
check(
  throws(() => adapter.assertComplete()),
  "assertComplete() reports the call past the script",
);
// #endregion
