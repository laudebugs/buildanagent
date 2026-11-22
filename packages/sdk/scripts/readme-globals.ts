// The names the README's TypeScript blocks use without defining them, for scripts/docs-check.mjs, which type-checks
// each block as a module beside this file. A block's own imports and declarations shadow these.
import type * as gateway from "@buildanagent/gateway";
import type * as sdk from "@buildanagent/sdk";
import type * as testing from "@buildanagent/sdk/testing";
import type * as zod from "zod";

declare global {
  const blockingApprovals: typeof sdk.blockingApprovals;
  const composeInterceptors: typeof sdk.composeInterceptors;
  const continueRun: typeof sdk.continueRun;
  const createModel: typeof gateway.createModel;
  const createPendingRequest: typeof sdk.createPendingRequest;
  const defineTool: typeof sdk.defineTool;
  const hmacSigner: typeof sdk.hmacSigner;
  const nestedRunDepth: typeof sdk.nestedRunDepth;
  const run: typeof sdk.run;
  const verifyResolution: typeof sdk.verifyResolution;
  const runOrThrow: typeof sdk.runOrThrow;
  const autoResponder: typeof testing.autoResponder;
  const replayPairs: typeof testing.replayPairs;
  const scriptedApprovals: typeof testing.scriptedApprovals;
  const ScriptedModel: typeof testing.ScriptedModel;
  const testSigner: typeof testing.testSigner;
  const z: typeof zod.z;

  type ToolContext = sdk.ToolContext;
  type WriteOutcome = sdk.WriteOutcome;
  type FindOrder = (order: number) => Promise<{ readonly status: string } | undefined>;
  const askInTerminal: (request: sdk.SignedPendingRequest, input: unknown) => Promise<sdk.Resolution>;
  const callId: string;
  const refund: (input: unknown) => Promise<void>;
  const request: sdk.SignedPendingRequest;
  const resolution: sdk.Resolution;
  const findOrder: FindOrder;
  const findPlan: (customerId: string) => Promise<string>;
  const session: { readonly customerId: string };
  const fixture: string;
  const gate: NonNullable<sdk.Interceptors["beforeToolCall"]>;
  const base: {
    readonly operation: string;
    readonly reverted: readonly string[];
    readonly notReversible: readonly string[];
  };
  const id: string;
  const input: string;
  const key2611: Uint8Array;
  const key2612: Uint8Array;
  const lookupOrderTool: (findOrder: FindOrder) => sdk.ToolDefinition<{ order: number }, { status: string }>;
  const MAX_STEPS: number;
  const model: gateway.Model;
  const provider: { forceFlush(): Promise<void> };
  const next: string;
  const question: string;
  const reason: string;
  const reply: { readonly code: string };
  const requestId: string;
  const signer: sdk.ApprovalSigner;
  const store: { save(context: sdk.Context): Promise<void>; load(id: string): Promise<sdk.Context> };
  const system: string;
  const SYSTEM_PROMPT: string;
  const tools: readonly sdk.ToolDefinition<never, unknown>[];
  const write: (text: string) => void;
}
