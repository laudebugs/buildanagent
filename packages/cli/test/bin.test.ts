import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { afterAll, test } from "vitest";

// The `buildanagent` binary runs from its source here, with our packages read from `src/` through the `source`
// condition; scripts/ci/packages-pack.test.mjs runs the packed one. This is the only test that spawns it: every other
// test drives `runCli()` in process.
const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const SOURCE_CONDITION = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const TSX = import.meta.resolve("tsx");
// A cleared environment with a fresh temp HOME, so nothing the test runner holds, such as a provider key, reaches the
// child, and its default state folder is empty.
const ENV = spawnEnv([]);

afterAll(() => rmSync(ENV.HOME as string, { recursive: true, force: true }));

function buildanagent(...args: string[]) {
  return spawnWith(args);
}

function spawnWith(args: readonly string[], input = "", env: NodeJS.ProcessEnv = ENV) {
  return spawnSync(
    process.execPath,
    ["--conditions=source", "--import", SOURCE_CONDITION, "--import", TSX, BIN, ...args],
    { encoding: "utf8", env, input },
  );
}

test("the binary's first line runs it with Node", () => {
  assert.equal(readFileSync(BIN, "utf8").split("\n")[0], "#!/usr/bin/env node");
});

test("--help, -h and no arguments print the help and exit 0", () => {
  for (const args of [["--help"], ["-h"], []]) {
    const child = buildanagent(...args);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /^Usage: buildanagent/);
  }
});

test("an unknown command prints the help to stderr and exits 2", () => {
  const child = buildanagent("frobnicate");
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /^buildanagent: unknown command "frobnicate"\n\nUsage: buildanagent/);
});

test("the binary lists sessions from its default state folder under HOME, and exits 0", () => {
  const child = buildanagent("sessions", "list");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "no sessions yet\n");
});

test("rpc answers initialize on stdout, logs nothing else there, and exits 0 when stdin ends", () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "t", version: "0" }, capabilities: [] },
  };
  // A provider key the child would read only on a model call: initialize makes none, so nothing leaves the machine.
  const child = spawnWith(["rpc", "--model", "anthropic:test-model"], `${JSON.stringify(initialize)}\nnot json\n`, {
    ...ENV,
    ANTHROPIC_API_KEY: "not-a-real-key",
  });
  assert.equal(child.status, 0, child.stderr);
  const lines = child.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 2);
  // The refusal can come first: initialize is answered once the dispatcher has run it.
  const messages = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const answer = messages.find((message) => message.id === 1);
  const refusal = messages.find((message) => message.id === null);
  assert.equal(answer?.id, 1);
  assert.ok("result" in (answer ?? {}));
  assert.deepEqual((refusal?.error as { code?: number } | undefined)?.code, -32700);
  assert.match(child.stderr, /^stdio: refused a line: /);
});
