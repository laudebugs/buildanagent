import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noneSandbox } from "@buildanagent/harness/sandbox";
import {
  fakeSandbox,
  runSandboxConformance,
  type SandboxFactory,
  sandboxConformanceCases,
} from "@buildanagent/harness/testing";
import { afterAll, test } from "vitest";

// The suite that pins the sandbox interface runs here against the in-memory fake and the real `none` backend, which
// runs real programs in a temp folder. A case that needs enforcement skips for `none`, with its reason, because `none`
// stops nothing and says so.
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-sandbox-"));
  roots.push(root);
  mkdirSync(`${root}-outside`, { recursive: true });
  roots.push(`${root}-outside`);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const backends: [string, SandboxFactory][] = [
  ["the fake", () => ({ client: fakeSandbox(), root: "/workspace" })],
  ["the none backend", () => ({ client: noneSandbox({ unsafe: true, warn: () => {} }), root: tempRoot() })],
];

for (const [label, factory] of backends) {
  const options = { networkProbe: (host: string) => ["net-probe", host] };
  for (const conformance of sandboxConformanceCases(factory, options)) {
    test(`${label}: ${conformance.name}`, async (context) => {
      const outcome = await conformance.run();
      if (outcome !== undefined) context.skip(outcome.skipped);
    }, 30_000);
  }
}

test("the fake passes every case, and none skips", async () => {
  const report = await runSandboxConformance(() => ({ client: fakeSandbox(), root: "/workspace" }), {
    networkProbe: (host) => ["net-probe", host],
  });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.skipped, []);
  assert.ok(report.passed.length >= 10, "the suite ran its cases");
});

test("none passes the cases that don't need enforcement and skips the rest with a reason", async () => {
  const report = await runSandboxConformance(() => ({
    client: noneSandbox({ unsafe: true, warn: () => {} }),
    root: tempRoot(),
  }));
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.skipped.map((skip) => skip.name).sort(), [
    "a read outside the read roots is denied",
    "a write outside the write roots is denied",
    "the network is denied unless the host is on the allowlist",
  ]);
  for (const skip of report.skipped) assert.match(skip.reason, /does not claim to stop/);
});

test("a backend that can't start skips every case that needs it, with its reason, and fails none", async () => {
  const report = await runSandboxConformance(() => ({
    client: fakeSandbox({ unavailable: "the binary is missing" }),
    root: "/workspace",
  }));
  assert.deepEqual(report.failed, []);
  assert.ok(report.skipped.length >= 8);
  for (const skip of report.skipped)
    assert.match(skip.reason, /the fake sandbox is unavailable: the binary is missing/);
});

test("a backend that breaks the rules fails the suite: one that leaks the parent's environment", async () => {
  const leaky = fakeSandbox();
  const original = leaky.provision.bind(leaky);
  leaky.provision = async (manifest, policy) => {
    const sandbox = await original(manifest, policy);
    return {
      ...sandbox,
      exec: (command, options) =>
        sandbox.exec(command, { ...options, env: { ...options.env, ANTHROPIC_API_KEY: "leaked" } }),
      readFile: (path) => sandbox.readFile(path),
      writeFile: (path, data) => sandbox.writeFile(path, data),
      dispose: () => sandbox.dispose(),
    };
  };
  const report = await runSandboxConformance(() => ({ client: leaky, root: "/workspace" }));
  assert.deepEqual(
    report.failed.map((failure) => failure.name),
    ["exec's environment holds only the variables it was given, and no credential"],
  );
});
