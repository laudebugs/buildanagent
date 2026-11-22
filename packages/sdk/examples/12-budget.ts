// A pre-call budget on our SDK. run() takes budgetUsd and, before every model call, projects the most that call can
// cost with the gateway's projectCallCost(). If the spend so far plus the projection passes the cap, the run ends
// "budget" and the call is never sent. The book's Chapter 9 lists it beside the AI SDK's wrapper around its model.
// The scripted model reports itself as Claude Sonnet 5.5, so the gateway prices every answer from its catalog.
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, pricedScripted } from "./lib/check.js";

const BUDGET_USD = 0.025;
const MAX_OUTPUT_TOKENS = 500;
const POLICY = Array.from({ length: 200 }, (_, i) => `Refund rule ${i}: refund within 30 days.`).join("\n");
const lookup = defineTool({
  name: "lookup",
  description: "Look up a refund rule",
  inputSchema: z.object({ rule: z.number() }),
  async execute({ rule }) {
    return { content: [{ type: "text", text: `Rule ${rule}: refund within 30 days.` }] };
  },
});

// #region budget
const { adapter, model } = pricedScripted([
  {
    content: [{ type: "tool_call", callId: "call-1", name: "lookup", input: { rule: 7 } }],
    usage: { uncachedInput: 20, cacheWrite: { "5m": 3_960, "1h": 0 }, output: 30 },
  },
  { content: [{ type: "text", text: "Refunds take five days." }], usage: { uncachedInput: 20, output: 30 } },
]);
const result = await run({
  model,
  system: POLICY,
  input: "How long do refunds take?",
  tools: [lookup],
  modelOptions: { maxOutputTokens: MAX_OUTPUT_TOKENS }, // book:note project
  budgetUsd: BUDGET_USD, // book:note refuse-before
}).result;
const spent = result.cost.total; // book:note record-actual
// #endregion

// #region refuse
// The second call fits the budget alone, but not on top of what the first call already spent.
if (result.stopReason !== "budget") throw new Error(`expected a budget stop, got ${result.stopReason}`);
const { spentUsd, projectedUsd } = result; // book:note numbers
check(projectedUsd < BUDGET_USD, `a call that fits the budget alone ($${projectedUsd}) is refused ...`);
check(spentUsd + projectedUsd > BUDGET_USD, `... because $${spentUsd} is already spent`);
check(adapter.calls.length === 1, "the refused call never reached the model"); // book:note refused
// #endregion

// Literal checks, in nano-dollars. The first call cost 20 uncached tokens at $2, 3,960 cache-write tokens at $2.50 and
// 30 output tokens at $10 per million. The projection counts the last call's 3,980 input and 30 output tokens, plus 12
// for the 30 characters of tool result added since (at 2.5 characters a token). It prices all of them at the dearest
// input rate, the 1-hour cache write's $4, and adds the 500-token answer limit at $10.
const nanos = (usd: number) => Math.round(usd * 1_000_000_000);
check(
  spent === spentUsd && nanos(spentUsd) === 20 * 2_000 + 3_960 * 2_500 + 30 * 10_000,
  "the spend is the first call's catalog price",
);
check(
  nanos(projectedUsd) === 4_022 * 4_000 + MAX_OUTPUT_TOKENS * 10_000,
  "the projection is the worst case for the next call",
);
check(result.steps === 1, "the run made one model call");

// The same run with no cap sends the second call, so the cap is what stopped the first run.
const open = pricedScripted([
  { content: [{ type: "tool_call", callId: "call-1", name: "lookup", input: { rule: 7 } }] },
  { content: [{ type: "text", text: "Refunds take five days." }] },
]);
const uncapped = await run({ model: open.model, system: POLICY, input: "Same question.", tools: [lookup] }).result;
check(uncapped.stopReason === "done" && open.adapter.calls.length === 2, "without budgetUsd the second call goes out");
