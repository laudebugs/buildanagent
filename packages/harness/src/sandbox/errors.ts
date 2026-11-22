/** The sandbox's four named errors, each a `HarnessError` with its own code and its own fields. */
import { HarnessError } from "../errors.js";
import type { SandboxCapability, SandboxDenial } from "./types.js";

/** Thrown by `provision()` when a backend can't start, such as a missing binary. The host must not run unconfined. */
export class SandboxUnavailableError extends HarnessError {
  override readonly name = "SandboxUnavailableError";
  /** The backend that is unavailable, such as `srt`. */
  readonly backend: string;

  constructor(backend: string, reason: string, options?: ErrorOptions) {
    super("sandbox_unavailable", `the ${backend} sandbox is unavailable: ${reason}`, options);
    this.backend = backend;
  }
}

/** Thrown when the policy refuses a file read or write. A command's denial is an `ExecResult`, not an error. */
export class SandboxDeniedError extends HarnessError {
  override readonly name = "SandboxDeniedError";
  readonly denial: SandboxDenial;

  constructor(denial: SandboxDenial) {
    super(
      "sandbox_denied",
      `the sandbox denied a ${denial.kind.replace("_", " ")} of ${denial.target}: ${denial.reason}`,
    );
    this.denial = denial;
  }
}

/**
 * Thrown when the policy a backend read back from what it applied differs from the policy it was asked for, after
 * `provision()` or a resume. The sandbox is disposed before the error is thrown, so nothing runs under the wrong policy.
 * `field` names the first field that differs, such as `network.allow`. The message names only the field, never a path
 * or host from either policy.
 */
export class SandboxPolicyMismatchError extends HarnessError {
  override readonly name = "SandboxPolicyMismatchError";
  /** The first field that differs: `readRoots`, `writeRoots`, `network.allow`, `network.deny` or `stops`. */
  readonly field: string;

  constructor(field: string, options?: ErrorOptions) {
    super(
      "sandbox_policy_mismatch",
      `the sandbox applied a policy that differs from the one requested, in ${field}`,
      options,
    );
    this.field = field;
  }
}

/** Thrown by `resumeSandbox()`, `snapshotSandbox()` and `pauseSandbox()` for a capability the backend doesn't list. */
export class SandboxUnsupportedError extends HarnessError {
  override readonly name = "SandboxUnsupportedError";
  /** The capability that was asked for. */
  readonly capability: SandboxCapability;

  constructor(capability: SandboxCapability, tier: string) {
    super("sandbox_unsupported", `this ${tier}-tier sandbox backend can't ${capability}`);
    this.capability = capability;
  }
}
