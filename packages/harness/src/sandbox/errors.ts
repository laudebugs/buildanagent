/** The sandbox's two named errors, each a `HarnessError` with its own code and its own fields. */
import { HarnessError } from "../errors.js";
import type { SandboxDenial } from "./types.js";

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
