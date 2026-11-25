/**
 * `@buildanagent/harness/sandbox`: the sandbox interface, the unsafe `none` backend, `spawnEnv()`, the policy read-back and
 * capability helpers, and `escalation()`, the host's state machine for a denied command. The `srt`, Docker and E2B
 * backends have their own subpaths. `fakeSandbox()` and the conformance suite are in `./testing`.
 *
 * @module @buildanagent/harness/sandbox
 */

export { ESCALATION_TOOL, type EscalationRecord } from "../session/escalation-log.js";
export {
  SandboxDeniedError,
  SandboxPolicyMismatchError,
  SandboxSecretUnresolvedError,
  SandboxUnavailableError,
  SandboxUnsupportedError,
} from "./errors.js";
export {
  type EscalationMachine,
  type EscalationOptions,
  type EscalationResolveOptions,
  type EscalationResult,
  type EscalationRule,
  type EscalationRun,
  escalation,
  type PendingEscalation,
} from "./escalation.js";
export {
  ESCALATION_EVENTS,
  ESCALATION_STATES,
  ESCALATION_TRANSITIONS,
  type EscalationEvent,
  type EscalationState,
  type EscalationTransition,
  nextEscalationState,
} from "./escalation-table.js";
export { NONE_SANDBOX_WARNING, type NoneSandboxOptions, noneSandbox } from "./none.js";
export {
  confirmPolicy,
  hasCapability,
  pauseSandbox,
  policyDifference,
  resumeSandbox,
  snapshotSandbox,
  stopsFor,
} from "./policy.js";
export { spawnEnv } from "./spawn-env.js";
export type {
  ApprovalPolicy,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxCapability,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  SandboxStop,
  SandboxTier,
  WorkspaceManifest,
} from "./types.js";
