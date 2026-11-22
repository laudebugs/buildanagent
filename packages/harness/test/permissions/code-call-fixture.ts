// A harness for code-initiated calls, shared by the code-call tests and the process the second-process test spawns.
// `lookup`, `export` and `charge` are allowed, `cancel` is denied, and `refund`, `refund_reverse` and `notify` ask;
// `notify` takes no sticky or grouped answer. `export` is a write whose result is `EXPORT_BYTES` of text, over the
// store's entry bound, and `charge` is a write that throws after it is called. Every tool appends
// `<tool>:<orderId>:<callId>` to `runs`, and to `runsFile` when one is given.
import { appendFileSync } from "node:fs";
import { writeOutcome } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline, type Rule } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { type ApprovalSigner, defineTool, hmacSigner } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";

/** The fixture's own key ring. The bytes are a fixed test pattern, never a real key. */
export const FIXTURE_KEYS = { keys: { k1: Uint8Array.from({ length: 32 }, (_, index) => index + 11) }, current: "k1" };

/** The bytes of text the `export` tool returns: more than the 64 KiB a store keeps in one entry. */
export const EXPORT_BYTES = 100 * 1024;

export interface CodeCallHarnessOptions {
  /** Signs and checks the pauses. Default the fixture's ring; `keysPath` loads a ring from a key file instead. */
  readonly signer?: ApprovalSigner;
  readonly keysPath?: string;
  readonly runsFile?: string;
  /** Deny rules added before the fixture's own, such as one written after a pause. */
  readonly deny?: readonly Rule[];
  readonly tenant?: string;
  /** What the scripted model answers, for a test that runs a turn after its code calls. Default nothing. */
  readonly steps?: ConstructorParameters<typeof ScriptedModel>[0];
}

type Order = { orderId: string };
const ORDER_SCHEMA = { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] } as const;

/** A harness for code calls, the ScriptedModel adapter no code call may reach, and the runs each tool made. */
export async function codeCallHarness(options: CodeCallHarnessOptions = {}) {
  const runs: string[] = [];
  const registry = createToolRegistry();
  const tool = (name: string, effect?: { businessKey?: (input: Order) => string }) =>
    defineTool({
      name,
      description: `The ${name} tool.`,
      inputSchema: ORDER_SCHEMA,
      ...(effect === undefined ? {} : { effect: { kind: "write" as const, ...effect } }),
      async execute(input: Order, ctx) {
        const line = `${name}:${input.orderId}:${ctx.callId}`;
        runs.push(line);
        if (options.runsFile !== undefined) appendFileSync(options.runsFile, `${line}\n`);
        return { content: [{ type: "text", text: `${name} ran for ${input.orderId}` }] };
      },
    }) as never;
  registry.register({ name: "lookup", source: "builtin", definition: tool("lookup") });
  registry.register({ name: "cancel", source: "builtin", definition: tool("cancel", {}) });
  registry.register({
    name: "refund",
    source: "builtin",
    definition: tool("refund", { businessKey: (input) => `refund:${input.orderId}` }),
  });
  registry.register({
    name: "refund_reverse",
    source: "builtin",
    definition: tool("refund_reverse", { businessKey: (input) => `refund-reverse:${input.orderId}` }),
  });
  registry.register({ name: "notify", source: "builtin", definition: tool("notify", {}), approvalReuse: "none" });
  registry.register({
    name: "export",
    source: "builtin",
    definition: defineTool({
      name: "export",
      description: "The export tool.",
      inputSchema: ORDER_SCHEMA,
      effect: { kind: "write" as const },
      async execute(input: Order, ctx) {
        runs.push(`export:${input.orderId}:${ctx.callId}`);
        return {
          content: [{ type: "text", text: "e".repeat(EXPORT_BYTES) }],
          outcome: writeOutcome({ kind: "applied", operation: "export", next: "Tell the user the export is ready" }),
        };
      },
    }) as never,
  });
  registry.register({
    name: "charge",
    source: "builtin",
    definition: defineTool({
      name: "charge",
      description: "The charge tool.",
      inputSchema: ORDER_SCHEMA,
      effect: { kind: "write" as const },
      async execute(input: Order, ctx) {
        runs.push(`charge:${input.orderId}:${ctx.callId}`);
        throw new Error("the card network timed out");
      },
    }) as never,
  });
  const adapter = new ScriptedModel(options.steps ?? []);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const pipeline = createPermissionPipeline(
    {
      mode: "default",
      interactive: true,
      policyVersion: "p1",
      deny: [...(options.deny ?? []), { tool: "cancel", reason: "cancelling is not allowed" }],
      ask: [{ tool: "refund" }, { tool: "refund_reverse" }, { tool: "notify" }],
      allow: [{ tool: "lookup" }, { tool: "export" }, { tool: "charge" }],
    },
    registry,
  );
  const signer =
    options.signer ??
    hmacSigner(options.keysPath === undefined ? FIXTURE_KEYS : await fileKeyStore(options.keysPath).load());
  const harness = createHarness({
    registry,
    model,
    system: "You run refunds.",
    pipeline,
    signer,
    ...(options.tenant === undefined ? {} : { tenant: options.tenant }),
  });
  return { harness, adapter, runs };
}
