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
import { confirmPolicy, type Sandbox, type SandboxPolicy } from "@buildanagent/harness/sandbox";
import { SRT_ADDED_ENVIRONMENT, srtSandbox } from "@buildanagent/harness/sandbox/srt";
import { runSandboxConformance, type SandboxFactory, sandboxConformanceCases } from "@buildanagent/harness/testing";
import { afterAll, beforeAll, describe, test } from "vitest";

// The real `srt` backend against the conformance suite and its own escape cases. It starts bubblewrap, so it is
// opt-in: `pnpm --filter @buildanagent/harness test:sandbox` sets HARNESS_TEST_SANDBOX=1, which makes a case that
// can't run a failure, never a skip. Without the variable the whole file is skipped and says why.
const enabled = process.env.HARNESS_TEST_SANDBOX === "1";
const suite = describe.skipIf(!enabled);

const folders: string[] = [];
function tempFolder(label: string): string {
  const made = mkdtempSync(join(tmpdir(), `harness-srt-${label}-`));
  folders.push(made);
  return made;
}

const TREE_MARKER = `31.${randomInt(1000, 9999)}`;
const never = () => new AbortController().signal;
const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether a host process is running `sleep` with the marker, which is how the tree's survivors are found. */
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

// What the fake upstream proxy saw: it stands in for the internet, which srt's proxy forwards allowed hosts to.
const seen: string[] = [];
let upstream: Server;
let upstreamPort = 0;

beforeAll(async () => {
  if (!enabled) return;
  upstream = createServer((request, response) => {
    seen.push(request.url ?? "");
    response.end("ok");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = (upstream.address() as { port: number }).port;
});
afterAll(() => {
  upstream?.close();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const policyFor = (root: string): SandboxPolicy => ({
  readRoots: [root],
  writeRoots: [root],
  network: { allow: ["allowed.test"], deny: [] },
});
const client = (denyWrite: string[] = []) =>
  srtSandbox({ parentProxy: { http: `http://127.0.0.1:${upstreamPort}` }, denyWrite });

const factory: SandboxFactory = () => {
  const root = tempFolder("ws");
  mkdirSync(`${root}-outside`);
  folders.push(`${root}-outside`);
  return { client: client(), root, symlink: (link, target) => symlinkSync(target, link) };
};

// Succeeds only when the host is reached and answers 200. srt's proxy answers 403 for a host that isn't allowed.
const reach = (host: string) => [
  "sh",
  "-c",
  'test "$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "http://$1/")" = 200',
  "probe",
  host,
];
const options = {
  network: { allowed: "allowed.test", blocked: "blocked.test", command: reach },
  processTree: {
    command: ["sh", "-c", `sleep ${TREE_MARKER} & echo $! > pid; wait`],
    // The pid the command writes is in the sandbox's own namespace, so the host looks for the marker instead.
    isAlive: () => markerAlive(),
  },
  addedEnvironment: SRT_ADDED_ENVIRONMENT,
};

suite("srt: the conformance suite", () => {
  for (const conformance of sandboxConformanceCases(factory, options)) {
    test(conformance.name, async () => {
      const outcome = await conformance.run();
      assert.equal(outcome, undefined, `the case must run for real, not skip: ${JSON.stringify(outcome)}`);
    }, 60_000);
  }

  test("every case passes and none skips", async () => {
    const report = await runSandboxConformance(factory, options);
    assert.deepEqual(report.failed, []);
    assert.deepEqual(report.skipped, []);
    assert.ok(report.passed.length >= 15, "the suite ran its cases");
  }, 300_000);
});

suite("srt: what a command can't do", () => {
  async function provisioned(denyWrite: string[] = []): Promise<{ sandbox: Sandbox; root: string; outside: string }> {
    const root = tempFolder("ws");
    const outside = `${root}-outside`;
    mkdirSync(outside);
    folders.push(outside);
    writeFileSync(join(outside, "secret.txt"), "the outside secret");
    const sandbox = await client(denyWrite).provision({ root }, policyFor(root));
    return { sandbox, root, outside };
  }
  const run = (sandbox: Sandbox, script: string) =>
    sandbox.exec(["sh", "-c", script], { env: {}, signal: never(), timeoutMs: 20_000 });
  const outcome = (result: Awaited<ReturnType<typeof run>>) => ("exitCode" in result ? result : undefined);

  test("it can't write outside the write roots, by .. or by an absolute path", async () => {
    const { sandbox, root, outside } = await provisioned();
    try {
      const climb = outcome(
        await run(sandbox, `echo x > ../${root.slice(root.lastIndexOf("/") + 1)}-outside/climbed.txt`),
      );
      const absolute = outcome(await run(sandbox, `echo x > ${outside}/absolute.txt`));
      assert.notEqual(climb?.exitCode, 0);
      assert.notEqual(absolute?.exitCode, 0);
      assert.equal(existsSync(join(outside, "climbed.txt")), false);
      assert.equal(existsSync(join(outside, "absolute.txt")), false);
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("it can't read outside the read roots, by an absolute path or through a symlink", async () => {
    const { sandbox, root, outside } = await provisioned();
    try {
      symlinkSync(outside, join(root, "link"));
      const direct = outcome(await run(sandbox, `cat ${outside}/secret.txt`));
      const linked = outcome(await run(sandbox, "cat link/secret.txt"));
      assert.notEqual(direct?.exitCode, 0);
      assert.notEqual(linked?.exitCode, 0);
      assert.ok(!direct?.stdout.includes("the outside secret"));
      assert.ok(!linked?.stdout.includes("the outside secret"));
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a symlink that the command makes can't carry a write out of the workspace", async () => {
    const { sandbox, outside } = await provisioned();
    try {
      const result = outcome(await run(sandbox, `ln -s ${outside} link && echo x > link/made.txt`));
      assert.notEqual(result?.exitCode, 0);
      assert.equal(existsSync(join(outside, "made.txt")), false);
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("it can't read the host's home or its credentials", async () => {
    const { sandbox } = await provisioned();
    try {
      const result = outcome(await run(sandbox, "ls /root /home 2>&1; cat /proc/1/environ 2>&1"));
      assert.ok(!/\.ssh|\.aws|\.npmrc/.test(result?.stdout ?? ""), "no credential folder is visible");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("the read-back reads the settings file on disk, so a file widened after provision is caught", async () => {
    const before = new Set(readdirSync(tmpdir()));
    const { sandbox, root } = await provisioned();
    const made = readdirSync(tmpdir()).filter((name) => !before.has(name) && /^harness-srt-[A-Za-z0-9]{6}$/.test(name));
    assert.equal(made.length, 1, "provisioning made one private folder");
    const file = join(tmpdir(), made[0] ?? "", "settings.json");
    try {
      assert.deepEqual(await sandbox.readBack?.(), policyFor(root), "the file as written reads back as the request");
      assert.deepEqual(sandbox.stops, ["mistakes", "exfiltration"]);
      const settings = JSON.parse(readFileSync(file, "utf8"));
      settings.network.allowedDomains.push("evil.test");
      writeFileSync(file, JSON.stringify(settings));
      assert.deepEqual((await sandbox.readBack?.())?.network.allow, ["allowed.test", "evil.test"]);
      const error = await confirmPolicy(client(), sandbox, policyFor(root)).catch((caught: unknown) => caught);
      assert.equal((error as { field?: string }).field, "network.allow");
      assert.doesNotMatch((error as Error).message, /evil\.test/);
      assert.equal(existsSync(file), false, "the mismatch disposed the sandbox and removed its folder");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a folder the policy keeps read-only stays read-only inside a write root", async () => {
    const root = tempFolder("ws");
    const log = join(root, "log");
    mkdirSync(log);
    const sandbox = await client([log]).provision({ root }, policyFor(root));
    try {
      const blocked = outcome(await run(sandbox, "echo x > log/session.jsonl"));
      const allowed = outcome(await run(sandbox, "echo x > notes.txt"));
      assert.notEqual(blocked?.exitCode, 0);
      assert.equal(allowed?.exitCode, 0);
      assert.equal(existsSync(join(log, "session.jsonl")), false);
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("writeFile keeps a denyWrite folder and srt's protected files read-only, and reads them", async () => {
    const root = tempFolder("ws");
    const log = join(root, "log");
    mkdirSync(log);
    writeFileSync(join(log, "session.jsonl"), "kept");
    const sandbox = await client([log]).provision({ root }, policyFor(root));
    try {
      for (const path of [
        "log/session.jsonl",
        "log/new.jsonl",
        ".bashrc",
        ".git/hooks/pre-commit",
        ".claude/settings.json",
      ]) {
        const error = await sandbox.writeFile(path, new Uint8Array([1])).catch((caught: unknown) => caught);
        assert.equal((error as { code?: string }).code, "sandbox_denied", `${path} must be refused`);
      }
      assert.equal(readFileSync(join(log, "session.jsonl"), "utf8"), "kept");
      assert.equal(new TextDecoder().decode(await sandbox.readFile("log/session.jsonl")), "kept");
      await sandbox.writeFile("..env.example", new Uint8Array([1]));
      await sandbox.writeFile("notes/ok.txt", new Uint8Array([1]));
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a file call that fails for another reason is a sandbox_io_failed error", async () => {
    const { sandbox } = await provisioned();
    try {
      await sandbox.writeFile("dir/file.txt", new Uint8Array([1]));
      const folder = await sandbox.readFile("dir").catch((caught: unknown) => caught);
      const beneath = await sandbox
        .writeFile("dir/file.txt/under", new Uint8Array([1]))
        .catch((caught: unknown) => caught);
      assert.equal((folder as { code?: string }).code, "sandbox_io_failed");
      assert.equal((beneath as { code?: string }).code, "sandbox_io_failed");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a pipe the agent made is refused at once, and not read", async () => {
    const { sandbox, root } = await provisioned();
    try {
      execFileSync("mkfifo", [join(root, "pipe")]);
      const started = Date.now();
      const error = await sandbox.readFile("pipe").catch((caught: unknown) => caught);
      assert.equal((error as { code?: string }).code, "sandbox_io_failed");
      assert.ok(Date.now() - started < 5000, "the call must not wait for a writer");
      const written = await sandbox.writeFile("pipe", new Uint8Array([1])).catch((caught: unknown) => caught);
      assert.equal((written as { code?: string }).code, "sandbox_io_failed");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a command that starts with = or - is a program name, and a loader variable runs only inside", async () => {
    const { sandbox, root } = await provisioned();
    try {
      const assignment = outcome(await sandbox.exec(["FOO=1", "printenv"], { env: {}, signal: never() }));
      assert.equal(assignment?.exitCode, 127, "FOO=1 is a program that does not exist, as under none");
      assert.match(assignment?.stderr ?? "", /not found/);
      const dashed = outcome(await sandbox.exec(["-x"], { env: {}, signal: never() }));
      assert.equal(dashed?.exitCode, 127);
      // A loader variable in the command's environment must not run code outside the sandbox: the evil file would
      // write a marker into the workspace from the host's own Node, where the sandbox could not have reached.
      const marker = join(tempFolder("marker"), "ran");
      writeFileSync(join(root, "evil.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`);
      await sandbox.exec(["true"], { env: { NODE_OPTIONS: "--require ./evil.cjs" }, signal: never() });
      assert.equal(existsSync(marker), false, "NODE_OPTIONS did not run code in srt's own Node");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("a command can't read srt's settings file", async () => {
    const { sandbox } = await provisioned();
    try {
      const found = outcome(await run(sandbox, "find / -name settings.json -path '*harness-srt-*' 2>/dev/null"));
      assert.equal(found?.stdout.trim(), "");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("it can't reach the host's network except through the proxy, which allows only the policy's hosts", async () => {
    const { sandbox } = await provisioned();
    const before = seen.length;
    try {
      const direct = outcome(
        await run(sandbox, `curl -s --noproxy '*' --max-time 5 http://127.0.0.1:${upstreamPort}/direct`),
      );
      const allowed = outcome(await run(sandbox, "curl -s --max-time 8 http://allowed.test/ok"));
      const blocked = outcome(await run(sandbox, "curl -s --max-time 8 http://blocked.test/no"));
      assert.notEqual(direct?.exitCode, 0, "a direct connection to the host's loopback must fail");
      assert.equal(allowed?.exitCode, 0);
      assert.equal(blocked?.stdout.includes("ok"), false);
      const reached = seen.slice(before);
      assert.ok(
        reached.some((url) => url.includes("allowed.test")),
        "the allowed host went through",
      );
      assert.ok(!reached.some((url) => url.includes("blocked.test") || url.includes("/direct")), "nothing else did");
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("an abort ends a running command and everything it started", async () => {
    const { sandbox, root } = await provisioned();
    try {
      const controller = new AbortController();
      const running = sandbox
        .exec(["sh", "-c", `sleep ${TREE_MARKER} & wait`], { env: {}, signal: controller.signal })
        .catch((error: unknown) => error);
      for (let tries = 0; tries < 100 && !markerAlive(); tries += 1) await settle(50);
      assert.ok(markerAlive(), "the background process was running before the abort");
      controller.abort(new Error("stop"));
      await running;
      for (let tries = 0; tries < 100 && markerAlive(); tries += 1) await settle(50);
      assert.equal(markerAlive(), false, "the background process was killed with its group");
      // srt's own cleanup ran: the empty protected files it makes in the workspace are gone.
      assert.deepEqual(
        readdirSync(root).filter((name) => name.startsWith(".")),
        [],
        "srt left its protected files behind",
      );
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);

  test("files written with writeFile and read back keep every byte", async () => {
    const { sandbox } = await provisioned();
    try {
      const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
      await sandbox.writeFile("bin/all-bytes", bytes);
      assert.deepEqual([...(await sandbox.readFile("bin/all-bytes"))], [...bytes]);
    } finally {
      await sandbox.dispose();
    }
  }, 60_000);
});

if (!enabled) {
  test.skip("srt: the real sandbox runs only with HARNESS_TEST_SANDBOX=1 (pnpm test:sandbox)", () => {});
}
