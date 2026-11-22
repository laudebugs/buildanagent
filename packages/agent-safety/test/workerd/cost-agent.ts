// A Worker for test/cloudflare-cost-guard.test.ts, bundled with esbuild and run in workerd through Miniflare. It holds
// a Cloudflare `AIChatAgent` whose model comes from a provider wrapped in `costGuard()`. Each request starts one turn
// under the cap the request names, on a model that keeps calling `lookup`, and reports how many requests the model
// received and the refusal that ended the turn.
//
// It imports the package's source by relative path, which esbuild bundles.
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import { customProvider, isStepCount, jsonSchema, streamText, tool } from "ai";
import { budgetRefusal, costGuard, type GuardedCall, guardedProvider, memorySpend } from "../../src/cost/index.js";
import { CATALOG, lookupModel, STEPS } from "./cost-model.js";
import type { Capped } from "./scenario.js";

interface Env {
  readonly CappedAgent: DurableObjectNamespace;
}

export class CappedAgent extends AIChatAgent<Env> {
  private requests: LanguageModelV4CallOptions[] = [];
  private calls: GuardedCall[] = [];
  private refusal: Capped["refusal"] = null;
  private spend = memorySpend();
  private capUsd = 0;

  override async onChatMessage() {
    const lookup = tool({
      description: "Look up an order's status",
      inputSchema: jsonSchema<{ order: number }>({ type: "object", properties: { order: { type: "number" } } }),
      execute: async () => ({ status: "shipped" }),
    });
    const guard = costGuard({
      capUsd: this.capUsd,
      spend: this.spend,
      catalog: CATALOG,
      onCallCost: (call) => this.calls.push(call),
    });
    const provider = guardedProvider(customProvider({ languageModels: { priced: lookupModel(this.requests) } }), guard);
    const result = streamText({
      model: provider.languageModel("priced"),
      system: "You look up orders.",
      prompt: "Has every order shipped?",
      tools: { lookup },
      stopWhen: isStepCount(STEPS),
      maxRetries: 0,
      onError: ({ error }) => {
        const refused = budgetRefusal(error);
        if (refused)
          this.refusal = { code: refused.code, spentUsd: refused.spentUsd, projectedUsd: refused.projectedUsd };
      },
    });
    return result.toUIMessageStreamResponse();
  }

  async play(capUsd: number): Promise<Capped> {
    this.capUsd = capUsd;
    const turn = await this.saveMessages([{ id: "u1", role: "user", parts: [{ type: "text", text: "Go." }] }]);
    return {
      status: turn.status,
      modelCalls: this.requests.length,
      spentUsd: await this.spend.get(),
      refusal: this.refusal,
      calls: this.calls.map(({ projectedUsd, costUsd }) => ({ projectedUsd, costUsd })),
    };
  }
}

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const capUsd = Number(url.searchParams.get("cap"));
    try {
      const agent = (await getAgentByName(env.CappedAgent as never, url.pathname.slice(1))) as unknown as {
        play(capUsd: number): Promise<Capped>;
      };
      return Response.json(await agent.play(capUsd));
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
