/**
 * `@buildanagent/agent-safety`: the safety core. Typed write outcomes that the harness can act on and the model can
 * read, the canonical input hash that approvals sign and effect records store, and the signers and signed pending
 * requests that make an approval fail closed. This entry imports no third-party SDK; the adapters for `ai` and
 * Cloudflare `agents` live in the `./ai` and `./agents` subpaths.
 */
export { isSafetyError, SafetyError, type SafetyErrorCode } from "./errors.js";
export { canonicalInputHash } from "./hash.js";
export { type KeyRing, type KeyStore, parseKeyRing, signerFromKeyStore } from "./key-store.js";
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
export { memoryPendingStore, type PendingStore } from "./pending-store.js";
export { type OutcomePayload, type RenderedOutcome, renderOutcome } from "./render.js";
export {
  type ApprovalSigner,
  ephemeralSigner,
  type HmacSignerOptions,
  hmacSigner,
  MIN_KEY_BYTES,
  TEST_KEY_ID,
  testSigner,
} from "./signer.js";
