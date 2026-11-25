// The support-triage agent's tools: a read that looks the signed-in customer up, a write that pages the on-call
// engineer, and the output tool that ends the run with a typed record. The customer comes from the turn's host
// context, never from the model's arguments. triage-session.ts runs them on the harness.
import { createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";

/** What a tool reads from the turn's host context: the signed-in customer. */
export interface TriageApp {
  readonly customerEmail: string;
}

/** What the agent needs from your systems. A page returns the text the model reads and a receipt for the log alone. */
export interface TriageDeps {
  findCustomer(email: string): Promise<{ plan: string; openTickets: number }>;
  escalate(reason: string, callId: string): Promise<{ readonly text: string; readonly receipt?: unknown }>;
}

type AnyTool = ToolDefinition<unknown, unknown, unknown>;
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const choice = (...values: string[]) => ({ enum: values });
const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    category: choice("bug", "billing", "question"),
    priority: choice("low", "medium", "high"),
    summary: { type: "string", minLength: 1 },
  },
  required: ["category", "priority", "summary"],
};

/** The output tool: a call whose input fits the schema ends the run, with that input as the typed result. */
export const submitTriage = defineTool({
  name: "submit_triage",
  description: "Submit the triage: its category, priority and a one-line summary. Call it once, last.",
  inputSchema: TRIAGE_SCHEMA,
  execute: async (input: unknown) => ({ ...text("triage recorded"), structured: input, terminate: true }),
}) as AnyTool;

/** A registry with the agent's two tools and no built-in tools. The page is a write, keyed by its reason. */
export function triageRegistry(deps: TriageDeps): ToolRegistry {
  const lookup = defineTool<object, unknown, TriageApp>({
    name: "lookup_customer",
    description: "Look up the signed-in customer's plan and open tickets.",
    inputSchema: { type: "object", properties: {} },
    execute: async (_input, ctx) => text(JSON.stringify(await deps.findCustomer(ctx.app.customerEmail))),
  });
  const escalate = defineTool<{ reason: string }>({
    name: "escalate",
    description: "Escalate the ticket to the on-call engineer.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    effect: { kind: "write", businessKey: (input: { reason: string }) => `escalate:${input.reason}` },
    execute: async ({ reason }, ctx) => {
      const page = await deps.escalate(reason, ctx.callId);
      return { ...text(page.text), details: { receipt: page.receipt } };
    },
  });
  const registry = createToolRegistry();
  for (const definition of [lookup, escalate] as AnyTool[]) {
    registry.register({ name: definition.name, source: "builtin", definition });
  }
  return registry;
}
