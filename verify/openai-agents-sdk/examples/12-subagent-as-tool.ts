// A subagent as a tool: the orchestrator calls a research subagent through `agent.asTool()`, and the subagent reads
// its sources in a nested run of its own. Its tool calls and the source text stay in that run, so the orchestrator
// receives only the subagent's summary, as the tool call's output. Each run's model responses report that run's own
// tokens, and the orchestrator's run usage adds the subagent's tokens to its own. Because the nested run shares the
// orchestrator's run context, the subagent's `state.usage` holds that shared running total rather than its own count.
// The token counts are scripted to show the cost a subagent adds; no model measured them.
// Docs: guides/tools.mdx "Agents as tools", guides/context.mdx, guides/results.mdx "Usage"
import { Agent, type ModelResponse, tool, Usage } from "@openai/agents";
import { assistantMessage, functionCall, modelResponse, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

const SOURCES: Record<string, string> = {
  "a.md": "Source A: the 2024 survey found that 61% of teams log every tool call.",
  "b.md": "Source B: the 2025 follow-up found that 74% of teams log every tool call.",
};
const SUMMARY = "Tool-call logging rose from 61% of teams in 2024 to 74% in 2025.";

// A read-only lookup in memory; it touches neither the file system nor the network.
const readSource = tool({
  name: "read_source",
  description: "Read one research source by name",
  parameters: z.object({ name: z.enum(["a.md", "b.md"]) }),
  execute: async ({ name }) => SOURCES[name],
});

/** A scripted answer that reports the given token counts, as a real model's response would. */
const answer = (output: ModelResponse["output"], inputTokens: number, outputTokens: number) =>
  modelResponse({ output, usage: new Usage({ requests: 1, inputTokens, outputTokens }) });
/** The tokens a list of model responses used. */
const tokens = (responses: readonly ModelResponse[]) => responses.reduce((sum, r) => sum + r.usage.totalTokens, 0);

// #region subagent
const researchModel = new ScriptedModel([
  // The subagent's context grows with each source it reads, and each call pays for all of it again.
  answer([functionCall("read_source", { name: "a.md" }, { callId: "r1" })], 300, 20),
  answer([functionCall("read_source", { name: "b.md" }, { callId: "r2" })], 800, 20),
  answer([assistantMessage(SUMMARY)], 1200, 60),
]);
const researcher = new Agent({
  name: "Researcher",
  instructions: "Read every source you need, then answer in one sentence.",
  tools: [readSource],
  model: researchModel,
});
let subagentTokens = 0;
let sharedTotalAtReturn = 0;
const researchTool = researcher.asTool({
  toolName: "research",
  toolDescription: "Research a question in the sources and return a one-sentence summary",
  customOutputExtractor: (run) => {
    subagentTokens = tokens(run.rawResponses); // book:note own-usage
    sharedTotalAtReturn = run.state.usage.totalTokens; // book:note shared-usage
    return String(run.finalOutput); // book:note summary
  },
});
// #endregion

// #region orchestrator
const orchestratorModel = new ScriptedModel([
  answer([functionCall("research", { input: "How did tool-call logging change?" }, { callId: "o1" })], 300, 40),
  answer([assistantMessage(`The research found: ${SUMMARY}`)], 380, 80),
]);
const orchestrator = new Agent({
  name: "Orchestrator",
  instructions: "Delegate research to the research tool, then answer the user.",
  tools: [researchTool],
  model: orchestratorModel,
});
const result = await runner.run(orchestrator, "Has tool-call logging become more common?");
// #endregion

// The orchestrator's second request holds the summary as the tool's output, and nothing else from the subagent.
const second = JSON.stringify(orchestratorModel.lastCall?.request.input);
check(second.includes(SUMMARY), "the subagent's summary enters the orchestrator's transcript as a tool result");
check(
  !second.includes("read_source") && !Object.values(SOURCES).some((text) => second.includes(text)),
  "the subagent's tool calls and the sources it read never enter the orchestrator's transcript",
);
const researchInput = JSON.stringify(researchModel.lastCall?.request.input);
check(
  Object.values(SOURCES).every((text) => researchInput.includes(text)),
  "the subagent read both sources in its own context",
);

// Every tool offered to either model is one of ours, and a function tool: no shell, computer or file-editing tool.
const offered = [...orchestratorModel.calls, ...researchModel.calls].flatMap((call) => call.request.tools);
check(
  offered.every((t) => t.type === "function" && ["research", "read_source"].includes(t.name)),
  "both models are offered only the research and read_source function tools",
);

// #region usage
const orchestratorTokens = tokens(result.rawResponses);
const runTokens = result.state.usage.totalTokens; // book:note run-usage
console.log(`orchestrator ${orchestratorTokens}, subagent ${subagentTokens}, run ${runTokens} tokens`);
console.log(`the subagent multiplies the orchestrator's tokens by ${runTokens / orchestratorTokens}`);
// #endregion
check(orchestratorTokens === 800 && subagentTokens === 2400, "each run's responses report that run's own usage");
check(
  runTokens === orchestratorTokens + subagentTokens,
  "the orchestrator's run usage counts the subagent's tokens too",
);
check(
  sharedTotalAtReturn === 340 + subagentTokens,
  "the subagent's state.usage is the shared running total: the orchestrator's first call plus the subagent's calls",
);
check(result.finalOutput === `The research found: ${SUMMARY}`, "the orchestrator answers from the summary");
orchestratorModel.assertComplete();
researchModel.assertComplete();
