import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { NONE_SANDBOX_WARNING, noneSandbox, SandboxUnavailableError, spawnEnv } from "@buildanagent/harness/sandbox";
import { afterAll, test } from "vitest";

const roots: string[] = [];
const POLICY = { readRoots: [], writeRoots: [], network: { allow: [], deny: [] } };

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-none-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("noneSandbox without unsafe: true fails to compile and throws at run time", () => {
  // @ts-expect-error `unsafe: true` is required, so an empty options object is a type error.
  const build = () => noneSandbox({});
  assert.throws(build, (error: unknown) => isHarnessError(error) && error.code === "unsafe_sandbox_not_acknowledged");
  // @ts-expect-error `unsafe` must be the literal `true`, not `false`.
  assert.throws(() => noneSandbox({ unsafe: false }), /unsafe: true/);
  // @ts-expect-error the options object itself is required.
  assert.throws(() => noneSandbox(), /unsafe: true/);
  assert.throws(() => noneSandbox({ unsafe: "yes" } as never), /unsafe: true/);
});

test("the none backend says it stops nothing, and warns each time a sandbox starts", async () => {
  const warnings: string[] = [];
  const client = noneSandbox({ unsafe: true, warn: (message) => warnings.push(message) });
  assert.deepEqual([client.tier, client.stops], ["none", []]);
  assert.deepEqual(warnings, [], "nothing is written until a sandbox starts");
  await client.provision({ root: workspace() }, POLICY);
  await client.provision({ root: workspace() }, POLICY);
  assert.deepEqual(warnings, [NONE_SANDBOX_WARNING, NONE_SANDBOX_WARNING]);
  assert.match(NONE_SANDBOX_WARNING, /confines nothing/);
});

test("provision writes the manifest's files, and refuses a root that is not an existing absolute folder", async () => {
  const client = noneSandbox({ unsafe: true, warn: () => {} });
  const root = workspace();
  const sandbox = await client.provision(
    { root, files: { "src/a.ts": "export {}", "b.bin": new Uint8Array([1, 2]) } },
    POLICY,
  );
  assert.equal(readFileSync(join(root, "src/a.ts"), "utf8"), "export {}");
  assert.deepEqual([...(await sandbox.readFile("b.bin"))], [1, 2]);
  for (const bad of ["relative/path", join(root, "missing")]) {
    await assert.rejects(
      client.provision({ root: bad }, POLICY),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_sandbox_options",
    );
  }
});

test("exec runs a real program with exactly the environment given, in the workspace, and with no shell", async () => {
  const client = noneSandbox({ unsafe: true, warn: () => {} });
  const root = workspace();
  mkdirSync(join(root, "sub"));
  const sandbox = await client.provision({ root }, POLICY);
  const env = spawnEnv([], { MARKER: "present" });
  const signal = new AbortController().signal;
  const where = await sandbox.exec([process.execPath, "-p", "process.cwd()"], { cwd: "sub", env, signal });
  assert.deepEqual(where, { exitCode: 0, stdout: `${join(root, "sub")}\n`, stderr: "" });
  const printed = await sandbox.exec(
    [process.execPath, "-p", "process.env.MARKER + '|' + process.env.ANTHROPIC_API_KEY"],
    { env, signal },
  );
  assert.ok(!("denied" in printed) && printed.stdout === "present|undefined\n");
  const shellLike = await sandbox.exec(["echo", "$HOME && touch injected"], { env, signal });
  assert.ok(
    !("denied" in shellLike) && shellLike.stdout === "$HOME && touch injected\n",
    "arguments are not interpreted by a shell",
  );
  const missing = await sandbox.exec(["no-such-program-anywhere"], { env, signal });
  assert.ok(!("denied" in missing) && missing.exitCode === 127 && /command not found/.test(missing.stderr));
  await assert.rejects(sandbox.exec([], { env, signal }), /non-empty list/);
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Starts a background process that holds the output pipes open, then waits for it, as `pnpm test` does with its workers.
const TREE = ["sh", "-c", "sleep 30 & echo $! > pid; wait"];

async function pidOf(root: string): Promise<number> {
  for (let tries = 0; tries < 100; tries += 1) {
    const text = existsSync(join(root, "pid")) ? readFileSync(join(root, "pid"), "utf8").trim() : "";
    if (text !== "") return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the command never wrote its pid");
}

async function waitDead(pid: number): Promise<void> {
  for (let tries = 0; tries < 100 && alive(pid); tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!alive(pid), `process ${pid} is still running`);
}

test("a timeout stops a command with 124, and an abort rejects with the signal's reason", async () => {
  const client = noneSandbox({ unsafe: true, warn: () => {} });
  const sandbox = await client.provision({ root: workspace() }, POLICY);
  const env = spawnEnv([]);
  const slow = await sandbox.exec(["sleep", "30"], { env, signal: new AbortController().signal, timeoutMs: 100 });
  assert.ok(!("denied" in slow) && slow.exitCode === 124 && /timed out/.test(slow.stderr));
  const controller = new AbortController();
  const running = sandbox.exec(["sleep", "30"], { env, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("cancelled")), 50);
  await assert.rejects(running, /cancelled/);
});

test("a timeout settles and kills the whole tree, though a background process holds the pipes", async () => {
  const root = workspace();
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root }, POLICY);
  const result = await sandbox.exec(TREE, { env: spawnEnv([]), signal: new AbortController().signal, timeoutMs: 500 });
  assert.ok(!("denied" in result) && result.exitCode === 124);
  await waitDead(await pidOf(root));
});

test("an abort kills the whole tree, and a dispose kills what is still running", async () => {
  const root = workspace();
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root }, POLICY);
  const controller = new AbortController();
  const aborted = sandbox.exec(TREE, { env: spawnEnv([]), signal: controller.signal });
  const first = await pidOf(root);
  controller.abort(new Error("cancelled"));
  await assert.rejects(aborted, /cancelled/);
  await waitDead(first);

  rmSync(join(root, "pid"), { force: true });
  const running = sandbox.exec(TREE, { env: spawnEnv([]), signal: new AbortController().signal });
  const second = await pidOf(root);
  await sandbox.dispose();
  await assert.rejects(running, (error: unknown) => isHarnessError(error) && error.code === "sandbox_disposed");
  await waitDead(second);
});

test("a command that a signal kills reports 128 plus the signal's number and names the signal", async () => {
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root: workspace() }, POLICY);
  const result = await sandbox.exec([process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"], {
    env: spawnEnv([]),
    signal: new AbortController().signal,
  });
  assert.ok(!("denied" in result));
  assert.deepEqual([result.exitCode, result.signal], [143, "SIGTERM"]);
});

test("output past the cap is dropped and marked truncated, and the command still finishes", async () => {
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root: workspace() }, POLICY);
  const result = await sandbox.exec([process.execPath, "-e", "process.stdout.write('x'.repeat(100000))"], {
    env: spawnEnv([]),
    signal: new AbortController().signal,
    maxOutputBytes: 1000,
  });
  assert.ok(!("denied" in result));
  assert.deepEqual([result.exitCode, result.stdout.length, result.truncated], [0, 1000, true]);
  const small = await sandbox.exec(["echo", "ok"], { env: spawnEnv([]), signal: new AbortController().signal });
  assert.ok(!("denied" in small) && small.truncated === undefined);
});

test("a working directory that doesn't exist is an error, not a command that can't be found", async () => {
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root: workspace() }, POLICY);
  await assert.rejects(
    sandbox.exec(["echo", "hi"], { cwd: "missing", env: spawnEnv([]), signal: new AbortController().signal }),
    (error: unknown) =>
      isHarnessError(error) && error.code === "invalid_sandbox_options" && /missing/.test(error.message),
  );
});

test("a sandbox that was disposed rejects every call but a second dispose", async () => {
  const sandbox = await noneSandbox({ unsafe: true, warn: () => {} }).provision({ root: workspace() }, POLICY);
  await sandbox.dispose();
  await sandbox.dispose();
  for (const call of [
    () => sandbox.readFile("a"),
    () => sandbox.writeFile("a", new Uint8Array()),
    () => sandbox.exec(["true"], { env: {}, signal: new AbortController().signal }),
  ]) {
    await assert.rejects(call(), (error: unknown) => isHarnessError(error) && error.code === "sandbox_disposed");
  }
});

test("SandboxUnavailableError names the backend and is a HarnessError", () => {
  const error = new SandboxUnavailableError("srt", "the binary is missing");
  assert.ok(isHarnessError(error) && error.code === "sandbox_unavailable");
  assert.equal(error.backend, "srt");
  assert.match(error.message, /the srt sandbox is unavailable: the binary is missing/);
});
