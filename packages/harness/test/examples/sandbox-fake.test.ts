// Runs the sandbox example on the fake: the command's output comes back, the write out of the workspace is denied, and
// the sandbox reports the policy it was asked for. The example must touch nothing on the host, so the test also checks
// that no file appeared and that nothing loaded Node's process or file modules.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { afterEach, test, vi } from "vitest";
import { runInFakeSandbox } from "../../examples/sandbox-fake.js";

afterEach(() => vi.restoreAllMocks());

test("the sandbox example runs a command, is denied a write outside its roots and reads its policy back", async () => {
  const result = await runInFakeSandbox();
  assert.deepEqual(result, {
    tier: "os",
    stops: ["mistakes", "exfiltration"],
    output: "# repo\n",
    denied: { kind: "filesystem_write", target: "/work/outside.txt", reason: "the path is outside the write roots" },
    reported: {
      readRoots: ["/work/repo", "/opt/tool-cache"],
      writeRoots: ["/work/repo"],
      network: { allow: [], deny: [] },
    },
    // Both commands reached the sandbox: the denial came from the policy, not from a command that never ran.
    execs: 2,
  });
});

test("the sandbox example touches no host file and starts no process", async () => {
  // Every Node-only part of the harness, the `none`, srt and Docker backends included, loads `node:child_process` and
  // `node:fs` through `process.getBuiltinModule()` when it is used, so a spy on it sees any host process or file call.
  const builtins = vi.spyOn(process, "getBuiltinModule");
  // The example's paths stay in the fake's memory, so whether they exist on the host is the same before and after.
  // The temp folder isn't compared, because the package's other test files create folders there in parallel.
  const hostPaths = (): boolean[] => ["/work", "/work/repo", "/work/outside.txt"].map((path) => existsSync(path));
  const pathsBefore = hostPaths();
  const cwdBefore = readdirSync(process.cwd());
  await runInFakeSandbox();
  assert.deepEqual(builtins.mock.calls, []);
  assert.deepEqual(hostPaths(), pathsBefore);
  assert.deepEqual(readdirSync(process.cwd()), cwdBefore);
});
