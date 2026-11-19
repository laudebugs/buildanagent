// A Worker for test/cloudflare-interrupted.test.ts, bundled with esbuild and run in workerd through Miniflare. It holds
// two Cloudflare `AIChatAgent`s with a `send_email` write: `DefaultRepairAgent` keeps the agent's own
// `repairInterruptedToolPart`, and `GuardedRepairAgent` overrides it with `repairInterruptedWrite()`. Each request
// stores a history whose `send_email` call never got a result, as an isolate evicted mid-`execute()` leaves it, then
// starts a turn and reports what the agent stored and what the model read.
//
// It imports the package's source by relative path, which esbuild bundles.
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import { convertToModelMessages, jsonSchema, streamText, tool, type UIMessage } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { repairInterruptedWrite, toAiToolResult } from "../../src/ai/index.js";
import type { WriteOutcome } from "../../src/index.js";
import type { Repaired } from "./scenario.js";

interface Env {
  readonly DefaultRepairAgent: DurableObjectNamespace;
  readonly GuardedRepairAgent: DurableObjectNamespace;
}

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const WRITE_TOOLS: ReadonlySet<string> = new Set(["send_email"]);

/** The stored history: the model called `send_email`, and the isolate died before the call recorded a result. */
const HISTORY: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Tell Ada her refund is on its way." }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-send_email",
        toolCallId: "call_1",
        state: "input-available",
        input: { to: "ada@example.com", body: "Your refund is on its way." },
      },
    ],
  },
  { id: "u2", role: "user", parts: [{ type: "text", text: "Did it go out?" }] },
];

/** A model that answers in text and records every request it receives. */
function answeringModel(requests: LanguageModelV4CallOptions[]) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      requests.push(options);
      const chunks: LanguageModelV4StreamPart[] = [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Checking." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
      ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

class EmailAgent extends AIChatAgent<Env> {
  requests: LanguageModelV4CallOptions[] = [];
  sent = 0;

  override async onChatMessage() {
    const send_email = tool({
      description: "Send an email",
      inputSchema: jsonSchema<{ to: string; body: string }>({ type: "object" }),
      execute: async (): Promise<WriteOutcome> => {
        this.sent++;
        throw new Error("the model never calls send_email in this test");
      },
      toModelOutput: ({ output }) => toAiToolResult(output),
    });
    const tools = { send_email };
    const result = streamText({
      model: answeringModel(this.requests),
      // With the tools, each stored output goes through its tool's `toModelOutput`, as the model would read it.
      messages: await convertToModelMessages(this.messages, { tools }),
      tools,
    });
    return result.toUIMessageStreamResponse();
  }

  async play(): Promise<Repaired> {
    await this.persistMessages(HISTORY.slice(0, 2));
    const turn = await this.saveMessages(HISTORY);
    const part = this.messages.flatMap((m) => m.parts).find((p) => p.type === "tool-send_email") as
      | { state: string; output?: unknown; errorText?: string }
      | undefined;
    const results = this.requests.flatMap((request) =>
      request.prompt.flatMap((m) => (m.role === "tool" ? m.content : [])),
    );
    return {
      status: turn.status,
      stored: { state: part?.state ?? "missing", output: part?.output, errorText: part?.errorText },
      modelRead: results.map((p) => (p.type === "tool-result" ? p.output : p)),
      sent: this.sent,
    };
  }
}

/** The agent with its default repair, which records an interrupted call as an error. */
export class DefaultRepairAgent extends EmailAgent {}

/** The agent whose repair records an interrupted write as an `unknown` outcome. */
export class GuardedRepairAgent extends EmailAgent {
  protected override repairInterruptedToolPart(part: UIMessage["parts"][number]): UIMessage["parts"][number] {
    return repairInterruptedWrite(part, WRITE_TOOLS) ?? super.repairInterruptedToolPart(part);
  }
}

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const which = new URL(request.url).pathname.slice(1);
    const namespace = which === "guarded" ? env.GuardedRepairAgent : env.DefaultRepairAgent;
    try {
      const agent = (await getAgentByName(namespace as never, which)) as unknown as { play(): Promise<Repaired> };
      return Response.json(await agent.play());
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
