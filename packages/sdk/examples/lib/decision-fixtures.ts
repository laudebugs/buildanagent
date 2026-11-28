// The tools, calendar and table rows that 15-decision-gate.ts runs on. The tools only record that they ran.
import { defineTool } from "@buildanagent/sdk";
import { z } from "zod";
import type { Row } from "./decision-table.js";

/** The names of the tools that have run, cleared by the example before each attempt. */
export const ran: string[] = [];
const tool = (name: string, writes: boolean) =>
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
/** A read-only lookup, a refund and a transfer. The last two declare a write effect. */
export const tools = [tool("lookup_order", false), tool("refund", true), tool("transfer", true)];
/** The month names a choice question offers, in calendar order. */
export const MONTHS = ["January", "February", "March", "April", "May", "June"].concat([
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);
/** The days of the longest month, as the options of a choice question. */
export const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
/** What the table answers for each customer message: an intent probability, and the month and day it names. */
export const rows = {
  "Where is order A1?": { intent: 0.7 },
  "Er, order A1, maybe?": { intent: 0.6 },
  "Refund order A1, bought 15 November.": { intent: 0.95, month: "November", day: "15" },
  "Refund order A2, I think, bought 2 November.": { intent: 0.9, month: "November", day: "2" },
  "Refund order A3, bought 20 October.": { intent: 0.97, month: "October", day: "20" },
  "Move my savings, yeah, go ahead I guess.": { intent: 0.99 },
} satisfies Record<string, Row>;
