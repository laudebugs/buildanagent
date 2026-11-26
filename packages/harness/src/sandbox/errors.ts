/** The sandbox's five named errors, each a `HarnessError` with its own code and its own fields. */
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
 * `provision()` or a resume. After `provision()` the sandbox is disposed before the error is thrown, so nothing runs
 * under the wrong policy; after `resumeSandbox()` it is left to the caller, who decides whether to dispose it. `field`
 * names the first field that differs, such as `network.allow`. The message names only the field and, for `stops`, the
 * cause, never a path or host from either policy.
 */
export class SandboxPolicyMismatchError extends HarnessError {
  override readonly name = "SandboxPolicyMismatchError";
  /**
   * What differs: `readRoots`, `writeRoots`, `network.allow` or `network.deny` for the first field that differs;
   * `stops` when the applied policy can't deliver a stop the backend claims; `readBack` when a backend that claims a
   * stop has no read-back or its read-back fails; and `settings` when a settings file isn't in the shape its backend
   * writes.
   */
  readonly field: string;

  /** `options.reason` says why a claimed stop isn't delivered, and must not hold a path or host of either policy. */
  constructor(field: string, options?: ErrorOptions & { readonly reason?: string }) {
    const { reason, ...rest } = options ?? {};
    super(
      "sandbox_policy_mismatch",
      reason === undefined
        ? `the sandbox applied a policy that differs from the one requested, in ${field}`
        : `the sandbox can't deliver the ${field} its backend claims: ${reason}`,
      rest,
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

/**
 * Thrown by a hosted backend's `provision()` or `resume()` when a secret that its egress rules name doesn't exist. The
 * provider would still forward each request to the host, only without the credential, so the backend refuses before it
 * creates or wakes a sandbox. The message and the fields hold names only, never a credential's value.
 */
export class SandboxSecretUnresolvedError extends HarnessError {
  override readonly name = "SandboxSecretUnresolvedError";
  /** The backend, such as `e2b`. */
  readonly backend: string;
  /** The provider's name for the secret, such as `github_token`. */
  readonly secret: string;
  /** The `EgressPolicy` credential name the secret stands for, such as `GITHUB_TOKEN`. */
  readonly credential: string;

  constructor(backend: string, secret: string, credential: string, options?: ErrorOptions) {
    super(
      "sandbox_secret_unresolved",
      `the ${backend} secret ${JSON.stringify(secret)} for the credential ${credential} does not exist, so no sandbox was started`,
      options,
    );
    this.backend = backend;
    this.secret = secret;
    this.credential = credential;
  }
}
