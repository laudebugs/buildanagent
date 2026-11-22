/**
 * `@buildanagent/harness/sandbox`: the sandbox interface, the unsafe `none` backend and `spawnEnv()`. The `srt` and
 * Docker backends have their own subpaths. `fakeSandbox()` and the conformance suite are in `./testing`.
 */
export { SandboxDeniedError, SandboxUnavailableError } from "./errors.js";
export { NONE_SANDBOX_WARNING, type NoneSandboxOptions, noneSandbox } from "./none.js";
export { spawnEnv } from "./spawn-env.js";
export type {
  ApprovalPolicy,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  SandboxStop,
  SandboxTier,
  WorkspaceManifest,
} from "./types.js";
