import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
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

const fakeFactory: SandboxFactory = () => {
  const client = fakeSandbox();
  return { client, root: "/workspace", symlink: (link, target) => client.symlink(link, target) };
};
const noneFactory: SandboxFactory = () => ({
  client: noneSandbox({ unsafe: true, warn: () => {} }),
  root: tempRoot(),
  symlink: (link, target) => symlinkSync(target, link),
});

const backends: [string, SandboxFactory][] = [
  ["the fake", fakeFactory],
  ["the none backend", noneFactory],
];

// A background process that outlives its parent unless the whole tree is killed: it holds the output pipes open too.
const processTree = {
  command: ["sh", "-c", "sleep 30 & echo $! > pid; wait"],
  isAlive: (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};
const fakeNetwork = {
  allowed: "allowed.test",
  blocked: "blocked.test",
  command: (host: string) => ["net-probe", host],
};

for (const [label, factory] of backends) {
  const options = { network: fakeNetwork, ...(label === "the fake" ? {} : { processTree }) };
  for (const conformance of sandboxConformanceCases(factory, options)) {
    test(`${label}: ${conformance.name}`, async (context) => {
      const outcome = await conformance.run();
      if (outcome !== undefined) context.skip(outcome.skipped);
    }, 30_000);
  }
}

test("the fake passes every case, and none skips", async () => {
  const report = await runSandboxConformance(fakeFactory, { network: fakeNetwork });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(
    report.skipped.map((skip) => skip.name),
    ["an abort and a timeout end the command's whole process tree, and exec settles"],
  );
  assert.ok(report.passed.length >= 15, "the suite ran its cases");
});

test("none passes the cases that don't need enforcement and skips the rest with a reason", async () => {
  const report = await runSandboxConformance(noneFactory, { processTree });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.skipped.map((skip) => skip.name).sort(), [
    "a backend that claims a stop reads back the policy it applied, which equals the request, and delivers its stops",
    "a path that climbs out of the workspace with .. is denied for reads and writes",
    "a read outside the read roots is denied",
    "a read-back that differs from the request throws sandbox_policy_mismatch, names the field and disposes the sandbox",
    "a symlink in the workspace that points outside it is denied for reads and writes",
    "a working directory outside the workspace is denied",
    "a write outside the write roots is denied",
    "the network is denied unless the host is on the allowlist",
  ]);
  for (const skip of report.skipped) assert.match(skip.reason, /does not claim to stop/);
  assert.ok(
    report.passed.includes("an abort and a timeout end the command's whole process tree, and exec settles"),
    "the process tree case ran against real processes",
  );
});

test("the network case reaches an allowed loopback host and fails a backend that reaches a blocked one", async () => {
  const servers: Server[] = [];
  const listen = () =>
    new Promise<number>((resolve) => {
      const server = createServer((socket) => socket.end()).listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve((server.address() as { port: number }).port);
      });
    });
  const [allowedPort, blockedPort] = [await listen(), await listen()];
  try {
    // A client claiming `exfiltration` whose exec connects to whatever it is told, so it enforces nothing.
    const none = noneSandbox({ unsafe: true, warn: () => {} });
    const lying = { tier: "os" as const, stops: ["exfiltration" as const], provision: none.provision.bind(none) };
    const probe = (host: string) => [
      process.execPath,
      "-e",
      `require("node:net").connect(Number(${JSON.stringify(host)}), "127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))`,
    ];
    const report = await runSandboxConformance(() => ({ client: lying, root: tempRoot() }), {
      network: { allowed: String(allowedPort), blocked: String(blockedPort), command: probe },
    });
    // It also has no read-back, which the two read-back cases catch on their own.
    assert.deepEqual(report.failed.map((failure) => failure.name).sort(), [
      "a backend that claims a stop reads back the policy it applied, which equals the request, and delivers its stops",
      "a read-back that differs from the request throws sandbox_policy_mismatch, names the field and disposes the sandbox",
      "the network is denied unless the host is on the allowlist",
    ]);
    const network = report.failed.find((failure) => failure.name.startsWith("the network"));
    assert.match(network?.error ?? "", /not allowed must not be reached/);
  } finally {
    for (const server of servers) server.close();
  }
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
      readBack: () => sandbox.readBack?.() ?? Promise.reject(new Error("the fake reads its policy back")),
      ...(sandbox.stops === undefined ? {} : { stops: sandbox.stops }),
    };
  };
  const report = await runSandboxConformance(() => ({ client: leaky, root: "/workspace" }));
  assert.deepEqual(
    report.failed.map((failure) => failure.name),
    ["exec's environment holds only the variables it was given, and no credential"],
  );
});
