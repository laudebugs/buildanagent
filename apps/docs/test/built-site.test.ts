import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { buildSite } from "./built-site.js";

// The global setup's build step, with a stand-in for astro build: a failed build reaches the tests as its error, not as
// a thrown setup that would stop every test file, and its temporary folder never outlives the run.

test("a failed build returns its error and removes its folder at once", async () => {
  let folder = "";
  const { site, teardown } = await buildSite(async (out) => {
    folder = out;
    writeFileSync(join(out, "half-written.html"), "");
    throw Object.assign(new Error("Command failed: astro build"), {
      stdout: "built 3 pages",
      stderr: "a link is broken",
    });
  });
  assert.ok(folder !== "" && !existsSync(folder), "the failed build's folder is removed");
  assert.ok("error" in site);
  assert.match(site.error, /Command failed: astro build\nbuilt 3 pages\na link is broken/);
  assert.doesNotThrow(teardown);
});

test("a build that succeeds keeps its folder until the teardown", async () => {
  const { site, teardown } = await buildSite(async () => {});
  assert.ok("out" in site && existsSync(site.out));
  teardown();
  assert.ok(!existsSync(site.out));
});
