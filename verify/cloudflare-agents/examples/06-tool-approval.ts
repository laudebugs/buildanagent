// Tool approval in AIChatAgent: a tool with needsApproval pauses the turn with an
// "approval-requested" part and does not execute. A client's cf_agent_tool_approval frame with
// approved: true runs the tool and (with autoContinue) continues the turn; approved: false leaves
// the part "output-denied" and the tool never runs. Docs: agents/docs/agents/human-in-the-loop.md
// ("AI Tool Approval with needsApproval"). needsApproval is deprecated in ai 7 (call-level
// toolApproval), but AIChatAgent's docs still use it, so this checks it still works.
import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { check, type Harness, rpc, scripted, textOf } from "./lib/check.ts";

type Env = { RefundAgent: DurableObjectNamespace<RefundAgent> };

export class RefundAgent extends AIChatAgent<Env> {
  mock = scripted((n) => (n === 0 ? { tools: [{ name: "refund", input: { orderId: "A1", amount: 250 } }] } : "Done."));
  refunds: string[] = [];

  override async onChatMessage() {
    const result = streamText({
      model: this.mock.model,
      messages: await convertToModelMessages(this.messages),
      tools: {
        refund: tool({
          description: "Refund an order",
          inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
          needsApproval: async ({ amount }) => amount > 100,
          execute: async ({ orderId, amount }) => {
            this.refunds.push(`${orderId}:${amount}`);
            return { refunded: amount };
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });
    return result.toUIMessageStreamResponse();
  }
  getMessages() {
    return this.messages;
  }
  report() {
    return { refunds: this.refunds, calls: this.mock.requests.length };
  }
}

const refundPart = (messages: any[]) =>
  messages.flatMap((m) => m.parts).find((p: any) => p.type === "tool-refund") as any;

async function connect(stub: { fetch(url: string, init?: RequestInit): Promise<Response> }) {
  const res = await stub.fetch("http://localhost/", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error("no WebSocket");
  ws.accept();
  return ws;
}

export async function test(env: Env, h: Harness) {
  for (const approved of [true, false]) {
    const agent = rpc<RefundAgent>(await getAgentByName(env.RefundAgent, `refund-${approved}`));
    const res = await agent.saveMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Refund order A1 ($250)." }] },
    ]);
    check(res.status === "completed", `the turn ends while waiting for approval (status ${res.status})`);
    let part = refundPart(await agent.getMessages());
    check(part?.state === "approval-requested", "the gated call is persisted as 'approval-requested'");
    check((await agent.report()).refunds.length === 0, "the gated tool has not executed");

    // The client answers over the WebSocket protocol, as useAgentChat's addToolApprovalResponse does.
    const ws = await connect(agent);
    ws.send(
      JSON.stringify({ type: "cf_agent_tool_approval", toolCallId: part.toolCallId, approved, autoContinue: true }),
    );
    const want = approved ? "output-available" : "output-denied";
    part = await h.until(async () => {
      const p = refundPart(await agent.getMessages());
      return p?.state === want ? p : null;
    });
    check(part?.state === want, `approved: ${approved} moves the part to '${want}'`);
    const r = await agent.report();
    if (approved) {
      check(r.refunds.join() === "A1:250", "the approved tool executed exactly once");
      const last = await h.until(async () => {
        const ms = await agent.getMessages();
        return textOf(ms.at(-1)) === "Done." ? ms.at(-1) : null;
      });
      check(last, "autoContinue ran the model again and persisted its answer");
    } else {
      await h.sleep(300);
      check(r.refunds.length === 0, "a denied tool never executes");
    }
    ws.close();
  }
}
