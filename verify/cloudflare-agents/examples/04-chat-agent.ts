// AIChatAgent runs an AI SDK streamText loop in onChatMessage, executes server tools, and persists
// the conversation (user, tool and assistant parts) in this.messages. saveMessages() starts a turn
// without a client. Docs: agents/docs/agents/chat-agents.md ("Server-side tools", "saveMessages").
import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { check, type Harness, rpc, scripted, textOf } from "./lib/check.ts";

type Env = { SupportChat: DurableObjectNamespace<SupportChat> };

const ORDERS: Record<string, string> = { A1: "shipped", B2: "processing" };

export class SupportChat extends AIChatAgent<Env> {
  // One scripted model per agent instance: call the tool, then answer from its result.
  mock = scripted((n, req) =>
    n === 0
      ? { tools: [{ name: "lookupOrder", input: { orderId: "A1" } }] }
      : `Order A1 is ${JSON.stringify(req.prompt.at(-1)).includes("shipped") ? "shipped" : "unknown"}.`,
  );
  lookups: string[] = [];

  override async onChatMessage() {
    const result = streamText({
      model: this.mock.model,
      system: "You are a support agent.",
      messages: await convertToModelMessages(this.messages),
      tools: {
        lookupOrder: tool({
          description: "Look up an order's status",
          inputSchema: z.object({ orderId: z.string() }),
          execute: async ({ orderId }) => {
            this.lookups.push(orderId);
            return { orderId, status: ORDERS[orderId] ?? "not found" };
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
    return { lookups: this.lookups, calls: this.mock.requests.length, system: this.mock.requests[0]?.prompt[0] };
  }
}

export async function test(env: Env, _h: Harness) {
  const agent = rpc<SupportChat>(await getAgentByName(env.SupportChat, "chat-1"));
  const res = await agent.saveMessages([
    { id: "u1", role: "user", parts: [{ type: "text", text: "Where is order A1?" }] },
  ]);
  check(res.status === "completed", `saveMessages runs a full turn (status ${res.status})`);
  const r = await agent.report();
  check(r.lookups.join() === "A1", "the server tool executed once with the model's input");
  check(r.calls === 2, "the loop called the model again after the tool result (2 model calls)");
  const messages = await agent.getMessages();
  check(messages.length === 2, "this.messages holds the user message and one assistant message");
  const assistant = messages[1];
  const toolPart: any = assistant.parts.find((p) => p.type === "tool-lookupOrder");
  check(
    toolPart?.state === "output-available",
    "the tool call is persisted as a tool-lookupOrder part with its output",
  );
  check(toolPart.output.status === "shipped", "the persisted tool output is the execute() result");
  check(textOf(assistant) === "Order A1 is shipped.", "the final text is persisted in the same assistant message");

  // Messages survive a fresh stub: they live in the agent's SQLite storage, not the caller.
  const again = rpc<SupportChat>(await getAgentByName(env.SupportChat, "chat-1"));
  check((await again.getMessages()).length === 2, "a new stub to the same name sees the persisted messages");
}
