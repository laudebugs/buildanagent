import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";

// The `buildanagent` binary runs from its source here; scripts/ci/packages-pack.test.mjs runs the packed one.
const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
const HOME = mkdtempSync(join(tmpdir(), "cli-bin-"));

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

function buildanagent(...args: string[]) {
  // An allowlisted environment, so nothing the test runner holds, such as a provider key, reaches the child.
  const env = { PATH: process.env.PATH ?? "", HOME, TMPDIR: tmpdir(), LANG: "C.UTF-8" };
  return spawnSync(process.execPath, ["--import", TSX, BIN, ...args], { encoding: "utf8", env });
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

test("an unknown argument prints the help to stderr and exits 2", () => {
  const child = buildanagent("run");
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /^buildanagent: unknown argument "run"\n\nUsage: buildanagent/);
});
