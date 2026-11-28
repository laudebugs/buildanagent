// A decision model returns a probability for each option, and a probability states intent, not consent. This example
// gates three tool calls on it with a bar for each level of risk: a lookup acts above 0.67, a refund above 0.93 and
// otherwise asks a person, and a transfer always asks, so even a 0.99 for "yeah, go ahead I guess" reaches the
// confirmation step. The model only reads the customer's words. Dates stay in code: it extracts a month and a day,
// and the code compares them with today. The book's fast-and-slow-calls chapter lists it.
//
// The decision model is a table that imitates the request shape of TypeSafe, Clef and OpenAI's Decisions API as of
// November 2026: a state and typed questions in, one probability per option out. It measures nothing, so every
// probability here is one the example chose, and the example depends on none of those APIs.
import { ephemeralSigner } from "@buildanagent/agent-safety";
import { type Interceptors, run } from "@buildanagent/sdk";
import { check, scripted } from "./lib/check.js";
import { DAYS, MONTHS, ran, rows, tools } from "./lib/decision-fixtures.js";
import { type DecideClient, probabilityOf, tableClient, topOption } from "./lib/decision-table.js";

const NEVER = Number.POSITIVE_INFINITY;
const ACT_ABOVE: Record<string, number> = { lookup_order: 0.67, refund: 0.93, transfer: NEVER }; // book:note bars
const RETURN_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const TODAY = Date.UTC(2026, 10, 28);

// #region gate
/** How many days ago the customer says they bought: the model extracts two parts, and the code does the arithmetic. */
async function daysSincePurchase(client: DecideClient, state: string) {
  const month = await client.decide(state, [{ id: "month", kind: "choice", ask: "Which month?", options: MONTHS }]);
  const named = topOption(month.month); // the next question refers to this answer, so it needs its own request
  const day = await client.decide(state, [{ id: "day", kind: "choice", ask: `Which day of ${named}?`, options: DAYS }]);
  const bought = Date.UTC(new Date(TODAY).getUTCFullYear(), MONTHS.indexOf(named), Number(topOption(day.day)));
  return (TODAY - bought) / MS_PER_DAY;
}

const gate = (client: DecideClient, state: string): Interceptors => ({
  beforeToolCall: async ({ tool }) => {
    if (tool === "refund" && (await daysSincePurchase(client, state)) > RETURN_DAYS) {
      return { decision: "deny", reason: `The return window is ${RETURN_DAYS} days.` };
    }
    const intent = { id: "intent", kind: "predicate", ask: `Does the customer want ${tool}?` } as const;
    const p = probabilityOf((await client.decide(state, [intent])).intent, "yes"); // the option the code will take
    const bar = ACT_ABOVE[tool] ?? NEVER; // an unknown tool always asks
    return p > bar ? { decision: "allow" } : { decision: "ask", reason: `Intent ${p} is not above ${bar}.` };
  },
});
// #endregion

const client = tableClient(rows);

/** Runs the agent on one customer message that makes one scripted call, and reports what happened to the call. */
async function attempt(state: keyof typeof rows, name: string) {
  const call = { type: "tool_call", callId: "call-1", name, input: {} } as const;
  const { model } = scripted([{ content: [call] }, { content: [{ type: "text", text: "Done." }] }]);
  ran.length = 0;
  const result = await run({
    model,
    system: "Handle customer requests.",
    tools,
    input: state,
    interceptors: gate(client, state),
    signer: ephemeralSigner(),
  }).result;
  return {
    acted: ran.includes(name),
    asked: result.stopReason === "awaiting_approval",
    reason: result.stopReason === "awaiting_approval" ? result.pending[0]?.reason : undefined,
  };
}

const found = await attempt("Where is order A1?", "lookup_order");
check(found.acted, "a lookup at 0.70 acts, above its 0.67 bar");
check((await attempt("Er, order A1, maybe?", "lookup_order")).asked, "a lookup at 0.60 asks");
check((await attempt("Refund order A1, bought 15 November.", "refund")).acted, "a refund at 0.95 acts, above 0.93");
const unsure = await attempt("Refund order A2, I think, bought 2 November.", "refund");
check(unsure.asked && !unsure.acted, "a refund at 0.90 asks and does not run");
const late = await attempt("Refund order A3, bought 20 October.", "refund");
check(!late.acted && !late.asked, "a refund bought 39 days ago is denied by the code's date comparison, at 0.97");
const sure = await attempt("Move my savings, yeah, go ahead I guess.", "transfer");
check(sure.asked && !sure.acted && sure.reason?.includes("0.99"), "a transfer asks even at 0.99");
const dependent = [
  { id: "month", kind: "choice", ask: "Which month?", options: MONTHS },
  { id: "day", kind: "choice", ask: "Which day of {month}?", options: DAYS },
] as const;
check(
  await client.decide("x", [...dependent]).then(
    () => false,
    () => true,
  ),
  "a question that names an earlier answer is rejected",
);
check(
  client.requests.every((r) => r.length === 1),
  "each request holds one question, never a question and its source",
);
