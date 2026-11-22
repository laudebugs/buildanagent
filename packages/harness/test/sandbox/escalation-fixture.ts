// A harness for sandbox escalation, shared by the escalation tests and the process the second-process test spawns.
// Its `run` tool runs a command, and the pipeline allows `run`, so a rerun's fresh decision lets it start unless a test
// adds a deny rule. The fake sandbox runs no program: `net-probe <host>` reaches a host only if the policy allows it.
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline, type Rule } from "@buildanagent/harness/permissions";
import type { SandboxPolicy } from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import { createApprovals, type QuorumPolicy } from "@buildanagent/harness/session";
import { fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { fakeSandbox } from "@buildanagent/harness/testing";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { type ApprovalSigner, defineTool, hmacSigner, type ToolResult } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";

/** The fixture's own key ring. The bytes are a fixed test pattern, never a real key. */
export const ESCALATION_KEYS = {
  keys: { e1: Uint8Array.from({ length: 32 }, (_, index) => index + 101) },
  current: "e1",
};

/** The workspace every test provisions. */
export const ROOT = "/work/repo";

/** The policy every command first runs under: the workspace, and no network. */
export const BASE_POLICY: SandboxPolicy = { readRoots: [ROOT], writeRoots: [ROOT], network: { allow: [], deny: [] } };

/** The `run` tool's input schema: a command and nothing that could name a sandbox setting. */
export const RUN_SCHEMA = {
  type: "object",
  properties: { command: { type: "array", items: { type: "string" } } },
  required: ["command"],
} as const;

export interface EscalationHarnessOptions {
  readonly signer?: ApprovalSigner;
  readonly keysPath?: string;
  /** Deny rules, such as one written after a pause. */
  readonly deny?: readonly Rule[];
  readonly quorum?: QuorumPolicy;
  /** What the scripted model answers, for a test that runs a turn. */
  readonly steps?: ConstructorParameters<typeof ScriptedModel>[0];
  /** What the `run` tool does when the model calls it. Default: an error, because no test should reach it. */
  readonly onRun?: (input: { command: string[] }) => Promise<ToolResult<unknown>>;
}

/** A harness with a `run` tool, its approvals, a fake sandbox client and the scripted model's adapter. */
export async function escalationHarness(options: EscalationHarnessOptions = {}) {
  const registry = createToolRegistry();
  registry.register({
    name: "run",
    source: "builtin",
    definition: defineTool({
      name: "run",
      description: "Runs a command in the sandbox.",
      inputSchema: RUN_SCHEMA,
      async execute(input: { command: string[] }) {
        if (options.onRun === undefined) throw new Error("the run tool has no runner in this test");
        return options.onRun(input);
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
      deny: [...(options.deny ?? [])],
      allow: [{ tool: "run" }],
    },
    registry,
  );
  const signer =
    options.signer ??
    hmacSigner(options.keysPath === undefined ? ESCALATION_KEYS : await fileKeyStore(options.keysPath).load());
  const harness = createHarness({ registry, model, system: "You run commands.", pipeline, signer });
  const approvals = createApprovals(harness, options.quorum === undefined ? {} : { quorum: options.quorum });
  return { harness, approvals, registry, adapter, client: fakeSandbox() };
}
