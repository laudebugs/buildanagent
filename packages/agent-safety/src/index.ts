/**
 * `@buildanagent/agent-safety`: the safety core. Typed write outcomes that the harness can act on and the model can
 * read, and the canonical input hash that approvals sign and effect records store. This entry imports no third-party
 * SDK; the adapters for `ai` and Cloudflare `agents` live in the `./ai` and `./agents` subpaths.
 */
export { isSafetyError, SafetyError, type SafetyErrorCode } from "./errors.js";
export { canonicalInputHash } from "./hash.js";
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
export { type OutcomePayload, type RenderedOutcome, renderOutcome } from "./render.js";
