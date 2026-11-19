// A Worker for test/cloudflare-approval.test.ts, bundled with esbuild and run in workerd through Miniflare. It holds a
// Cloudflare `AIChatAgent` whose refund tool goes through `signedToolApproval()`, and a fetch handler that plays one
// scenario per request: pause a refund, change something a client or a store could change, answer the approval with
// a `cf_agent_tool_approval` frame over the agent's WebSocket, and report what ran and what the model read.
//
// It imports the package's source by relative path, which esbuild bundles, and its key ring comes from the
// APPROVAL_KEYS secret, as a deployed Worker's would.
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import { convertToModelMessages, isStepCount, jsonSchema, streamText, tool, type UIMessage } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { settleDeniedApprovals, signedToolApproval } from "../../src/ai/index.js";
import { hmacSigner, type PendingStore, parseKeyRing, type SignedPendingRequest } from "../../src/index.js";
import type { Change, Played, Report } from "./scenario.js";

interface Env {
  readonly RefundAgent: DurableObjectNamespace;
  readonly APPROVAL_KEYS: string;
}

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const REFUND = { order: 4417, amount: 250 };

type ToolPart = { type: string; state: string; toolCallId: string; input?: unknown };

/** A model that calls refund until the prompt holds a result, calls it once more after a denial if asked, then stops. */
function refundModel(requests: LanguageModelV4CallOptions[], retryAfterDenial: () => boolean) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      requests.push(options);
      const results = options.prompt.flatMap((m) => (m.role === "tool" ? m.content : []));
      const denied = results.some((p) => p.type === "tool-result" && p.output.type === "execution-denied");
      const retried = results.some((p) => p.type === "tool-result" && p.toolCallId === "call_2");
      const callId = results.length === 0 ? "call_1" : denied && retryAfterDenial() && !retried ? "call_2" : undefined;
      const chunks: LanguageModelV4StreamPart[] =
        callId === undefined
          ? [
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Done." },
              { type: "text-end", id: "t1" },
            ]
          : [{ type: "tool-call", toolCallId: callId, toolName: "refund", input: JSON.stringify(REFUND) }];
      const finishReason = { unified: callId === undefined ? "stop" : "tool-calls", raw: undefined } as const;
      chunks.push({ type: "finish", finishReason, usage: USAGE });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

export class RefundAgent extends AIChatAgent<Env> {
  requests: LanguageModelV4CallOptions[] = [];
  executed: unknown[] = [];
  denials: string[] = [];
  errors: string[] = [];
  change: Change = "none";
  policyVersion = "v1";

  // Pending requests live in the Durable Object's own storage, so a pause outlives this instance's memory.
  store: PendingStore = {
    put: async (request) => this.ctx.storage.put(`pending:${request.callId}`, request),
    take: async (callId) => {
      const request = await this.ctx.storage.get<SignedPendingRequest>(`pending:${callId}`);
      await this.ctx.storage.delete(`pending:${callId}`);
      return request;
    },
  };

  override async onChatMessage() {
    const deprecated = this.change === "needs-approval-signature";
    const refund = tool({
      description: "Refund an order",
      inputSchema: jsonSchema<{ order: number; amount: number }>({ type: "object" }),
      ...(deprecated ? { needsApproval: true } : {}),
      execute: async (input) => {
        this.executed.push(input);
        return { refunded: input.amount };
      },
    });
    const toolApproval = signedToolApproval({
      signer: hmacSigner(parseKeyRing(this.env.APPROVAL_KEYS)),
      store: this.store,
      policy: deprecated ? {} : { refund: "user-approval" },
      policyVersion: () => this.policyVersion,
      recheck: async (pending) =>
        pending.policyVersion === this.policyVersion ? "allow" : { deny: "the refund policy changed" },
      onRejected: async (rejection) => {
        this.denials.push(rejection.cause);
        await this.ctx.storage.put(`denied:${rejection.callId}`, true);
      },
    });
    // The agent keeps a part it never saw denied as approved; settling it first keeps the next step's history whole.
    const denied = new Set([...(await this.ctx.storage.list({ prefix: "denied:" })).keys()].map((k) => k.slice(7)));
    const messages = settleDeniedApprovals(this.messages, denied);
    if (messages.some((message, index) => message !== this.messages[index])) await this.persistMessages(messages);
    const result = streamText({
      model: refundModel(this.requests, () => this.change === "retry-after-forget"),
      messages: await convertToModelMessages(messages),
      tools: { refund },
      toolApproval,
      stopWhen: isStepCount(5),
      onError: ({ error }) => {
        this.errors.push(String(error));
      },
    });
    return result.toUIMessageStreamResponse();
  }

  setChange(change: Change) {
    this.change = change;
  }

  /** Changes what a client or a store could change between the pause and the approval. */
  async tamper(callId: string) {
    const key = `pending:${callId}`;
    const request = await this.ctx.storage.get<SignedPendingRequest>(key);
    if (request === undefined) throw new Error(`no pending request for ${callId}`);
    if (this.change === "signature" || this.change === "needs-approval-signature") {
      await this.ctx.storage.put(key, { ...request, signature: `${request.signature.slice(1)}A` });
    } else if (this.change === "key-id") {
      await this.ctx.storage.put(key, { ...request, keyId: "rotated-out" });
    } else if (this.change === "forget" || this.change === "retry-after-forget") {
      await this.ctx.storage.delete(key);
    } else if (this.change === "policy") {
      this.policyVersion = "v2";
    } else if (this.change === "input") {
      await this.rewriteInput(callId);
    }
  }

  /** A client that edits the stored call's input before it approves, as a resent history could. */
  private async rewriteInput(callId: string) {
    const messages = this.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        (part as ToolPart).toolCallId === callId ? { ...part, input: { ...REFUND, amount: 25000 } } : part,
      ),
    })) as UIMessage[];
    await this.persistMessages(messages);
  }

  toolParts(): ToolPart[] {
    return this.messages.flatMap((m) => m.parts).filter((p) => p.type === "tool-refund") as unknown as ToolPart[];
  }

  report(): Report {
    return {
      states: this.toolParts().map((p) => `${p.toolCallId}:${p.state}`),
      executed: this.executed,
      denials: this.denials,
      errors: this.errors,
      modelCalls: this.requests.length,
    };
  }

  /** The `not_applied` outcome each denied call carried to the model, from the requests it received. */
  deniedOutcomes(): Played["outcomes"] {
    return this.requests.flatMap((request) =>
      request.prompt.flatMap((m) =>
        m.role === "tool"
          ? m.content.flatMap((p) =>
              p.type === "tool-result" && p.output.type === "execution-denied" && p.output.reason !== undefined
                ? [JSON.parse(p.output.reason)]
                : [],
            )
          : [],
      ),
    );
  }
}

type Stub = {
  [K in keyof RefundAgent]: RefundAgent[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
} & { fetch(input: string, init?: RequestInit): Promise<Response> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean>, describe: () => Promise<unknown>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for the agent: ${JSON.stringify(await describe())}`);
    await sleep(50);
  }
}

const OUTPUT_CHUNKS = new Set(["tool-output-available", "tool-output-error", "tool-output-denied"]);

type Frame = { type?: string; id?: string; body?: string; done?: boolean };

/**
 * Answers the approval of `callId` as a client does: a `cf_agent_tool_approval` frame over the agent's WebSocket. It
 * waits for the continuation turn to end and returns the tool output chunks the client received for the call, which
 * is what a client renders.
 */
async function answer(agent: Stub, callId: string, modelCalls: number): Promise<string[]> {
  const response = await agent.fetch("http://localhost/", { headers: { Upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error("the agent did not accept a WebSocket");
  socket.accept();
  const streamed: string[] = [];
  let ended = false;
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    // A client that connects while a turn streams is held until it acknowledges, then receives the buffered chunks.
    if (frame.type === "cf_agent_stream_resuming") {
      socket.send(JSON.stringify({ type: "cf_agent_stream_resume_ack", id: frame.id }));
    }
    if (frame.type !== "cf_agent_use_chat_response") return;
    if (frame.done) ended = true;
    if (!frame.body) return;
    const chunk = JSON.parse(frame.body) as { type?: string; toolCallId?: string };
    if (chunk.toolCallId === callId && OUTPUT_CHUNKS.has(chunk.type ?? "")) streamed.push(`${callId}:${chunk.type}`);
  });
  socket.send(
    JSON.stringify({ type: "cf_agent_tool_approval", toolCallId: callId, approved: true, autoContinue: true }),
  );
  await until(
    async () => ended && (await agent.report()).modelCalls >= modelCalls,
    async () => ({ streamed, ended, ...(await agent.report()) }),
  );
  socket.close();
  return streamed;
}

async function play(env: Env, change: Change): Promise<Played> {
  const agent = (await getAgentByName(env.RefundAgent as never, change)) as unknown as Stub;
  await agent.setChange(change);
  await agent.saveMessages([{ id: "u1", role: "user", parts: [{ type: "text", text: "Refund order 4417 ($250)." }] }]);
  await agent.tamper("call_1");
  const streamed = await answer(agent, "call_1", 2);
  if (change === "retry-after-forget") {
    // The model answered the denial with a fresh call, which paused with a newly signed request.
    await until(
      async () => (await agent.toolParts()).some((p) => p.toolCallId === "call_2"),
      () => agent.report(),
    );
    streamed.push(...(await answer(agent, "call_2", 3)));
  }
  await sleep(200);
  return { ...(await agent.report()), streamed, outcomes: await agent.deniedOutcomes() };
}

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const change = new URL(request.url).pathname.slice(1) as Change;
    try {
      return Response.json(await play(env, change));
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
