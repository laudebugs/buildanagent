import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmPolicy,
  noneSandbox,
  pauseSandbox,
  policyDifference,
  resumeSandbox,
  type Sandbox,
  type SandboxPolicy,
  SandboxPolicyMismatchError,
  snapshotSandbox,
  stopsFor,
} from "@buildanagent/harness/sandbox";
import { srtSandbox } from "@buildanagent/harness/sandbox/srt";
import { fakeSandbox, runSandboxConformance, sandboxConformanceCases } from "@buildanagent/harness/testing";
import { afterAll, test } from "vitest";
import { BackendSandbox } from "../../src/sandbox/base.js";
import { fakeRemoteSandbox } from "./fake-remote.js";

// The capabilities and the read-back that hosted backends need, proved on an in-memory stand-in for one. The local
// backends list no capability, so each of their calls is refused with a typed error.
const ROOT = "/workspace";
const policy: SandboxPolicy = {
  readRoots: [ROOT],
  writeRoots: [ROOT],
  network: { allow: ["allowed.test"], deny: [] },
};
const fakeNetwork = {
  allowed: "allowed.test",
  blocked: "blocked.test",
  command: (host: string) => ["net-probe", host],
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const codeOf = (error: unknown) => (error as { code?: string }).code;
const reject = (action: () => Promise<unknown>) =>
  action().then(
    () => undefined,
    (error: unknown) => error,
  );
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const remoteFactory = () => ({ client: fakeRemoteSandbox(), root: ROOT });

for (const conformance of sandboxConformanceCases(remoteFactory, { network: fakeNetwork })) {
  test(`the fake remote: ${conformance.name}`, async (context) => {
    const outcome = await conformance.run();
    if (outcome !== undefined) context.skip(outcome.skipped);
  });
}

test("the fake remote passes every case, and skips only the process tree and the symlink, which it has neither of", async () => {
  const report = await runSandboxConformance(remoteFactory, { network: fakeNetwork });
  assert.deepEqual(report.failed, []);
  assert.deepEqual(
    report.skipped.map((skip) => skip.name),
    [
      "an abort and a timeout end the command's whole process tree, and exec settles",
      "a symlink in the workspace that points outside it is denied for reads and writes",
    ],
  );
});

test("a remote with only some capabilities passes, and the ones it lacks are refused", async () => {
  const client = fakeRemoteSandbox({ capabilities: ["resume"] });
  const report = await runSandboxConformance(() => ({ client, root: ROOT }), { network: fakeNetwork });
  assert.deepEqual(report.failed, []);
  const sandbox = await client.provision({ root: ROOT }, policy);
  assert.equal(codeOf(await reject(() => snapshotSandbox(client, sandbox))), "sandbox_unsupported");
  const paused = await reject(() => pauseSandbox(client, sandbox));
  assert.equal(codeOf(paused), "sandbox_unsupported");
  assert.equal((paused as { capability?: string }).capability, "pause");
  await sandbox.dispose();
});

test("a capability that is listed but has no method is refused, and the suite fails it", async () => {
  const remote = fakeRemoteSandbox();
  const { resume: _resume, ...noResume } = remote;
  assert.equal(codeOf(await reject(() => resumeSandbox(noResume, "sbx-1", policy))), "sandbox_unsupported");
  const report = await runSandboxConformance(() => ({ client: noResume, root: ROOT }), { network: fakeNetwork });
  assert.deepEqual(
    report.failed.map((failure) => failure.name),
    [
      "a backend lists only known capabilities, each one it lists works, and one it doesn't is refused with sandbox_unsupported",
    ],
  );
});

test("the local backends list no capability, so resume, snapshot and pause are refused with a typed error", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-remote-"));
  folders.push(root);
  const none = noneSandbox({ unsafe: true, warn: () => {} });
  for (const client of [none, srtSandbox(), fakeSandbox()]) {
    assert.equal(client.capabilities, undefined);
    const resumed = await reject(() => resumeSandbox(client, "any", policy));
    assert.equal(codeOf(resumed), "sandbox_unsupported");
    assert.equal((resumed as Error).name, "SandboxUnsupportedError");
  }
  const sandbox = await none.provision({ root }, policy);
  try {
    assert.equal(codeOf(await reject(() => snapshotSandbox(none, sandbox))), "sandbox_unsupported");
    assert.equal(codeOf(await reject(() => pauseSandbox(none, sandbox))), "sandbox_unsupported");
  } finally {
    await sandbox.dispose();
  }
});

test("a provider that widens the policy fails provision with a mismatch that names the field and no host", async () => {
  const client = fakeRemoteSandbox({
    override: (requested) => ({
      ...requested,
      network: { allow: [...requested.network.allow, "evil.test"], deny: [] },
    }),
  });
  const error = await reject(() => client.provision({ root: ROOT }, policy));
  assert.equal(codeOf(error), "sandbox_policy_mismatch");
  assert.equal((error as Error).name, "SandboxPolicyMismatchError");
  assert.equal((error as SandboxPolicyMismatchError).field, "network.allow");
  assert.doesNotMatch((error as Error).message, /evil\.test|allowed\.test/);
  assert.deepEqual(client.held(), [], "the sandbox is disposed before the error is thrown");
});

test("each field a provider changes is the field the mismatch names, narrowing included", async () => {
  const changes: [string, (requested: SandboxPolicy) => SandboxPolicy][] = [
    ["readRoots", (requested) => ({ ...requested, readRoots: [...requested.readRoots, "/etc"] })],
    ["writeRoots", (requested) => ({ ...requested, writeRoots: [] })],
    ["network.deny", (requested) => ({ ...requested, network: { ...requested.network, deny: ["x.test"] } })],
  ];
  for (const [field, override] of changes) {
    const error = await reject(() => fakeRemoteSandbox({ override }).provision({ root: ROOT }, policy));
    assert.equal((error as SandboxPolicyMismatchError).field, field);
  }
  const fake = await reject(() =>
    fakeSandbox({ applied: (requested) => ({ ...requested, writeRoots: ["/"] }) }).provision({ root: ROOT }, policy),
  );
  assert.equal((fake as SandboxPolicyMismatchError).field, "writeRoots");
});

test("stops are computed from the applied policy: a microVM with open egress stops a hostile process, not exfiltration", async () => {
  const client = fakeRemoteSandbox({ stops: ["mistakes", "hostile_process"] });
  const open = await client.provision({ root: ROOT }, { ...policy, network: { allow: ["*"], deny: [] } });
  assert.deepEqual(open.stops, ["mistakes", "hostile_process"]);
  const closed = await client.provision({ root: ROOT }, policy);
  assert.deepEqual(closed.stops, ["mistakes", "exfiltration", "hostile_process"]);
  const claiming = fakeRemoteSandbox();
  const error = await reject(() =>
    claiming.provision({ root: ROOT }, { ...policy, network: { allow: ["*"], deny: [] } }),
  );
  assert.equal((error as SandboxPolicyMismatchError).field, "stops", "a claimed stop the policy can't deliver");
  await open.dispose();
  await closed.dispose();
});

test("stopsFor follows the tier and the policy", () => {
  assert.deepEqual(stopsFor("none", policy), []);
  assert.deepEqual(stopsFor("os", policy), ["mistakes", "exfiltration"]);
  assert.deepEqual(stopsFor("container", { ...policy, writeRoots: ["//"] }), ["exfiltration"]);
  assert.deepEqual(stopsFor("gvisor", { ...policy, network: { allow: ["0.0.0.0/0"], deny: [] } }), ["mistakes"]);
  assert.deepEqual(stopsFor("microvm", { ...policy, network: { allow: ["::/0"], deny: [] } }), [
    "mistakes",
    "hostile_process",
  ]);
});

test("policyDifference compares each field as a set, and a field that isn't a list of strings differs", () => {
  const reordered: SandboxPolicy = {
    readRoots: ["/b", "/a", "/a"],
    writeRoots: [],
    network: { allow: ["y", "x"], deny: [] },
  };
  assert.equal(
    policyDifference({ readRoots: ["/a", "/b"], writeRoots: [], network: { allow: ["x", "y"], deny: [] } }, reordered),
    undefined,
  );
  const broken = { readRoots: [ROOT], writeRoots: [ROOT], network: { allow: "allowed.test", deny: [] } };
  assert.equal(policyDifference(policy, broken as unknown as SandboxPolicy), "network.allow");
  assert.equal(policyDifference(policy, {} as SandboxPolicy), "readRoots");
});

test("a paused sandbox refuses calls until it is resumed, and the resume checks the policy again", async () => {
  const client = fakeRemoteSandbox();
  const sandbox = await client.provision({ root: ROOT }, policy);
  await sandbox.writeFile("a.txt", encoder.encode("kept"));
  await pauseSandbox(client, sandbox);
  assert.equal(codeOf(await reject(() => sandbox.readFile("a.txt"))), "invalid_sandbox_options");
  const wider = { ...policy, network: { allow: ["other.test"], deny: [] } };
  const mismatch = await reject(() => resumeSandbox(client, sandbox.id ?? "", wider));
  assert.equal((mismatch as SandboxPolicyMismatchError).field, "network.allow");
  assert.deepEqual(client.held(), [sandbox.id], "a resume that fails its check leaves the sandbox to the caller");
  const resumed = await resumeSandbox(client, sandbox.id ?? "", policy);
  assert.equal(decoder.decode(await resumed.readFile("a.txt")), "kept", "the kept sandbox resumes with its files");
  await resumed.dispose();
  assert.deepEqual(client.held(), []);
  const unknown = await reject(() => resumeSandbox(client, "sbx-404", policy));
  assert.equal(codeOf(unknown), "sandbox_not_found");
});

test("a snapshot resumes as a new sandbox with the files it had, under the provider's read-back", async () => {
  let widen = false;
  const client = fakeRemoteSandbox({
    override: (requested) => (widen ? { ...requested, readRoots: ["/"] } : requested),
  });
  const sandbox = await client.provision({ root: ROOT }, policy);
  await sandbox.writeFile("notes/a.txt", encoder.encode("before"));
  const id = await snapshotSandbox(client, sandbox);
  await sandbox.writeFile("notes/a.txt", encoder.encode("after"));
  const copy = await resumeSandbox(client, id, policy);
  assert.equal(decoder.decode(await copy.readFile("notes/a.txt")), "before");
  assert.notEqual(copy.id, sandbox.id);
  widen = true;
  const error = await reject(() => resumeSandbox(client, id, policy));
  assert.equal((error as SandboxPolicyMismatchError).field, "readRoots");
  await copy.dispose();
  await sandbox.dispose();
  assert.deepEqual(client.held(), []);
});

test("a client that claims a stop but whose sandbox has no read-back, or a failing one, is refused and disposed", async () => {
  for (const readBack of [undefined, () => Promise.reject(new Error("the provider did not answer"))]) {
    const inner = await fakeSandbox().provision({ root: ROOT }, policy);
    const sandbox = {
      exec: inner.exec.bind(inner),
      readFile: inner.readFile.bind(inner),
      writeFile: inner.writeFile.bind(inner),
      dispose: inner.dispose.bind(inner),
      ...(readBack === undefined ? {} : { readBack }),
    };
    const error = await reject(() => confirmPolicy(fakeRemoteSandbox(), sandbox, policy));
    assert.equal((error as SandboxPolicyMismatchError).field, "readBack");
    assert.equal(codeOf(await reject(() => inner.readFile("a.txt"))), "sandbox_disposed");
  }
  const none = noneSandbox({ unsafe: true, warn: () => {} });
  const inner = await fakeSandbox().provision({ root: ROOT }, policy);
  assert.deepEqual(await confirmPolicy(none, { ...inner, readBack: undefined } as never, policy), []);
  await inner.dispose();
});

test("resumeSandbox checks the read-back itself, even when the backend's resume doesn't", async () => {
  const inner = fakeSandbox({ applied: (requested) => requested });
  const careless = {
    tier: "microvm" as const,
    stops: ["mistakes" as const],
    capabilities: ["resume" as const],
    provision: inner.provision.bind(inner),
    // Reattaches without checking, to a sandbox whose provider has since opened every host.
    resume: async () => {
      const sandbox = await inner.provision({ root: ROOT }, policy);
      return Object.assign(Object.create(sandbox), {
        readBack: async () => ({ ...policy, network: { allow: ["*"], deny: [] } }),
        dispose: () => sandbox.dispose(),
      });
    },
  };
  const error = await reject(() => resumeSandbox(careless, "sbx-1", policy));
  assert.equal((error as SandboxPolicyMismatchError).field, "network.allow");
});

test("resumeSandbox leaves a mismatched sandbox undisposed, and sets a resumed sandbox's stops from its read-back", async () => {
  let disposed = 0;
  let applied: SandboxPolicy = { ...policy, network: { allow: ["other.test"], deny: [] } };
  const inner = await fakeSandbox().provision({ root: ROOT }, policy);
  const client = {
    tier: "microvm" as const,
    stops: ["mistakes" as const],
    capabilities: ["resume" as const],
    provision: () => Promise.reject(new Error("not used")),
    // Reattaches without checking or setting stops, as a thin hosted client might.
    resume: async () => ({
      exec: inner.exec.bind(inner),
      readFile: inner.readFile.bind(inner),
      writeFile: inner.writeFile.bind(inner),
      dispose: async () => {
        disposed += 1;
      },
      readBack: async () => applied,
    }),
  };
  const error = await reject(() => resumeSandbox(client, "sbx-1", policy));
  assert.equal((error as SandboxPolicyMismatchError).field, "network.allow");
  assert.equal(disposed, 0, "the caller decides whether to dispose it");
  applied = policy;
  const resumed = await resumeSandbox(client, "sbx-1", policy);
  assert.deepEqual(resumed.stops, ["mistakes", "exfiltration", "hostile_process"]);
  assert.equal(disposed, 0);
  await inner.dispose();
});

/** `inner`'s methods with another read-back, as a hosted provider's report would give. */
const withReadBack = (inner: Sandbox, readBack: () => Promise<SandboxPolicy>): Sandbox => ({
  exec: inner.exec.bind(inner),
  readFile: inner.readFile.bind(inner),
  writeFile: inner.writeFile.bind(inner),
  dispose: inner.dispose.bind(inner),
  readBack,
});

test("a provision whose read-back can't deliver a claimed stop is disposed, and the message names the cause", async () => {
  for (const [allow, readRoots, cause] of [
    [["*"], [ROOT], /allows all hosts, so the sandbox cannot stop exfiltration/],
    [["0.0.0.0/0"], [ROOT], /allows all hosts/],
    [["::/0"], [ROOT], /allows all hosts/],
    [["allowed.test"], ["/"], /whole disk, so the sandbox cannot stop mistakes/],
  ] as const) {
    const wide: SandboxPolicy = {
      readRoots: [...readRoots],
      writeRoots: [ROOT],
      network: { allow: [...allow], deny: [] },
    };
    const inner = await fakeSandbox({ stops: [] }).provision({ root: ROOT }, wide);
    const sandbox = withReadBack(inner, async () => wide);
    const error = (await reject(() =>
      confirmPolicy(fakeRemoteSandbox({ stops: ["mistakes", "exfiltration"] }), sandbox, wide),
    )) as SandboxPolicyMismatchError;
    assert.equal(error.field, "stops");
    assert.match(error.message, cause);
    assert.doesNotMatch(error.message, /0\.0\.0\.0|::\/0|\*|allowed\.test|\/workspace/, "no value is echoed");
    assert.equal(codeOf(await reject(() => inner.readFile("a.txt"))), "sandbox_disposed", "the sandbox is disposed");
  }
});

test("a read-back that throws a mismatch keeps its precise field, with the error as the cause", async () => {
  const inner = await fakeSandbox().provision({ root: ROOT }, policy);
  const precise = new SandboxPolicyMismatchError("writeRoots");
  const sandbox = withReadBack(inner, () => Promise.reject(precise));
  const error = (await reject(() => confirmPolicy(fakeRemoteSandbox(), sandbox, policy))) as SandboxPolicyMismatchError;
  assert.equal(error.field, "writeRoots");
  assert.equal(error.cause, precise);
  const plain = await fakeSandbox().provision({ root: ROOT }, policy);
  const failing = withReadBack(plain, () => Promise.reject(new Error("down")));
  assert.equal(
    ((await reject(() => confirmPolicy(fakeRemoteSandbox(), failing, policy))) as SandboxPolicyMismatchError).field,
    "readBack",
  );
});

test("a resumed backend sandbox's stops follow a later confirm, because resumeSandbox doesn't shadow its getter", async () => {
  class Resumable extends BackendSandbox {
    applies: SandboxPolicy;
    constructor(applies: SandboxPolicy) {
      super({} as never);
      this.applies = applies;
    }
    exec(): never {
      throw new Error("not used");
    }
    readBack(): Promise<SandboxPolicy> {
      return Promise.resolve(this.applies);
    }
    protected shutDown(): Promise<void> {
      return Promise.resolve();
    }
  }
  const open: SandboxPolicy = { ...policy, network: { allow: ["*"], deny: [] } };
  const sandbox = new Resumable(open);
  const client = {
    tier: "microvm" as const,
    stops: ["mistakes" as const],
    capabilities: ["resume" as const],
    provision: () => Promise.reject(new Error("not used")),
    resume: async () => sandbox,
  };
  const resumed = await resumeSandbox(client, "sbx-1", open);
  assert.equal(resumed, sandbox);
  assert.deepEqual(sandbox.stops, ["mistakes", "hostile_process"], "the resume's stops");
  assert.equal(Object.hasOwn(sandbox, "stops"), false, "no own property shadows the getter");
  sandbox.applies = policy;
  await sandbox.confirm(client, policy);
  assert.deepEqual(sandbox.stops, ["mistakes", "exfiltration", "hostile_process"], "a later confirm's stops");
});
