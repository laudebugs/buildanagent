/**
 * `@buildanagent/agent-safety`: the safety core. It holds typed write outcomes that the harness can act on and the
 * model can read; the canonical input hash that approvals sign and effect records store; the signers and signed pending
 * requests that make an approval fail closed; the signed plan approval, which lets a person approve a whole plan once
 * and expires when the state it was computed from changes; `guardedWrite()` and the effect records that keep a crash or
 * a regenerated turn from repeating a write; and the egress guard and route check that keep every model call on the
 * user's own key. This entry imports no third-party SDK; the adapters for `ai` and Cloudflare `agents` live in the
 * `./ai`, `./byok` and `./agents` subpaths.
 */

export { type EffectScope, effectKey } from "./effect-key.js";
export { type EffectClaim, type EffectRecord, type EffectStore, memoryEffectStore } from "./effect-store.js";
export {
  CLOUDFLARE_NO_WHOLESALE_HEADER,
  CREDENTIAL_HEADERS,
  type CredentialHeader,
  type EgressCredential,
  type EgressGuardOptions,
  egressGuard,
} from "./egress.js";
export { isSafetyError, SafetyError, type SafetyErrorCode } from "./errors.js";
export { type GuardedWriteOptions, guardedWrite, type WriteDedupe } from "./guarded-write.js";
export { canonicalInputHash } from "./hash.js";
export { type KeyRing, type KeyStore, parseKeyRing, signerFromKeyStore } from "./key-store.js";
export {
  type CloudflareAiGatewaySettings,
  checkModelRoutes,
  MODEL_ROUTE_SETTINGS_AS_OF,
  type ModelRoute,
  type ModelRouteProblem,
  type ModelRouteProblemCode,
  type ModelRouteProvider,
  type ModelRoutesConfig,
  type ModelRoutesReport,
} from "./model-routes.js";
export { CLOUDFLARE_AI_GATEWAY_HOST } from "./model-url.js";
export {
  ALLOWED_RETRIES,
  type AllowedRetry,
  DEFAULT_RETRY,
  OUTCOME_KINDS,
  type OutcomeFields,
  type OutcomeKind,
  type Retry,
  type WriteOutcome,
  type WriteOutcomeInit,
  type WriteOutcomeOf,
  writeOutcome,
} from "./outcome.js";
export {
  type PendingCall,
  type PendingFields,
  pendingPayload,
  type Recheck,
  type RejectionCause,
  type Resolution,
  type ResolutionCheck,
  type SignedPendingRequest,
  type SignPendingOptions,
  signPending,
  type VerifyResolutionOptions,
  verifyResolution,
} from "./pending.js";
export { type MemoryPendingStoreOptions, memoryPendingStore, type PendingStore } from "./pending-store.js";
export {
  lintPlan,
  type PlanApproval,
  type PlanFields,
  type PlanLedger,
  type PlanLint,
  type PlanStep,
  type PlanStepCall,
  type PlanStepCheck,
  type PlanStepInit,
  type SignPlanOptions,
  type StateRead,
  type StateValue,
  type StepClass,
  signPlan,
  stateHash,
  type VerifyPlanStepOptions,
  verifyPlanBeforeStep,
} from "./plan-approval.js";
export { type PlanCard, type PlanCardStep, planCard } from "./plan-card.js";
export { memoryPlanLedger } from "./plan-ledger.js";
export { type OutcomePayload, type RenderedOutcome, renderOutcome } from "./render.js";
export {
  type ApprovalSigner,
  ephemeralSigner,
  type HmacSignerOptions,
  hmacSigner,
  MIN_KEY_BYTES,
} from "./signer.js";
