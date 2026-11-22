import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { SandboxUnavailableError, spawnEnv } from "@buildanagent/harness/sandbox";
import { srtSandbox } from "@buildanagent/harness/sandbox/srt";
import { afterAll, afterEach, beforeAll, test, vi } from "vitest";

// These tests start no real sandbox: a missing program, a fake `srt` that records how it was started, and fake `bwrap`
// and `socat` that make the host check pass. The real `srt` runs in srt.test.ts, which is opt-in.
const folders: string[] = [];
function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "harness-srt-test-"));
  folders.push(made);
  return made;
}
const policy = (root: string) => ({
  readRoots: [root],
  writeRoots: [root],
  network: { allow: [], deny: [] },
});
const privateFolders = () =>
  readdirSync(tmpdir()).filter((name) => name.startsWith("harness-srt-") && !name.startsWith("harness-srt-test-"));

let fakePrograms: string;
beforeAll(() => {
  fakePrograms = folder();
  for (const name of ["bwrap", "socat"]) {
    writeFileSync(join(fakePrograms, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(fakePrograms, name), 0o755);
  }
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

const linux = process.platform === "linux";

test("a binary that is not an executable file makes provisioning throw SandboxUnavailableError, and nothing runs", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  const before = privateFolders();
  const error = await srtSandbox({ binary: join(root, "no-such-srt") })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof SandboxUnavailableError);
  assert.equal(error.backend, "srt");
  assert.match(error.message, /is not an executable file/);
  assert.deepEqual(privateFolders(), before, "no private folder was left behind");
});

test("a host without bwrap or socat makes provisioning throw SandboxUnavailableError", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", folder());
  const root = folder();
  const error = await srtSandbox()
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof SandboxUnavailableError);
  assert.match(error.message, /bwrap is not on the PATH/);
});

test("an srt that can't start a command makes provisioning throw SandboxUnavailableError with its reason", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  const binary = join(folder(), "srt");
  writeFileSync(binary, "#!/bin/sh\necho 'bwrap: No permissions to create new namespace' >&2\nexit 1\n");
  chmodSync(binary, 0o755);
  const before = privateFolders();
  const error = await srtSandbox({ binary })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof SandboxUnavailableError);
  assert.match(error.message, /No permissions to create new namespace/);
  assert.deepEqual(privateFolders(), before, "no private folder was left behind");
});

test("srt is started with a fixed environment, and the command's variables go through env inside", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  vi.stubEnv("HARNESS_TEST_HOST_SECRET", "must-not-reach-srt");
  vi.stubEnv("PATH", `planted/bin${delimiter}${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  const log = join(folder(), "env.log");
  const binary = join(folder(), "srt");
  // Records the environment and the arguments of every start, and succeeds without running anything.
  writeFileSync(binary, `#!/bin/sh\n{ env; echo "ARGS: $*"; } >> ${JSON.stringify(log)}\nexit 0\n`);
  chmodSync(binary, 0o755);
  const sandbox = await srtSandbox({ binary }).provision({ root }, policy(root));
  try {
    const base = spawnEnv([]);
    const env = { ...base, NODE_OPTIONS: "--require ./evil.cjs", LD_PRELOAD: "/tmp/evil.so" };
    await sandbox.exec(["echo", "hi"], { env, signal: new AbortController().signal });
    rmSync(base.HOME ?? "", { recursive: true, force: true });
    const starts = readFileSync(log, "utf8").split("ARGS: ");
    const last = starts[starts.length - 2] ?? "";
    const names = last
      .split("\n")
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => line.slice(0, line.indexOf("=")));
    assert.ok(!names.includes("HARNESS_TEST_HOST_SECRET"), "the host's own variables must not reach srt");
    assert.ok(!names.includes("NODE_OPTIONS") && !names.includes("LD_PRELOAD"), "no loader variable reaches srt");
    const launchPath = last.split("\n").find((line) => line.startsWith("PATH=")) ?? "";
    assert.ok(
      !launchPath.includes("planted/bin"),
      "a relative PATH folder is left out, so srt can't start a planted program",
    );
    const allowed = new Set(["PATH", "TMPDIR", "PWD", "SHLVL", "_", "OLDPWD"]);
    assert.deepEqual(
      names.filter((name) => !allowed.has(name)),
      [],
      "srt may hold only PATH and its own TMPDIR",
    );
    const ran = readFileSync(log, "utf8");
    assert.match(ran, /ARGS: .*--settings .*-- \/usr\/bin\/env /);
    assert.match(ran, /NODE_OPTIONS=--require \.\/evil\.cjs/, "the command still gets what it was given, through env");
    assert.match(
      ran,
      /-- .*NODE_OPTIONS=--require \.\/evil\.cjs .*echo hi/,
      "the command follows env's -- and its assignments",
    );
  } finally {
    await sandbox.dispose();
  }
});

test("a command whose first word starts with - follows env's --, and one that holds = is not found", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  const log = join(folder(), "args.log");
  const binary = join(folder(), "srt");
  writeFileSync(binary, `#!/bin/sh\necho "ARGS: $*" >> ${JSON.stringify(log)}\nexit 0\n`);
  chmodSync(binary, 0o755);
  const sandbox = await srtSandbox({ binary }).provision({ root }, policy(root));
  try {
    const signal = new AbortController().signal;
    await sandbox.exec(["-x", "y"], { env: {}, signal });
    const assignment = await sandbox.exec(["FOO=1", "printenv"], { env: {}, signal });
    const lines = readFileSync(log, "utf8").split("\n");
    assert.ok(
      lines.some((line) => line.endsWith("-- -x y")),
      "-x follows env's --",
    );
    assert.ok(!lines.some((line) => line.includes("FOO=1")), "a first word with = never reaches env");
    assert.deepEqual(assignment, { exitCode: 127, stdout: "", stderr: "command not found: FOO=1\n" });
  } finally {
    await sandbox.dispose();
  }
});

test("dispose removes the sandbox's private folder", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  const binary = join(folder(), "srt");
  writeFileSync(binary, "#!/bin/sh\nexit 0\n");
  chmodSync(binary, 0o755);
  const before = privateFolders();
  const sandbox = await srtSandbox({ binary }).provision({ root }, policy(root));
  assert.equal(privateFolders().length, before.length + 1, "provisioning made one private folder");
  await Promise.all([sandbox.dispose(), sandbox.dispose()]);
  assert.deepEqual(privateFolders(), before);
  mkdirSync(join(root, "x"), { recursive: true });
});

test("a root, an extra read root or a denyWrite folder that is not absolute, or is /, is refused before anything starts", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("PATH", `${fakePrograms}${delimiter}${process.env.PATH ?? ""}`);
  const root = folder();
  for (const bad of ["relative/dir", "/"]) {
    const error = await srtSandbox()
      .provision({ root }, { readRoots: [bad], writeRoots: [root], network: { allow: [], deny: [] } })
      .catch((caught: unknown) => caught);
    assert.equal((error as { code?: string }).code, "invalid_sandbox_options", `${bad} must be refused`);
  }
  for (const option of [{ denyWrite: ["relative/log"] }, { extraReadRoots: ["tools"] }]) {
    const error = await srtSandbox(option)
      .provision({ root }, policy(root))
      .catch((caught: unknown) => caught);
    assert.equal(
      (error as { code?: string }).code,
      "invalid_sandbox_options",
      `${JSON.stringify(option)} must be refused`,
    );
  }
});
