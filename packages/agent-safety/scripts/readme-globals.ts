// The names the README's TypeScript blocks use without defining them, for scripts/docs-check.mjs, which type-checks
// each block as a module beside this file. A block's own imports and declarations shadow these.
import type * as safety from "@buildanagent/agent-safety";
import type * as aiEntry from "@buildanagent/agent-safety/ai";
import type * as byok from "@buildanagent/agent-safety/byok";
import type * as cost from "@buildanagent/agent-safety/cost";
import type * as cloudflare from "@buildanagent/agent-safety/stores/cloudflare";
import type * as chat from "@cloudflare/ai-chat";
import type * as ai from "ai";

declare global {
  type EffectScope = safety.EffectScope;
  type EffectStore = safety.EffectStore;
  type GuardableProvider = cost.GuardableProvider;
  // The types the examples that the README shows a function of declare beside it.
  type Order = { id: string; customerEmail: string; refundableCents: number; refundedCents: number };
  type Payments = {
    refunds: {
      create(input: RefundInput, options: { idempotencyKey: string }): Promise<{ id: string }>;
      findByKey(key: string): Promise<{ id: string } | undefined>;
    };
  };
  type PlanFields = safety.PlanFields;
  type Recheck = safety.Recheck;
  type RefundInput = { orderId: string; amountCents: number };
  type UIMessage = ai.UIMessage;
  type WriteOutcome = safety.WriteOutcome;

  const AIChatAgent: typeof chat.AIChatAgent;
  const budgetRefusal: typeof cost.budgetRefusal;
  const canonicalInputHash: typeof safety.canonicalInputHash;
  const checkModelRoutes: typeof safety.checkModelRoutes;
  const costGuard: typeof cost.costGuard;
  const explicitProvider: typeof byok.explicitProvider;
  const generateText: typeof ai.generateText;
  const guardedProvider: typeof cost.guardedProvider;
  const guardedWrite: typeof safety.guardedWrite;
  const hmacSigner: typeof safety.hmacSigner;
  const isStepCount: typeof ai.isStepCount;
  const memoryPlanLedger: typeof safety.memoryPlanLedger;
  const memorySpend: typeof cost.memorySpend;
  const parseKeyRing: typeof safety.parseKeyRing;
  const planCard: typeof safety.planCard;
  const planWriteOutcome: typeof safety.planWriteOutcome;
  const repairInterruptedWrite: typeof aiEntry.repairInterruptedWrite;
  const runPlan: typeof safety.runPlan;
  const settleDeniedApprovals: typeof aiEntry.settleDeniedApprovals;
  const signPlan: typeof safety.signPlan;
  const signedToolApproval: typeof aiEntry.signedToolApproval;
  const tool: typeof ai.tool;
  const verifyPlanBeforeStep: typeof safety.verifyPlanBeforeStep;
  const writeOutcome: typeof safety.writeOutcome;

  const APPROVAL_TTL_MS: number;
  const CAP_USD: number;
  const CENTS_PER_DOLLAR: number;
  const MAX_STEPS: number;
  const agent: { readonly messages: UIMessage[] };
  const approval: safety.PlanApproval;
  const ctx: { readonly storage: { readonly sql: cloudflare.SqlStorageLike } };
  const currentPolicyVersion: string;
  const deniedCallIds: ReadonlySet<string>;
  const env: { readonly APPROVAL_KEYS: string };
  const gatewayURL: string;
  const input: { readonly orderId: string; readonly amountCents: number };
  const inputSchema: ai.FlexibleSchema<{ orderId: string; amountCents: number }>;
  const issueRefund: (input: { orderId: string; amountCents: number }) => Promise<safety.WriteOutcome>;
  const ledger: safety.PlanLedger;
  const messages: ai.ModelMessage[];
  const model: ai.LanguageModel;
  const modelId: string;
  const plan: safety.PlanFields;
  const prompt: string;
  const provider: cost.GuardableProvider;
  const readState: Parameters<typeof safety.runPlan>[0]["readState"];
  const readValues: Parameters<typeof safety.runPlan>[0]["readState"];
  const recheck: Recheck;
  const refund: ai.Tool;
  const runRefund: (input: unknown) => Promise<void>;
  const scope: Parameters<typeof safety.runPlan>[0]["scope"];
  const sessionSpend: cost.Spend;
  const signer: safety.ApprovalSigner;
  const steps: Parameters<typeof safety.runPlan>[0]["steps"];
  const store: safety.EffectStore & safety.PendingStore;
  const userKey: string;
}
