// The tools, calendar, table rows and one-call runner that 15-decision-gate.ts runs on. The tools only record that
// they ran.
import { ephemeralSigner } from "@buildanagent/agent-safety";
import { defineTool, type Interceptors, run } from "@buildanagent/sdk";
import { z } from "zod";
import { scripted } from "./check.js";
import type { Row } from "./decision-table.js";

const tool = (name: string, writes: boolean, ran: string[]) =>
  defineTool({
    name,
    description: `Runs ${name}.`,
    inputSchema: z.object({}),
    ...(writes ? { effect: { kind: "write" as const } } : {}),
    async execute() {
      ran.push(name);
      return { content: [{ type: "text", text: "done" }] };
    },
  });
/** The month names a choice question offers, in calendar order. */
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** The days of the longest month, as the options of a choice question. */
export const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
/**
 * What the table answers for each customer message: an intent probability, and the month and day it names. A pair
 * `[option, p]` gives a choice a probability other than the table's default.
 */
export const rows = {
  "Where is order A1?": { intent: 0.7 },
  "Er, order A1, maybe?": { intent: 0.6 },
  "Refund order A1, bought 15 November.": { intent: 0.95, month: "November", day: "15" },
  "Refund order A2, I think, bought 2 November.": { intent: 0.9, month: "November", day: "2" },
  "Refund order A3, bought 20 October.": { intent: 0.97, month: "October", day: "20" },
  "Refund order A4, bought 15 December.": { intent: 0.97, month: "December", day: "15" },
  "Refund order A5, bought 31 November.": { intent: 0.97, month: "November", day: "31" },
  "Refund order A6, bought in October, I think.": { intent: 0.97, month: ["October", 0.6], day: "20" },
  "Move my savings, yeah, go ahead I guess.": { intent: 0.99 },
} satisfies Record<string, Row>;

/**
 * Runs an agent that has a lookup, a refund and a transfer tool, gives it one customer message and scripts one call to
 * `name`. It reports whether the tool ran, whether the run ended waiting for a person, that request's reason, and the
 * tool results the model read afterwards.
 */
export async function attempt(state: keyof typeof rows, name: string, interceptors: Interceptors) {
  const ran: string[] = [];
  const tools = [tool("lookup_order", false, ran), tool("refund", true, ran), tool("transfer", true, ran)];
  const call = { type: "tool_call", callId: "call-1", name, input: {} } as const;
  const { adapter, model } = scripted([{ content: [call] }, { content: [{ type: "text", text: "Done." }] }]);
  const signer = ephemeralSigner();
  const result = await run({ model, system: "Handle customer requests.", tools, input: state, interceptors, signer })
    .result;
  const asked = result.stopReason === "awaiting_approval";
  const told = (adapter.calls[1]?.context.messages ?? []).flatMap((m) => (m.role === "tool" ? m.content : []));
  return {
    acted: ran.includes(name),
    asked,
    reason: asked ? result.pending[0]?.reason : undefined,
    told: told.map((b) => (b.type === "text" ? b.text : "")).join(),
  };
}
