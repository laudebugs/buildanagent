// Capstone: a support-triage agent on Think. It looks up the customer with a read-only tool,
// proposes an escalation through a gated tool (needsApproval: true) that never runs until a human
// approves it over the chat protocol, and returns a typed TriageResult through beforeTurn's
// structured output. Everything runs offline in workerd on a scripted model.
// Docs: agents/docs/think/index.md, think/tools.md, think/lifecycle-hooks.md (beforeTurn output),
// agents/docs/agents/human-in-the-loop.md (needsApproval, cf_agent_tool_approval).
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { Think } from "@cloudflare/think";
import { getAgentByName } from "agents";
import { Output, tool } from "ai";
import { z } from "zod";
import { check, type Harness, rpc, scripted } from "./lib/check.ts";

type Env = { TriageAgent: DurableObjectNamespace<TriageAgent> };

const TriageResult = z.object({
  customerId: z.string(),
  priority: z.enum(["p1", "p2", "p3"]),
  escalated: z.boolean(),
  summary: z.string(),
});
type TriageResult = z.infer<typeof TriageResult>;

const CUSTOMERS: Record<string, { plan: string; openTickets: number }> = {
  "C-9": { plan: "enterprise", openTickets: 3 },
};

const said = (req: LanguageModelV4CallOptions) => JSON.stringify(req.prompt);
function triageModel(_n: number, req: LanguageModelV4CallOptions) {
  if (req.responseFormat?.type === "json")
    return JSON.stringify({
      customerId: "C-9",
      priority: "p1",
      escalated: said(req).includes("ESC-1"),
      summary: "Enterprise outage",
    });
  if (req.prompt.at(-1)?.role === "tool") return "Escalated to the on-call team.";
  return {
    tools: [
      { name: "lookupCustomer", input: { customerId: "C-9" } },
      { name: "escalate", input: { customerId: "C-9", reason: "outage" } },
    ],
  };
}

export class TriageAgent extends Think<Env> {
  mock = scripted(triageModel);
  lookups: string[] = [];
  escalations: string[] = [];
  structured = false;

  override getModel() {
    return this.mock.model;
  }
  override getSystemPrompt() {
    return "Triage support tickets. Look the customer up before escalating.";
  }
  override getTools() {
    return {
      lookupCustomer: tool({
        description: "Read a customer's plan and open tickets (read-only)",
        inputSchema: z.object({ customerId: z.string() }),
        execute: async ({ customerId }) => {
          this.lookups.push(customerId);
          return CUSTOMERS[customerId] ?? { error: "unknown customer" };
        },
      }),
      escalate: tool({
        description: "Page the on-call team",
        inputSchema: z.object({ customerId: z.string(), reason: z.string() }),
        needsApproval: true,
        execute: async ({ customerId, reason }) => {
          this.escalations.push(`${customerId}:${reason}`);
          return { ticket: "ESC-1" };
        },
      }),
    };
  }
  override beforeTurn() {
    if (this.structured) return { output: Output.object({ schema: TriageResult }), activeTools: [] };
  }

  async triage(text: string) {
    const r = await this.runTurn({ input: text });
    return r.status;
  }
  async result(): Promise<TriageResult | undefined> {
    this.structured = true;
    try {
      const r = await this.runTurn({ input: "Return the triage result." });
      return r.output as TriageResult | undefined;
    } finally {
      this.structured = false;
    }
  }
  pending() {
    const parts = this.messages.flatMap((m) => m.parts) as any[];
    return parts.filter((p) => p.type === "tool-escalate").map((p) => ({ id: p.toolCallId, state: p.state }));
  }
  report() {
    return { lookups: this.lookups, escalations: this.escalations };
  }
}

export async function test(env: Env, h: Harness) {
  const agent = rpc<TriageAgent>(await getAgentByName(env.TriageAgent, "ticket-42"));
  check((await agent.triage("Customer C-9 reports a full outage.")) === "completed", "the triage turn completes");
  let r = await agent.report();
  check(r.lookups.join() === "C-9", "the read-only lookup tool ran without approval");
  const [gate] = await agent.pending();
  check(gate?.state === "approval-requested", "the escalation is waiting for approval");
  check(r.escalations.length === 0, "the gated escalate tool has not run");
  await h.sleep(300);
  check((await agent.report()).escalations.length === 0, "it still has not run while nobody answers");

  // A human approves over the chat protocol (what useAgentChat's addToolApprovalResponse sends).
  const res = await agent.fetch("http://localhost/", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error("no WebSocket");
  ws.accept();
  ws.send(JSON.stringify({ type: "cf_agent_tool_approval", toolCallId: gate.id, approved: true, autoContinue: true }));
  const done = await h.until(async () => (await agent.pending())[0]?.state === "output-available", 5000);
  check(done, "approval moved the escalation to output-available");
  r = await agent.report();
  check(r.escalations.join() === "C-9:outage", "the escalate tool ran exactly once, after approval");
  ws.close();

  const result = await agent.result();
  const parsed = TriageResult.safeParse(result);
  check(parsed.success, "the structured turn returns a value matching the TriageResult schema");
  check(parsed.data.priority === "p1" && parsed.data.escalated, "the typed result reflects the approved escalation");
}
