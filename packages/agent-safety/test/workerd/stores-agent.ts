// A Worker for test/stores/cloudflare.test.ts, bundled with esbuild and run in workerd through Miniflare. Its Durable
// Object runs one conformance case, or the lease scenario, against the stores on its own SQLite storage, and answers
// with the case's name and, if it failed, why. Each case gets an object of its own, so each starts from empty tables.
//
// It imports the package's source by relative path, which esbuild bundles.
import { DurableObject } from "cloudflare:workers";
import {
  createCloudflareTables,
  durableObjectEffectStore,
  durableObjectPlanLedger,
} from "../../src/stores/cloudflare.js";
import { effectStoreConformance, planLedgerConformance } from "../../src/testing.js";
import { leaseScenario } from "../stores/scenario.js";
import type { CaseResult } from "./scenario.js";

interface Env {
  readonly StoreDO: DurableObjectNamespace<StoreDO>;
}

export class StoreDO extends DurableObject<Env> {
  async runCase(kind: "effect" | "ledger" | "lease", index: number): Promise<CaseResult> {
    const sql = this.ctx.storage.sql;
    createCloudflareTables(sql);
    const effect = effectStoreConformance()[index];
    const ledger = planLedgerConformance()[index];
    const name = kind === "effect" ? effect?.name : kind === "ledger" ? ledger?.name : "lease scenario";
    if (name === undefined) return { name: `no ${kind} case ${index}`, error: "there is no such case" };
    try {
      if (kind === "effect") await effect?.run(() => durableObjectEffectStore(sql));
      else if (kind === "ledger") await ledger?.run(() => durableObjectPlanLedger(sql));
      else await leaseScenario(() => durableObjectEffectStore(sql));
      return { name };
    } catch (error) {
      return { name, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const kind = url.pathname.slice(1) as "effect" | "ledger" | "lease";
    const index = Number(url.searchParams.get("index") ?? 0);
    try {
      const stub = env.StoreDO.get(env.StoreDO.idFromName(`${kind}-${index}`));
      return Response.json(await stub.runCase(kind, index));
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
