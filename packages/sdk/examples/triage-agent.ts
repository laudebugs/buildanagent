// A support-triage agent. It looks the signed-in customer up, asks a person before it escalates a ticket, and ends with
// a typed record. A paused run ends with a signed request you can store as JSON; any process with the key resumes it.
import type { Model } from "@buildanagent/gateway";
import {
  type ApprovalSigner,
  type Context,
  continueRun,
  defineTool,
  type Interceptors,
  type Observer,
  outputTool,
  type Resolution,
  type Run,
  type RunOptions,
  run,
} from "@buildanagent/sdk";
import { z } from "zod";

export const MAX_STEPS = 8;
export const BUDGET_USD = 0.25;
const MAX_OUTPUT_TOKENS = 1024;
export const SYSTEM_PROMPT =
  "You triage support tickets. Look the customer up first. Escalate only a ticket an on-call engineer must see. Submit the triage last.";

/** The typed result the run ends with. */
export const Triage = z.object({
  category: z.enum(["bug", "billing", "question"]),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1),
});
export type Triage = z.infer<typeof Triage>;

/** What the agent needs from your systems, and where it sends its audit trail. */
export interface TriageDeps {
  model: Model;
  signer: ApprovalSigner;
  customerEmail: string; // The signed-in customer, from the request's session: build `deps` for each request.
  findCustomer(email: string): Promise<{ plan: string; openTickets: number }>;
  escalate(reason: string): Promise<void>;
  audit(line: string): void;
}
export type TriageApp = Pick<TriageDeps, "customerEmail">; // What the tools read from `ctx.app`, never the model.

/** Every call the model makes, and every pause for a person, goes to the audit trail. */
function auditTo(audit: TriageDeps["audit"]): Observer {
  return (event) => {
    if (event.type === "tool_call_start") audit(`call ${event.tool}`);
    if (event.type === "approval_request") audit(`approval requested for ${event.request.tool}`);
  };
}

/** The gate: reading is free, escalating waits for a person. */
const gate: Interceptors = {
  beforeToolCall: ({ tool }) =>
    tool === "escalate" ? { decision: "ask", reason: "An on-call engineer will be paged." } : { decision: "allow" },
};

/** The agent's options, shared by its first run and every resume. */
export function triageOptions(deps: TriageDeps): RunOptions<Triage, TriageApp> & { app: TriageApp } {
  const lookupCustomer = defineTool<object, unknown, TriageApp>({
    name: "lookup_customer",
    description: "Look up the signed-in customer's plan and open tickets.",
    inputSchema: z.object({}),
    execute: async (_input, ctx) => ({
      content: [{ type: "text", text: JSON.stringify(await deps.findCustomer(ctx.app.customerEmail)) }],
    }),
  });
  const escalate = defineTool({
    name: "escalate",
    description: "Escalate the ticket to the on-call engineer.",
    inputSchema: z.object({ reason: z.string() }),
    effect: { kind: "write" },
    execute: async ({ reason }) => {
      await deps.escalate(reason);
      return { content: [{ type: "text", text: "escalated" }] };
    },
  });
  return {
    model: deps.model,
    tools: [lookupCustomer, escalate],
    output: outputTool({ name: "submit_triage", schema: Triage }),
    maxSteps: MAX_STEPS,
    budgetUsd: BUDGET_USD,
    modelOptions: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    interceptors: gate,
    observers: [auditTo(deps.audit)],
    signer: deps.signer,
    app: { customerEmail: deps.customerEmail },
  };
}

/** Starts triaging a ticket. The run ends `awaiting_approval` when the model asks to escalate. */
export function startTriage(deps: TriageDeps, ticket: string): Run<Triage> {
  return run({ ...triageOptions(deps), system: SYSTEM_PROMPT, input: ticket });
}

/** Resumes a paused run from its stored `context`, with the person's answer to each request. */
export function resumeTriage(deps: TriageDeps, context: Context, resolutions: readonly Resolution[]): Run<Triage> {
  return continueRun(context, { ...triageOptions(deps), resolutions });
}
