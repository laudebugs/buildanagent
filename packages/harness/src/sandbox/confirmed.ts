/**
 * The stops a sandbox reports, which every backend keeps the same way: none until its policy is read back and
 * confirmed, then what that policy delivers. It is portable, so a hosted backend that imports no Node module can share
 * it with the local ones.
 */
import { APPLY_STOPS, confirmPolicy } from "./policy.js";
import type { Sandbox, SandboxClient, SandboxPolicy, SandboxStop } from "./types.js";

/** The base of a backend's sandbox: its `stops`, `confirm()` and the hook `resumeSandbox()` sets them through. */
export abstract class ConfirmedSandbox {
  private applied: readonly SandboxStop[] = [];

  /** The stops the applied policy delivers, set by `confirm()` when the sandbox is provisioned. */
  get stops(): readonly SandboxStop[] {
    return this.applied;
  }

  /** Reads the policy back and checks it against `requested`, or disposes the sandbox and throws on a difference. */
  async confirm(client: SandboxClient, requested: SandboxPolicy): Promise<void> {
    // Every subclass implements `Sandbox`; the base can't say so without declaring the whole interface abstract.
    this.applied = await confirmPolicy(client, this as unknown as Sandbox, requested);
  }

  /** Sets the stops a resumed sandbox's confirmed policy delivers, for `resumeSandbox()`. */
  [APPLY_STOPS](stops: readonly SandboxStop[]): void {
    this.applied = stops;
  }
}
