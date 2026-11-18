// maxTurns stops a tool loop with MaxTurnsExceededError, which carries the run state.
// Docs: guides/running-agents.mdx "Run arguments" (maxTurns, default 10), "Exceptions"
import { Agent, MaxTurnsExceededError, tool } from "@openai/agents";
import { functionCall, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

const search = tool({
  name: "search",
  description: "Search",
  parameters: z.object({ q: z.string() }),
  execute: async () => "3 hits",
});
const model = new ScriptedModel([
  [functionCall("search", { q: "a" }, { callId: "c1" })],
  [functionCall("search", { q: "b" }, { callId: "c2" })],
]);
const agent = new Agent({ name: "Searcher", model, tools: [search] });
let error: unknown;
try {
  await runner.run(agent, "Search forever.", { maxTurns: 1 });
} catch (e) {
  error = e;
}
check(error instanceof MaxTurnsExceededError, "exceeding maxTurns throws MaxTurnsExceededError");
check((error as MaxTurnsExceededError).state !== undefined, "the error carries the run state");
check(model.calls.length === 1, "the loop stops after one model call with maxTurns: 1");
