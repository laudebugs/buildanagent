/**
 * `@buildanagent/harness/sandbox`: the sandbox interface, the unsafe `none` backend, `spawnEnv()`, and the policy
 * read-back and capability helpers. The `srt` and Docker backends have their own subpaths. `fakeSandbox()` and the
 * conformance suite are in `./testing`.
 */
export {
  SandboxDeniedError,
  SandboxPolicyMismatchError,
  SandboxUnavailableError,
  SandboxUnsupportedError,
} from "./errors.js";
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
