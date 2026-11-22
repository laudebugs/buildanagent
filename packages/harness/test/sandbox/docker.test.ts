import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxPolicy } from "@buildanagent/harness/sandbox";
import {
  DOCKER_PROXY_SOCKET_PATH,
  type DockerSandboxOptions,
  dockerSandbox,
} from "@buildanagent/harness/sandbox/docker";
import { runSandboxConformance, type SandboxFactory, sandboxConformanceCases } from "@buildanagent/harness/testing";
import { afterAll, beforeAll, describe, test } from "vitest";

// The real Docker backend against the conformance suite and its own lock-down cases. It starts containers, so it is
// opt-in like the srt backend: `pnpm --filter @buildanagent/harness test:sandbox` sets HARNESS_TEST_SANDBOX=1, which
// makes a case that can't run a failure, never a skip. It needs a running Docker daemon and the pinned image on it.
const enabled = process.env.HARNESS_TEST_SANDBOX === "1";
const suite = describe.skipIf(!enabled);

// Node's Alpine image, pinned by digest: it has Node for the proxy probe and BusyBox for everything else (2026-11-22).
const IMAGE = "mirror.gcr.io/library/node@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a";

const folders: string[] = [];
function tempFolder(label: string): string {
  const made = mkdtempSync(join(tmpdir(), `harness-docker-${label}-`));
  folders.push(made);
  return made;
}

const TREE_MARKER = `32.${randomInt(1000, 9999)}`;
const never = () => new AbortController().signal;
/** The ids of every container a harness sandbox made, so a test can look at the ones it made itself. */
const labelled = (): Set<string> =>
  new Set(
    execFileSync("docker", ["ps", "--all", "--quiet", "--filter", "label=harness.sandbox"], { encoding: "utf8" })
      .split("\n")
      .filter((id) => id !== ""),
  );
const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether a host process is running `sleep` with the marker: a container's processes show in the host's `/proc`. */
function markerAlive(): boolean {
  return readdirSync("/proc").some((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      return readFileSync(`/proc/${entry}/cmdline`, "utf8") === `sleep\0${TREE_MARKER}\0`;
    } catch {
      return false;
    }
  });
}

// A stand-in for the credential proxy of N20: a Unix socket that answers 200 for an allowed host and 403 for the rest.
const seen: string[] = [];
let proxy: Server;
let proxySocket = "";

beforeAll(async () => {
  if (!enabled) return;
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
  } catch {
    execFileSync("docker", ["pull", IMAGE], { stdio: "inherit" });
  }
  proxySocket = join(tempFolder("proxy"), "proxy.sock");
  proxy = createServer((request, response) => {
    seen.push(request.url ?? "");
    const allowed = (request.url ?? "").startsWith("http://allowed.test/");
    response.statusCode = allowed ? 200 : 403;
    response.end(allowed ? "ok" : "blocked");
  });
  await new Promise<void>((resolve) => proxy.listen(proxySocket, resolve));
});
afterAll(() => {
  proxy?.close();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

// Without a proxy socket the container reaches no host, and its read-back says so, so a policy that allows one would
// be refused as a mismatch. A sandbox with no socket therefore asks for no host.
const policyFor = (root: string, allow: readonly string[] = []): SandboxPolicy => ({
  readRoots: [root],
  writeRoots: [root],
  network: { allow, deny: [] },
});
const client = (extra: Partial<DockerSandboxOptions> = {}) =>
  dockerSandbox({ image: IMAGE, cpus: 1, memoryMb: 256, ...extra });
const withProxy = () => client({ proxySocket });

const factory: SandboxFactory = () => {
  const root = tempFolder("ws");
  mkdirSync(`${root}-outside`);
  folders.push(`${root}-outside`);
  return { client: withProxy(), root, symlink: (link, target) => symlinkSync(target, link) };
};

// Succeeds only when the host is reached and answers 200: through the proxy socket, the container's only way out.
const reach = (host: string) => [
  "node",
  "-e",
  `require("node:http").request({ socketPath: ${JSON.stringify(DOCKER_PROXY_SOCKET_PATH)}, path: "http://" + process.argv[1] + "/", headers: { host: process.argv[1] } }, (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on("error", () => process.exit(1)).end()`,
  host,
];
const options = {
  network: { allowed: "allowed.test", blocked: "blocked.test", command: reach },
  processTree: {
    command: ["sh", "-c", `sleep ${TREE_MARKER} & echo $! > pid; wait`],
    // The pid the command writes is in the container's own namespace, so the host looks for the marker instead.
    isAlive: () => markerAlive(),
  },
};

suite("docker: the conformance suite", () => {
  for (const conformance of sandboxConformanceCases(factory, options)) {
    test(conformance.name, async () => {
      const outcome = await conformance.run();
      assert.equal(outcome, undefined, `the case must run for real, not skip: ${JSON.stringify(outcome)}`);
    }, 120_000);
  }

  test("every case passes and none skips", async () => {
    const report = await runSandboxConformance(factory, options);
    assert.deepEqual(report.failed, []);
    assert.deepEqual(report.skipped, []);
    assert.ok(report.passed.length >= 15, "the suite ran its cases");
  }, 600_000);
});

suite("docker: what a command can't do", () => {
  async function provisioned(extra: Partial<DockerSandboxOptions> = {}) {
    const root = tempFolder("ws");
    const outside = `${root}-outside`;
    mkdirSync(outside);
    folders.push(outside);
    writeFileSync(join(outside, "secret.txt"), "the outside secret");
    const sandbox = await client(extra).provision({ root }, policyFor(root));
    return { sandbox, root, outside };
  }
  const run = (sandbox: Sandbox, script: string) =>
    sandbox.exec(["sh", "-c", script], { env: {}, signal: never(), timeoutMs: 60_000 });
  const outcome = (result: Awaited<ReturnType<typeof run>>) => ("exitCode" in result ? result : undefined);

  test("a command holds no capability, can't gain privileges and has no network device but loopback", async () => {
    const { sandbox } = await provisioned();
    try {
      const status = outcome(await run(sandbox, "grep -E 'CapEff|NoNewPrivs' /proc/self/status; cat /proc/net/dev"));
      assert.match(status?.stdout ?? "", /CapEff:\s+0000000000000000/);
      assert.match(status?.stdout ?? "", /NoNewPrivs:\s+1/);
      const devices = (status?.stdout ?? "").split("\n").filter((line) => line.includes(":") && !line.includes("Cap"));
      assert.ok(!devices.some((line) => /eth0|docker0/.test(line)), "no network device but loopback");
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("the root file system is read-only, and only the write roots and /tmp are writable", async () => {
    const { sandbox, root, outside } = await provisioned();
    try {
      const rootfs = outcome(await run(sandbox, "touch /etc/x"));
      const sibling = outcome(await run(sandbox, `touch ${outside}/x`));
      const inRoot = outcome(await run(sandbox, "touch made.txt && touch /tmp/made.txt"));
      assert.notEqual(rootfs?.exitCode, 0);
      assert.notEqual(sibling?.exitCode, 0);
      assert.equal(inRoot?.exitCode, 0);
      assert.ok(existsSync(join(root, "made.txt")));
      assert.equal(existsSync(join(outside, "x")), false);
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a path outside the roots is not mounted, so a command can't read it", async () => {
    const { sandbox, outside } = await provisioned();
    try {
      const read = outcome(await run(sandbox, `cat ${outside}/secret.txt`));
      assert.notEqual(read?.exitCode, 0);
      assert.ok(!read?.stdout.includes("the outside secret"));
      assert.equal(
        outcome(await run(sandbox, "ls /home /root 2>&1 | head -5; ls /var/run/docker.sock 2>&1"))?.stdout.includes(
          "docker.sock\n",
        ),
        false,
      );
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("without a proxy socket the network is closed to every host, and with one only the proxy answers", async () => {
    const { sandbox } = await provisioned();
    const [plain, , proxied] = [
      sandbox,
      undefined,
      await (async () => {
        const root = tempFolder("ws");
        return withProxy().provision({ root }, policyFor(root, ["allowed.test"]));
      })(),
    ];
    const before = seen.length;
    try {
      const closed = outcome(await plain.exec(reach("allowed.test"), { env: {}, signal: never(), timeoutMs: 60_000 }));
      assert.notEqual(closed?.exitCode, 0, "no socket is mounted, so even the allowed host can't be reached");
      const direct = outcome(await run(plain, "wget -T 3 -q -O- http://1.1.1.1/ 2>&1"));
      assert.notEqual(direct?.exitCode, 0, "there is no route out");
      const allowed = outcome(
        await proxied.exec(reach("allowed.test"), { env: {}, signal: never(), timeoutMs: 60_000 }),
      );
      const blocked = outcome(
        await proxied.exec(reach("blocked.test"), { env: {}, signal: never(), timeoutMs: 60_000 }),
      );
      assert.equal(allowed?.exitCode, 0);
      assert.notEqual(blocked?.exitCode, 0);
      assert.ok(
        seen.slice(before).some((url) => url.includes("allowed.test")),
        "the allowed host went through the proxy",
      );
    } finally {
      await plain.dispose();
      await proxied.dispose();
    }
  }, 180_000);

  test("the daemon applies every lock-down setting to the container it runs", async () => {
    const { sandbox } = await provisioned({ cpus: 1.5, memoryMb: 192, pidsLimit: 33 });
    const before = labelled();
    try {
      const running = sandbox.exec(["sleep", "30"], { env: {}, signal: never(), timeoutMs: 20_000 });
      let id = "";
      for (let tries = 0; tries < 100 && id === ""; tries += 1) {
        id = [...labelled()].find((candidate) => !before.has(candidate)) ?? "";
        if (id === "") await settle(100);
      }
      assert.notEqual(id, "", "the container was running");
      const host = JSON.parse(
        execFileSync("docker", ["inspect", "--format", "{{json .HostConfig}}", id], { encoding: "utf8" }),
      );
      assert.equal(host.NetworkMode, "none", "no network");
      assert.deepEqual(host.CapDrop, ["ALL"]);
      assert.equal(host.ReadonlyRootfs, true);
      assert.equal(host.Privileged, false);
      assert.ok(host.SecurityOpt.includes("no-new-privileges"));
      assert.equal(host.PidsLimit, 33);
      assert.equal(host.NanoCpus, 1_500_000_000);
      assert.equal(host.Memory, 192 * 1024 * 1024);
      assert.equal(host.MemorySwap, 192 * 1024 * 1024, "no swap");
      assert.equal(host.IpcMode, "none");
      assert.deepEqual(host.CapAdd ?? [], []);
      const mounts = JSON.parse(
        execFileSync("docker", ["inspect", "--format", "{{json .Mounts}}", id], { encoding: "utf8" }),
      );
      assert.ok(
        mounts.every((mount: { Source: string }) => !mount.Source.includes("docker.sock")),
        "no Docker socket",
      );
      await sandbox.dispose();
      await running.catch(() => undefined);
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a timeout that arrives while the container is still being created settles the call, and nothing is left", async () => {
    const { sandbox } = await provisioned();
    const before = labelled();
    const started = Date.now();
    const result = outcome(await sandbox.exec(["sleep", "30"], { env: {}, signal: never(), timeoutMs: 1 }));
    assert.equal(result?.exitCode, 124);
    assert.ok(Date.now() - started < 10_000, "the call did not wait for the creation");
    const controller = new AbortController();
    const aborted = sandbox
      .exec(["sleep", "30"], { env: {}, signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort(new Error("stop"));
    assert.equal(((await aborted) as Error).message, "stop");
    await sandbox.dispose();
    assert.deepEqual(
      [...labelled()].filter((id) => !before.has(id)),
      [],
      "the containers still being created are removed",
    );
  }, 120_000);

  test("a denyWrite folder that did not exist is made, mounted read-only and refused by writeFile", async () => {
    const root = tempFolder("ws");
    const log = join(root, "later-log");
    const sandbox = await client({ denyWrite: [log] }).provision({ root }, policyFor(root));
    try {
      assert.ok(existsSync(log), "the folder was made at provision");
      const blocked = outcome(await run(sandbox, "echo x > later-log/session.jsonl"));
      assert.notEqual(blocked?.exitCode, 0);
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a command can't start more processes than the limit", async () => {
    const { sandbox } = await provisioned({ pidsLimit: 20 });
    try {
      const result = outcome(
        await run(sandbox, "n=0; for i in $(seq 1 60); do sleep 5 & n=$((n+1)); done 2>&1; wait; echo started"),
      );
      assert.match(`${result?.stdout}${result?.stderr}`, /Resource temporarily unavailable|can't fork|Cannot fork/i);
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a command that uses more memory than the limit is killed", async () => {
    const { sandbox } = await provisioned({ memoryMb: 64 });
    try {
      const result = outcome(
        await sandbox.exec(["node", "-e", "const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1))"], {
          env: {},
          signal: never(),
          timeoutMs: 60_000,
        }),
      );
      assert.equal(result?.exitCode, 137, "the kernel's out-of-memory kill is exit code 137");
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a denyWrite folder is mounted read-only, and writeFile refuses it too", async () => {
    const root = tempFolder("ws");
    const log = join(root, "log");
    mkdirSync(log);
    writeFileSync(join(log, "session.jsonl"), "kept");
    const sandbox = await client({ denyWrite: [log] }).provision({ root }, policyFor(root));
    try {
      const blocked = outcome(await run(sandbox, "echo x > log/session.jsonl"));
      const allowed = outcome(await run(sandbox, "echo x > notes.txt"));
      assert.notEqual(blocked?.exitCode, 0);
      assert.equal(allowed?.exitCode, 0);
      const error = await sandbox.writeFile("log/new.jsonl", new Uint8Array([1])).catch((caught: unknown) => caught);
      assert.equal((error as { code?: string }).code, "sandbox_denied");
      assert.equal(readFileSync(join(log, "session.jsonl"), "utf8"), "kept");
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("a command's environment is exactly the one it was given, with no image variable", async () => {
    const { sandbox } = await provisioned();
    try {
      const result = outcome(await sandbox.exec(["env"], { env: { ALPHA: "1" }, signal: never() }));
      assert.equal(result?.stdout.trim(), "ALPHA=1");
      const dashed = outcome(await sandbox.exec(["-x"], { env: {}, signal: never() }));
      assert.equal(dashed?.exitCode, 127);
      const assignment = outcome(await sandbox.exec(["FOO=1", "env"], { env: {}, signal: never() }));
      assert.equal(assignment?.exitCode, 127);
    } finally {
      await sandbox.dispose();
    }
  }, 120_000);

  test("an abort or a dispose removes the container as well as stopping the client", async () => {
    const { sandbox } = await provisioned();
    const before = labelled();
    const controller = new AbortController();
    const running = sandbox
      .exec(["sh", "-c", `sleep ${TREE_MARKER} & wait`], { env: {}, signal: controller.signal })
      .catch((error: unknown) => error);
    for (let tries = 0; tries < 200 && !markerAlive(); tries += 1) await settle(50);
    assert.ok(markerAlive(), "the process was running in the container");
    controller.abort(new Error("stop"));
    await running;
    for (let tries = 0; tries < 100 && markerAlive(); tries += 1) await settle(50);
    assert.equal(markerAlive(), false, "the process died with its container");
    const second = sandbox.exec(["sleep", "30"], { env: {}, signal: never() }).catch((error: unknown) => error);
    await settle(1500);
    await sandbox.dispose();
    await second;
    assert.deepEqual(
      [...labelled()].filter((id) => !before.has(id)),
      [],
      "no container is left behind",
    );
  }, 180_000);
});

if (!enabled) {
  test.skip("docker: the real backend runs only with HARNESS_TEST_SANDBOX=1 (pnpm test:sandbox)", () => {});
}
