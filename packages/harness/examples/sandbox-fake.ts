// The sandbox interface, shown with `fakeSandbox()`, the test double you run the rest of your agent on in tests. It
// keeps a workspace in memory, enforces the policy it is given and runs no real program. A real backend, such as
// `srtSandbox()` or `dockerSandbox()`, replaces it with the same `provision()`, `exec()` and policy read-back.
import type { ExecResult, SandboxDenial, SandboxPolicy, SandboxStop } from "@buildanagent/harness/sandbox";
import { fakeSandbox } from "@buildanagent/harness/testing";

const WORKSPACE = "/work/repo";
const TIMEOUT_MS = 10_000;

// #region policy
// The agent may read and write its workspace, may only read the shared tool cache, and may reach no host.
const policy: SandboxPolicy = {
  readRoots: [WORKSPACE, "/opt/tool-cache"],
  writeRoots: [WORKSPACE],
  network: { allow: [], deny: [] },
};
// #endregion

/** What the run shows: the command's output, the write the policy refused, and the policy the sandbox reported. */
export interface SandboxDemo {
  readonly tier: string;
  readonly stops: readonly SandboxStop[];
  readonly output: string;
  readonly denied: SandboxDenial | undefined;
  readonly reported: SandboxPolicy | undefined;
  readonly execs: number;
}

/** The output of a command that ran, or the empty string for one the policy refused. */
const outputOf = (result: ExecResult): string => ("denied" in result ? "" : result.stdout);

/** Provisions the fake sandbox, runs a command, tries a write outside the workspace and reads the policy back. */
export async function runInFakeSandbox(): Promise<SandboxDemo> {
  // #region provision
  const client = fakeSandbox();
  const sandbox = await client.provision({ root: WORKSPACE, files: { "README.md": "# repo\n" } }, policy);
  // #endregion
  try {
    // #region run
    // The command's environment is exactly `env`: nothing is copied from the host.
    const options = { env: {}, signal: new AbortController().signal, timeoutMs: TIMEOUT_MS };
    const shown = await sandbox.exec(["cat", "README.md"], options);
    // #endregion
    // #region denied
    // A write that climbs out of the workspace resolves with the denial instead of an exit code, and writes nothing.
    const attempt = await sandbox.exec(["write", "../outside.txt", "escaped"], options);
    const denied = "denied" in attempt ? attempt.denied : undefined;
    // #endregion
    // #region read-back
    // The sandbox reports the policy it enforces. `provision()` already compared it with the request and would have
    // thrown `SandboxPolicyMismatchError` on any difference.
    const reported = await sandbox.readBack?.();
    // #endregion
    return {
      tier: client.tier,
      stops: sandbox.stops ?? [],
      output: outputOf(shown),
      denied,
      reported,
      execs: client.execs.length,
    };
  } finally {
    await sandbox.dispose();
  }
}
