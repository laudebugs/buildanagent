// A Worker for test/cloudflare-cost-guard.test.ts, bundled with esbuild and run in workerd through Miniflare. It holds
// a Cloudflare `Think` agent whose `getModel()` returns a model from a provider wrapped in `costGuard()`, as the README
// says to do. Each request runs one turn under the cap the request names, on a model that keeps calling `lookup`, and
// reports how many requests the model received and the refusal that ended the turn.
//
// It imports the package's source by relative path, which esbuild bundles.
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { Think } from "@cloudflare/think";
import { getAgentByName } from "agents";
import { customProvider, jsonSchema, tool } from "ai";
import { costGuard, type GuardedCall, guardedProvider, memorySpend } from "../../src/cost/index.js";
import { CATALOG, lookupModel, STEPS } from "./cost-model.js";
import type { Capped } from "./scenario.js";

interface Env {
  readonly CappedThink: DurableObjectNamespace;
}

export class CappedThink extends Think<Env> {
  // One guard for the agent's life, so every turn's model shares its cap.
  private provider: ReturnType<typeof guardedProvider> | undefined;
  private requests: LanguageModelV4CallOptions[] = [];
  private calls: GuardedCall[] = [];
  private spend = memorySpend();
  private capUsd = 0;

  // Think calls `getModel()` for each turn, so the guarded provider is built once and reused.
  override getModel() {
    this.provider ??= guardedProvider(
      customProvider({ languageModels: { priced: lookupModel(this.requests) } }),
      costGuard({
        capUsd: this.capUsd,
        spend: this.spend,
        catalog: CATALOG,
        onCallCost: (call) => this.calls.push(call),
      }),
    );
    return this.provider.languageModel("priced");
  }

  override getSystemPrompt() {
    return "You look up orders.";
  }

  override getTools() {
    return {
      lookup: tool({
        description: "Look up an order's status",
        inputSchema: jsonSchema<{ order: number }>({ type: "object", properties: { order: { type: "number" } } }),
        execute: async () => ({ status: "shipped" }),
      }),
    };
  }

  async play(capUsd: number): Promise<Capped> {
    this.capUsd = capUsd;
    this.maxSteps = STEPS;
    const turn = await this.runTurn({ input: "Has every order shipped?" });
    return {
      status: turn.status,
      modelCalls: this.requests.length,
      spentUsd: await this.spend.get(),
      // `runTurn()` reports a failed turn as its message, not as the error object, so the refusal's code is out of reach.
      refusal: null,
      error: turn.status === "error" ? (turn.error ?? "") : null,
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
      const agent = (await getAgentByName(env.CappedThink as never, url.pathname.slice(1))) as unknown as {
        play(capUsd: number): Promise<Capped>;
      };
      return Response.json(await agent.play(capUsd));
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
