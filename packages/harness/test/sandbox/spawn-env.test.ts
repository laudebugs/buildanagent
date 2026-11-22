import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isHarnessError } from "@buildanagent/harness";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { afterEach, test, vi } from "vitest";

const made: string[] = [];

function env(allow: string[], extra?: Record<string, string>): Record<string, string> {
  const result = spawnEnv(allow, extra);
  if (result.HOME !== undefined) made.push(result.HOME);
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function assertInvalid(action: () => unknown, pattern: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(isHarnessError(error) && error.code === "invalid_spawn_env", String(error));
    assert.match(error.message, pattern);
    return true;
  });
}

test("spawnEnv([]) returns exactly PATH, HOME, TMPDIR and LANG, with HOME a fresh temp folder", () => {
  const result = env([]);
  assert.deepEqual(Object.keys(result).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
  assert.equal(result.TMPDIR, tmpdir());
  assert.ok(result.HOME?.startsWith(tmpdir()), "HOME is under the temp directory");
  assert.ok(existsSync(result.HOME ?? ""), "HOME exists");
  assert.ok(statSync(result.HOME ?? "").isDirectory());
  assert.notEqual(env([]).HOME, result.HOME, "each call makes a fresh HOME");
});

test("PATH and LANG come from the parent when it has them, and default when it has none", () => {
  vi.stubEnv("PATH", "/custom/bin");
  vi.stubEnv("LANG", "de_DE.UTF-8");
  assert.deepEqual([env([]).PATH, env([]).LANG], ["/custom/bin", "de_DE.UTF-8"]);
  vi.stubEnv("PATH", "");
  vi.stubEnv("LANG", "");
  const bare = env([]);
  assert.equal(bare.PATH, "");
  vi.unstubAllEnvs();
  delete process.env.LANG;
  assert.equal(env([]).LANG, "C.UTF-8");
});

test("a variable the parent has is copied only when named, and one it lacks is left out", () => {
  vi.stubEnv("DOCKER_HOST", "unix:///var/run/docker.sock");
  vi.stubEnv("UNLISTED", "x");
  const result = env(["DOCKER_HOST", "NOT_SET_ANYWHERE"]);
  assert.equal(result.DOCKER_HOST, "unix:///var/run/docker.sock");
  assert.ok(!("UNLISTED" in result) && !("NOT_SET_ANYWHERE" in result));
});

test("extra values are added and override, and they are the only way a credential reaches a child", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "real-key-from-the-parent");
  const result = env([], { ANTHROPIC_API_KEY: "dummy-for-the-proxy", HTTPS_PROXY: "http://127.0.0.1:9" });
  assert.equal(result.ANTHROPIC_API_KEY, "dummy-for-the-proxy");
  assert.equal(result.HTTPS_PROXY, "http://127.0.0.1:9");
  assert.equal(env([], { LANG: "fr_FR.UTF-8" }).LANG, "fr_FR.UTF-8");
});

test("a name that is reserved, looks like a credential or isn't a name is refused, and a bad value too", () => {
  assertInvalid(() => spawnEnv(["HOME"]), /always set/);
  assertInvalid(() => spawnEnv(["PATH"]), /always set/);
  for (const name of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "DB_PASSWORD", "MY_SECRET", "AUTHORIZATION"]) {
    assertInvalid(() => spawnEnv([name]), /looks like a credential/);
  }
  assertInvalid(() => spawnEnv(["1BAD"]), /not a valid variable name/);
  assertInvalid(() => spawnEnv(["A=B"]), /not a valid variable name/);
  assertInvalid(() => spawnEnv([], { "bad-name": "x" }), /not a valid variable name/);
  assertInvalid(() => spawnEnv([], { OK: "a\0b" }), /NUL/);
  assertInvalid(() => spawnEnv([], { OK: 1 as unknown as string }), /string/);
});

test("a key set in the parent is absent in a spawned child", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-parent-only");
  vi.stubEnv("OPENAI_API_KEY", "sk-parent-only");
  const child = execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
    env: env([]),
    encoding: "utf8",
  });
  const seen = JSON.parse(child) as Record<string, string>;
  assert.ok(!("ANTHROPIC_API_KEY" in seen) && !("OPENAI_API_KEY" in seen), "no provider key reached the child");
  assert.deepEqual(Object.keys(seen).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
});
