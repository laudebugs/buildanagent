// A session carries history across runs.
// Docs: guides/sessions.mdx, examples/docs/sessions/memorySession.ts
import { Agent, MemorySession } from "@openai/agents";
import { assistantMessage, ScriptedModel } from "@openai/agents/testing";
import { check, runner } from "./lib/check.ts";

const model = new ScriptedModel([
  [assistantMessage("Noted: PELICAN.")],
  [assistantMessage("The codeword was PELICAN.")],
]);
// #region session
const agent = new Agent({ name: "Memory", model });
const session = new MemorySession(); // book:note memory-session
await runner.run(agent, "Remember the codeword PELICAN.", { session }); // book:note first-run
const second = await runner.run(agent, "What was the codeword?", { session }); // book:note second-run
// #endregion

const input = JSON.stringify(model.lastCall?.request.input);
check(input.includes("Remember the codeword PELICAN."), "the second request includes the first run's user message");
check(input.includes("Noted: PELICAN."), "the second request includes the first run's answer");
const items = await session.getItems();
check(items.length >= 4, "the session stores both turns");
check(second.finalOutput === "The codeword was PELICAN.", "the second run answers");
