import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxUnavailableError } from "@buildanagent/harness/sandbox";
import { DOCKER_PROXY_SOCKET_PATH, dockerSandbox } from "@buildanagent/harness/sandbox/docker";
import { afterAll, afterEach, test, vi } from "vitest";

// These tests start no container: a fake `docker` records how it was called and answers each command as the test says.
// The real daemon runs in docker.test.ts, which is opt-in.
const folders: string[] = [];
function folder(label = "t"): string {
  const made = mkdtempSync(join(tmpdir(), `harness-docker-test-${label}-`));
  folders.push(made);
  return made;
}
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

const IMAGE = "registry.test/image@sha256:abc";
const linux = process.platform === "linux";
const privateFolders = () =>
  readdirSync(tmpdir()).filter(
    (name) => name.startsWith("harness-docker-") && !name.startsWith("harness-docker-test-"),
  );
const policy = (root: string) => ({ readRoots: [root], writeRoots: [root], network: { allow: [], deny: [] } });

/** A fake `docker` that logs each call's arguments and environment, and answers by the first words of the call. */
function fakeDocker(answers: { version?: number; image?: number; create?: number } = {}) {
  const dir = folder("bin");
  const log = join(dir, "calls.log");
  const script = `#!/bin/sh
{ echo "CALL $*"; env | sed 's/^/ENV /'; } >> ${JSON.stringify(log)}
case "$1" in
  version) [ ${answers.version ?? 0} -ne 0 ] && echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit ${answers.version ?? 0} ;;
  image) [ ${answers.image ?? 0} -ne 0 ] && echo "Error: No such image" >&2; exit ${answers.image ?? 0} ;;
  create) [ ${answers.create ?? 0} -ne 0 ] && echo "docker: Error response from daemon: boom" >&2; exit ${answers.create ?? 0} ;;
  *) exit 0 ;;
esac
`;
  const binary = join(dir, "docker");
  writeFileSync(binary, script);
  chmodSync(binary, 0o755);
  return { binary, calls: () => readFileSync(log, "utf8").split("CALL ").slice(1) };
}

const abortSignal = () => new AbortController().signal;

test("docker that is not on the PATH, or a binary that is not executable, throws SandboxUnavailableError", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  vi.stubEnv("PATH", folder("empty"));
  const missing = await dockerSandbox({ image: IMAGE })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(missing instanceof SandboxUnavailableError);
  assert.match(missing.message, /docker is not on the PATH/);
  const notExecutable = await dockerSandbox({ image: IMAGE, binary: join(root, "no-docker") })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(notExecutable instanceof SandboxUnavailableError);
  assert.match(notExecutable.message, /is not an executable file/);
});

test("a daemon that does not answer throws SandboxUnavailableError with its reason, and no private folder is left", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const before = privateFolders();
  const error = await dockerSandbox({ image: IMAGE, binary: fakeDocker({ version: 1 }).binary })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof SandboxUnavailableError);
  assert.equal(error.backend, "docker");
  assert.match(error.message, /Cannot connect to the Docker daemon/);
  assert.deepEqual(privateFolders(), before);
});

test("an image that is not on the host throws SandboxUnavailableError, and nothing is pulled", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const docker = fakeDocker({ image: 1 });
  const error = await dockerSandbox({ image: IMAGE, binary: docker.binary })
    .provision({ root }, policy(root))
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof SandboxUnavailableError);
  assert.match(error.message, /is not on the Docker host/);
  assert.ok(!docker.calls().some((call) => call.startsWith("pull")), "provision never pulls");
});

test("a command runs in a container with every lock-down flag, and the docker client gets a clean environment", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  vi.stubEnv("HARNESS_TEST_HOST_SECRET", "must-not-reach-docker");
  vi.stubEnv("DOCKER_HOST", "unix:///run/test-docker.sock");
  const root = folder();
  const outside = folder("extra");
  const log = join(root, "log");
  mkdirSync(log);
  const docker = fakeDocker();
  const sandbox = await dockerSandbox({
    image: IMAGE,
    binary: docker.binary,
    cpus: 2,
    memoryMb: 512,
    pidsLimit: 64,
    user: "1000:1000",
    extraReadRoots: [outside],
    denyWrite: [log],
  }).provision({ root }, policy(root));
  try {
    await sandbox.exec(["echo", "hi"], { env: { ALPHA: "1" }, signal: abortSignal() });
    const create = docker.calls().find((call) => call.startsWith("create")) ?? "";
    for (const flag of [
      "--rm",
      "--pull never",
      "--network none",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--ipc none",
      "--pids-limit 64",
      "--cpus 2",
      "--memory 512m",
      "--memory-swap 512m",
      "--user 1000:1000",
      "--tmpfs /tmp:rw,nosuid,size=64m",
      "--entrypoint env",
      `${IMAGE} -i -- ALPHA=1 echo hi`,
    ]) {
      assert.ok(create.split("\n")[0]?.includes(flag), `the container needs ${flag}`);
    }
    assert.ok(
      !/--privileged|--cap-add|docker\.sock|--network (host|bridge)|--pid host/.test(create.split("\n")[0] ?? ""),
    );
    const first = create.split("\n")[0] ?? "";
    assert.ok(
      first.includes(`type=bind,src=${root},dst=${root} `) || first.includes(`type=bind,src=${root},dst=${root} --`),
      "the write root is mounted writable",
    );
    assert.ok(first.includes(`src=${outside},dst=${outside},readonly`), "an extra read root is read-only");
    assert.ok(first.includes(`src=${log},dst=${log},readonly`), "a denyWrite folder is read-only");
    const names = create
      .split("\n")
      .filter((line) => line.startsWith("ENV "))
      .map((line) => line.slice(4, line.indexOf("=")));
    assert.ok(!names.includes("HARNESS_TEST_SECRET") && !names.includes("HARNESS_TEST_HOST_SECRET"));
    const allowed = new Set(["PATH", "HOME", "DOCKER_HOST", "PWD", "SHLVL", "_", "OLDPWD"]);
    assert.deepEqual(
      names.filter((name) => !allowed.has(name)),
      [],
      "the client holds a PATH, a HOME and DOCKER_HOST only",
    );
    assert.ok(create.includes("ENV DOCKER_HOST=unix:///run/test-docker.sock"));
    assert.ok(
      docker.calls().some((call) => call.startsWith("start --attach")),
      "the created container is then started",
    );
  } finally {
    await sandbox.dispose();
  }
});

test("a proxy socket is mounted at the documented path, and only a socket is accepted", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const socketFolder = folder("sock");
  const socket = join(socketFolder, "proxy.sock");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  const docker = fakeDocker();
  try {
    const sandbox = await dockerSandbox({ image: IMAGE, binary: docker.binary, proxySocket: socket }).provision(
      { root },
      policy(root),
    );
    await sandbox.exec(["true"], { env: {}, signal: abortSignal() });
    await sandbox.dispose();
    const create = docker.calls().find((call) => call.startsWith("create")) ?? "";
    assert.ok(create.includes(`src=${socket},dst=${DOCKER_PROXY_SOCKET_PATH}`));
    const notSocket = await dockerSandbox({ image: IMAGE, binary: docker.binary, proxySocket: root })
      .provision({ root }, policy(root))
      .catch((caught: unknown) => caught);
    assert.equal((notSocket as { code?: string }).code, "invalid_sandbox_options");
  } finally {
    server.close();
  }
});

test("no proxy socket means no mount at the documented path", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const docker = fakeDocker();
  const sandbox = await dockerSandbox({ image: IMAGE, binary: docker.binary }).provision({ root }, policy(root));
  await sandbox.exec(["true"], { env: {}, signal: abortSignal() });
  await sandbox.dispose();
  assert.ok(!(docker.calls().find((call) => call.startsWith("create")) ?? "").includes(DOCKER_PROXY_SOCKET_PATH));
});

test("a container that can't be created is a result with the daemon's message, and a first word with = is not found", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const docker = fakeDocker({ create: 125 });
  const sandbox = await dockerSandbox({ image: IMAGE, binary: docker.binary }).provision({ root }, policy(root));
  try {
    const failed = await sandbox.exec(["echo"], { env: {}, signal: abortSignal() });
    assert.ok("exitCode" in failed && failed.exitCode === 125 && /boom/.test(failed.stderr));
    const assignment = await sandbox.exec(["FOO=1", "env"], { env: {}, signal: abortSignal() });
    assert.deepEqual(assignment, { exitCode: 127, stdout: "", stderr: "command not found: FOO=1\n" });
  } finally {
    await sandbox.dispose();
  }
});

test("a bad option or root is refused before anything starts", async (context) => {
  if (!linux) context.skip("this backend runs on Linux only");
  const root = folder();
  const docker = fakeDocker();
  const bad: Record<string, () => Promise<unknown>> = {
    "an image that starts with -": async () => dockerSandbox({ image: "--privileged" }),
    "an empty image": async () => dockerSandbox({ image: "" }),
    "zero cpus": async () => dockerSandbox({ image: IMAGE, cpus: 0 }),
    "too little memory": async () => dockerSandbox({ image: IMAGE, memoryMb: 1 }),
    "a user that is a name": async () => dockerSandbox({ image: IMAGE, user: "root" }),
    "a relative root": () =>
      dockerSandbox({ image: IMAGE, binary: docker.binary }).provision(
        { root },
        { ...policy(root), readRoots: ["relative"] },
      ),
    "a relative denyWrite folder": () =>
      dockerSandbox({ image: IMAGE, binary: docker.binary, denyWrite: ["relative"] }).provision({ root }, policy(root)),
    "a workspace outside every root": () =>
      dockerSandbox({ image: IMAGE, binary: docker.binary }).provision({ root }, policy(folder("other"))),
    "a root with a comma": async () => {
      const odd = join(folder(), "a,b");
      mkdirSync(odd);
      return dockerSandbox({ image: IMAGE, binary: docker.binary }).provision({ root: odd }, policy(odd));
    },
  };
  for (const [label, attempt] of Object.entries(bad)) {
    const error = await attempt().catch((caught: unknown) => caught);
    assert.equal((error as { code?: string }).code, "invalid_sandbox_options", `${label} must be refused`);
  }
});
