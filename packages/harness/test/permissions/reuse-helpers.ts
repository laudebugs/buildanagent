// Shared by the sticky, grouped and quorum tests: tools that ask for approval and count their runs.
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, hmacSigner } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { type Backend, KEY } from "../session/session-helpers.js";

type Steps = ConstructorParameters<typeof ScriptedModel>[0];
type Reuse = NonNullable<Parameters<ToolRegistry["register"]>[0]["approvalReuse"]>;

const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 7);

/** One harness whose `refund` and `bash` tools ask for approval; `runs` counts the calls that actually ran. */
export function reuseSetup(steps: Steps, options: { refundReuse?: Reuse; bashReuse?: Reuse } = {}) {
  const runs: string[] = [];
  const registry = createToolRegistry();
  const tool = (name: string, field: string) =>
    defineTool({
      name,
      description: `The ${name} tool.`,
      inputSchema: { type: "object", properties: { [field]: { type: "string" } }, required: [field] },
      async execute(input: Record<string, string>) {
        runs.push(`${name}:${input[field]}`);
        return { content: [{ type: "text", text: `${name} ran` }] };
      },
    }) as never;
  registry.register({
    name: "refund",
    source: "builtin",
    definition: tool("refund", "orderId"),
    ...(options.refundReuse === undefined ? {} : { approvalReuse: options.refundReuse }),
  });
  registry.register({
    name: "bash",
    source: "builtin",
    definition: tool("bash", "command"),
    ...(options.bashReuse === undefined ? {} : { approvalReuse: options.bashReuse }),
  });
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const pipeline = createPermissionPipeline(
    { mode: "default", interactive: true, policyVersion: "p1", ask: [{ tool: "refund" }, { tool: "bash" }] },
    registry,
  );
  const signer = hmacSigner({ keys: { k1: KEY_BYTES }, current: "k1" });
  return { adapter, runs, harness: createHarness({ registry, model, system: "s", pipeline, signer }) };
}

/** A step in which the model calls `tool` once per entry of `inputs`, with call ids `c1`, `c2`, ... */
export const calls = (tool: string, inputs: readonly Record<string, string>[], first = 1) => ({
  content: inputs.map((input, index) => ({
    type: "tool_call" as const,
    callId: `c${first + index}`,
    name: tool,
    input,
  })),
});

export const done = (text = "Done.") => ({ content: [{ type: "text" as const, text }] });

export const open = (backend: Backend, key = KEY) =>
  openSession({ store: backend.store, index: backend.index, lock: backend.lock, key });

export async function entriesOf(backend: Backend, key = KEY): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(key)) found.push(entry);
  return found;
}
