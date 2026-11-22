/**
 * `createHarness()`: a harness from its options, with the defaults filled in and `invokeTool()` bound to the code-call
 * runner. It is apart from the harness's types because the runner imports them.
 */
import type { Harness, HarnessOptions } from "./harness.js";
import { invokeCodeCall } from "./session/code-call.js";

/** Creates a harness. `H` types the host context of each turn, so `runTurn()` checks it. */
export function createHarness<H = unknown>(options: HarnessOptions<H>): Harness<H> {
  return {
    ...options,
    tenant: options.tenant ?? "local",
    env: {
      cwd: options.env?.cwd ?? "/",
      permissionMode: options.env?.permissionMode ?? "default",
      approvalPolicy: options.env?.approvalPolicy ?? "on-request",
      sandbox: options.env?.sandbox ?? "none",
    },
    harnessVersion: options.harnessVersion ?? "0.0.0",
    ablationHash: options.ablationHash ?? "none",
    // `this`, not a captured harness, so a copy made with a spread runs with its own settings.
    invokeTool(session, call) {
      return invokeCodeCall(this, session, call);
    },
  };
}
