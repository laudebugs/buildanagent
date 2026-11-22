// A subagent as a tool on our packages. The SDK has no asTool() helper: a tool's execute() starts a nested run() with
// nestedRunDepth(ctx), and what it returns is all the orchestrator reads of that run. The subagent reads its sources
// in its own context, so its tool calls and the source text never reach the orchestrator. Each run's result.usage
// counts only that run's own model calls, so the code adds the two. The token counts are scripted: they make the total
// 4x the orchestrator's own tokens, and no model measured them. The book's Chapter 8 lists it beside the OpenAI
// Agents SDK's agent.asTool().
import { defineTool, nestedRunDepth, run } from "@buildanagent/sdk";
import type { AssistantScript } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const SOURCES: Record<string, string> = {
  "a.md": "Source A: the 2024 survey found that 61% of teams log every tool call.",
  "b.md": "Source B: the 2025 follow-up found that 74% of teams log every tool call.",
};
const SUMMARY = "Tool-call logging rose from 61% of teams in 2024 to 74% in 2025.";

// A read-only lookup in memory; it touches neither the file system nor the network.
const readSource = defineTool({
  name: "read_source",
  description: "Read one research source by name",
  inputSchema: z.object({ name: z.enum(["a.md", "b.md"]) }),
  async execute({ name }) {
    return { content: [{ type: "text", text: SOURCES[name] ?? "" }] };
  },
});

/** A scripted answer that reports the given token counts, as a real model's response would. */
const answer = (content: AssistantScript["content"], input: number, output: number): AssistantScript => ({
  content,
  usage: { uncachedInput: input, output },
});
const call = (callId: string, name: string, input: unknown) => [{ type: "tool_call" as const, callId, name, input }];
const text = (words: string) => [{ type: "text" as const, text: words }];
/** The tokens a run used. */
const tokens = (usage: {
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: { "5m": number; "1h": number };
  output: number;
}) => usage.uncachedInput + usage.cacheRead + usage.cacheWrite["5m"] + usage.cacheWrite["1h"] + usage.output;

// #region subagent
const research = scripted([
  // The subagent's context grows with each source it reads, and each call pays for all of it again.
  answer(call("r1", "read_source", { name: "a.md" }), 300, 20),
  answer(call("r2", "read_source", { name: "b.md" }), 800, 20),
  answer(text(SUMMARY), 1200, 60),
]);
let subagentTokens = 0;
const researchTool = defineTool({
  name: "research",
  description: "Research a question in the sources and return a one-sentence summary",
  inputSchema: z.object({ input: z.string() }),
  async execute({ input }, ctx) {
    const child = await run({
      model: research.model,
      system: "Read every source you need, then answer in one sentence.",
      tools: [readSource],
      input,
      signal: ctx.signal,
      ...nestedRunDepth(ctx),
    }).result;
    subagentTokens += tokens(child.usage); // book:note own-usage
    if (child.stopReason !== "done") {
      return { content: [{ type: "text", text: `The research run ended ${child.stopReason}.` }], isError: true };
    }
    const last = child.messages.at(-1);
    const summary = last?.role === "assistant" ? last.content.flatMap((b) => (b.type === "text" ? [b.text] : [])) : [];
    return { content: [{ type: "text", text: summary.join("") }] }; // book:note summary
  },
});
// #endregion

// #region orchestrator
const lead = scripted([
  answer(call("o1", "research", { input: "How did tool-call logging change?" }), 300, 40),
  answer(text(`The research found: ${SUMMARY}`), 380, 80),
]);
const result = await run({
  model: lead.model,
  system: "Delegate research to the research tool, then answer the user.",
  tools: [researchTool],
  input: "Has tool-call logging become more common?",
}).result;
// #endregion

// The orchestrator's second request holds the summary as the tool's output, and nothing else from the subagent.
const second = JSON.stringify(lead.adapter.calls[1]?.context.messages);
check(
  second.includes(SUMMARY),
  "the subagent's summary enters the orchestrator's transcript as the research call's result",
);
check(
  !second.includes("read_source") && !Object.values(SOURCES).some((source) => second.includes(source)),
  "the subagent's tool calls and the sources it read never enter the orchestrator's transcript",
);
const researchRequest = JSON.stringify(research.adapter.calls[2]?.context.messages);
check(
  Object.values(SOURCES).every((source) => researchRequest.includes(source)),
  "the subagent read both sources in its own context",
);

// Every tool offered to either model is one of ours: no shell, computer or file-editing tool.
const offered = [...lead.adapter.calls, ...research.adapter.calls].flatMap((request) => request.context.tools);
check(
  offered.every((tool) => ["research", "read_source"].includes(tool.name)),
  "both models are offered only the research and read_source tools",
);

// #region usage
const orchestratorTokens = tokens(result.usage); // book:note run-usage
const runTokens = orchestratorTokens + subagentTokens;
console.log(`orchestrator ${orchestratorTokens}, subagent ${subagentTokens}, run ${runTokens} tokens`);
console.log(`with these scripted counts, the run's total is ${runTokens / orchestratorTokens}x the orchestrator's own`);
// #endregion
check(
  result.steps === lead.adapter.calls.length && research.adapter.calls.length === 3,
  "the orchestrator's result counts its own 2 model calls and the subagent's run made 3",
);
check(
  orchestratorTokens === 800 && subagentTokens === 2400,
  "the orchestrator used 800 tokens and the subagent 2,400, so its result.usage leaves the subagent's out",
);
check(runTokens / orchestratorTokens === 4, "the code's total is 3,200 tokens, 4x the orchestrator's own");
check(result.stopReason === "done", "the orchestrator ends done");
check(
  result.messages.at(-1)?.role === "assistant" &&
    JSON.stringify(result.messages.at(-1)).includes(`The research found: ${SUMMARY}`),
  "the orchestrator answers from the summary",
);
lead.adapter.assertComplete();
research.adapter.assertComplete();
