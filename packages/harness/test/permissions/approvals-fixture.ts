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
 * What each run of the refund tool appends to `runsFile`, so a test counts the runs across processes. The ring comes
 * from `keyStore` when it is given, and from the key file at `keysPath` otherwise.
 */
export async function refundHarness(options: {
  steps: ScriptStep[];
  keysPath?: string;
  keyStore?: KeyStore;
  runsFile: string;
}) {
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
  const signer = hmacSigner(await (options.keyStore ?? fileKeyStore(options.keysPath)).load());
  return createHarness({ registry, model, system: "You triage tickets.", pipeline, signer });
}
