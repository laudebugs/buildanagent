// A harness whose refund tool asks for approval, shared by the second-process test and the process it spawns.
import { appendFileSync } from "node:fs";
import type { KeyStore } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, hmacSigner } from "@buildanagent/sdk";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";

/**
 * Where `refundHarness()` loads its key ring: the key file at `keysPath`, or `keyStore`. Exactly one is required, so a
 * test can never fall back to the default ring under `~/.local/state`.
 */
export type RefundKeys =
  | { readonly keysPath: string; readonly keyStore?: undefined }
  | { readonly keyStore: KeyStore; readonly keysPath?: undefined };

/** What each run of the refund tool appends to `runsFile`, so a test counts the runs across processes. */
export async function refundHarness(options: { steps: ScriptStep[]; runsFile: string } & RefundKeys) {
  const registry = createToolRegistry();
  registry.register({
    name: "refund",
    source: "builtin",
    definition: defineTool({
      name: "refund",
      description: "Refunds an order.",
      inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      async execute(input: { orderId: string }) {
        appendFileSync(options.runsFile, `${input.orderId}\n`);
        return { content: [{ type: "text", text: `refunded ${input.orderId}` }] };
      },
    }) as never,
  });
  const adapter = new ScriptedModel(options.steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const pipeline = createPermissionPipeline(
    { mode: "default", interactive: true, policyVersion: "p1", ask: [{ tool: "refund" }] },
    registry,
  );
  if (options.keyStore === undefined && typeof options.keysPath !== "string") {
    throw new Error("refundHarness() needs a keysPath or a keyStore, so it never reads the default key ring");
  }
  const store = options.keyStore !== undefined ? options.keyStore : fileKeyStore(options.keysPath);
  const signer = hmacSigner(await store.load());
  return createHarness({ registry, model, system: "You triage tickets.", pipeline, signer });
}
