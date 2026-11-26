// The triage capstone's two tools for `buildanagent rpc`, shared by the second-process test and the process it spawns.
// The harness's capstone (packages/harness/examples/triage-tools.ts) holds the full agent; this package can't import
// another package's examples, so it rebuilds only what the pause needs: a read, and a page that appends its reason to
// `pagesFile` so a test counts the pages across processes.
import { appendFileSync } from "node:fs";
import type { ToolRegistration } from "@buildanagent/harness/tools";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";

export const REASON = "Checkout returns 500 for every pro customer.";
/** The capstone's rules: the read runs, and the page asks a person. */
export const TRIAGE_RULES = {
  allow: [{ tool: "lookup_customer" }],
  ask: [{ tool: "escalate", reason: "An on-call engineer will be paged." }],
};

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const tool = <I>(definition: ToolDefinition<I, unknown>): ToolRegistration => ({
  name: definition.name,
  source: "builtin",
  definition: definition as unknown as ToolDefinition<unknown, unknown, unknown>,
});

/** `lookup_customer`, which needs no approval, and `escalate`, which appends each page's reason to `pagesFile`. */
export function triageTools(pagesFile: string): ToolRegistration[] {
  return [
    tool(
      defineTool({
        name: "lookup_customer",
        description: "Look up the signed-in customer's plan and open tickets.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => text('{"plan":"pro","openTickets":2}'),
      }),
    ),
    tool(
      defineTool<{ reason: string }>({
        name: "escalate",
        description: "Escalate the ticket to the on-call engineer.",
        inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
        effect: { kind: "write" },
        execute: async ({ reason }) => {
          appendFileSync(pagesFile, `${reason}\n`);
          return text("paged the on-call engineer");
        },
      }),
    ),
  ];
}
