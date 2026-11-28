// A decision model returns a probability for each option, and a probability states intent, not consent. This example
// gates three tool calls on that probability, with a bar for each level of risk. A lookup acts above 0.67 and a refund
// above 0.93; at or below its bar, each asks a person. A transfer always asks, so even a 0.99 for "yeah, go ahead I
// guess" reaches the confirmation step. Dates stay in code: the model extracts a month and a day, and the code compares
// them with today, so a refund the model is sure the customer wants is still denied past the return window. The book's
// fast-and-slow-calls chapter lists this example.
//
// The decision model is a table that imitates the request shape of TypeSafe, Clef and OpenAI's Decisions API as of
// November 2026: a state and typed questions in, one probability per option out. It measures nothing, so every
// probability here is one the example chose, and the example depends on none of those APIs.
import type { Interceptors } from "@buildanagent/sdk";
import { check } from "./lib/check.js";
import { attempt, DAYS, MONTHS, rows } from "./lib/decision-fixtures.js";
import { type Answer, type DecideClient, probabilityOf, tableClient, topOption } from "./lib/decision-table.js";

const NEVER = Number.POSITIVE_INFINITY;
const ACT_ABOVE = new Map([
  ["lookup_order", 0.67],
  ["refund", 0.93],
  ["transfer", NEVER],
]);
const DATE_ABOVE = 0.9;
const RETURN_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const TODAY = Date.UTC(2026, 10, 28);

// #region gate
/** The option of a choice the model is sure of, if any. */
const sure = (a: Answer | undefined) => (probabilityOf(a, topOption(a)) > DATE_ABOVE ? topOption(a) : undefined);

/** Days since the purchase the customer names, or undefined when the model is unsure or the date cannot exist. */
async function daysSincePurchase(client: DecideClient, state: string) {
  const ask = (id: string, ask: string, options: string[]) =>
    client.decide(state, [{ id, kind: "choice", ask, options }]);
  const named = sure((await ask("month", "Which month?", MONTHS)).month); // the day question needs this answer first
  if (named === undefined) return undefined;
  const day = sure((await ask("day", `Which day of ${named}?`, DAYS)).day);
  const month = MONTHS.indexOf(named);
  const on = (year: number) => Date.UTC(year, month, Number(day));
  const thisYear = new Date(TODAY).getUTCFullYear();
  const bought = on(thisYear) > TODAY ? on(thisYear - 1) : on(thisYear); // 15 December means last year
  const exists = day !== undefined && new Date(bought).getUTCMonth() === month;
  return exists ? (TODAY - bought) / MS_PER_DAY : undefined; // 31 November rolls into December
}

const gate = (client: DecideClient, state: string): Interceptors => ({
  beforeToolCall: async ({ tool }) => {
    const intent = { id: "intent", kind: "predicate", ask: `Does the customer want ${tool}?` } as const;
    const p = probabilityOf((await client.decide(state, [intent])).intent, "yes"); // the option the code will take
    const bar = ACT_ABOVE.get(tool) ?? NEVER; // book:note bars
    if (bar === NEVER) return { decision: "ask", reason: `Always needs a person's confirmation (intent ${p}).` };
    if (p <= bar) return { decision: "ask", reason: `Intent ${p} is at or below the ${bar} bar.` };
    if (tool !== "refund") return { decision: "allow" };
    const days = await daysSincePurchase(client, state);
    if (days === undefined) return { decision: "ask", reason: "The purchase date is unclear." };
    return days > RETURN_DAYS
      ? { decision: "deny", reason: `The purchase is past the ${RETURN_DAYS}-day return window.` }
      : { decision: "allow" };
  },
});
// #endregion

const client = tableClient(rows);
const go = (state: keyof typeof rows, name: string) => attempt(state, name, gate(client, state));

check((await go("Where is order A1?", "lookup_order")).acted, "a lookup at 0.70 acts, above its 0.67 bar");
check((await go("Er, order A1, maybe?", "lookup_order")).asked, "a lookup at 0.60 asks");
check((await go("Refund order A1, bought 15 November.", "refund")).acted, "a refund at 0.95 acts, above 0.93");
const unsure = await go("Refund order A2, I think, bought 2 November.", "refund");
check(unsure.asked && !unsure.acted, "a refund at 0.90 asks and does not run");
const late = await go("Refund order A3, bought 20 October.", "refund");
check(
  !late.acted && !late.asked && late.told.includes("return window"),
  "a refund at 0.97 is denied: the purchase is 39 days old",
);
const year = await go("Refund order A4, bought 15 December.", "refund");
check(!year.acted && year.told.includes("return window"), "15 December means last year, so that refund is denied");
check((await go("Refund order A5, bought 31 November.", "refund")).asked, "31 November does not exist, so it asks");
check((await go("Refund order A6, bought in October, I think.", "refund")).asked, "a month at 0.60 asks");
const transfer = await go("Move my savings, yeah, go ahead I guess.", "transfer");
check(transfer.asked && !transfer.acted && transfer.reason?.includes("0.99"), "a transfer asks even at 0.99");
const both = [
  { id: "month", kind: "choice", ask: "Which month?", options: MONTHS },
  { id: "day", kind: "choice", ask: "Which day of {month}?", options: DAYS },
] as const;
check(
  await client.decide("x", [...both]).then(
    () => false,
    () => true,
  ),
  "a question that names an earlier answer throws",
);
check(
  client.requests.every((r) => r.length === 1),
  "each request holds one question, never a question with the one it depends on",
);
