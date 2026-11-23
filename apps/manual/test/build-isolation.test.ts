import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";
import { nearestBin } from "./built-book.js";

// `astro build` writes its prerender bundle to <app>/.astro/.prerender whatever --outDir says, so two builds at once
// delete the chunks the other imports (ERR_MODULE_NOT_FOUND) and Vitest skips every test behind them. test/built-book.ts
// is the one place that runs a build, once per run. These tests keep it that way and show that the files which read the
// build run side by side without a skip.
const app = fileURLToPath(new URL("..", import.meta.url));
const testDir = fileURLToPath(new URL(".", import.meta.url));
const BUILDER = "built-book.ts";

// A source that runs `astro build`: it spawns the astro binary with a build argument, or imports `build` from "astro".
const RUNS_ASTRO_BUILD = [
  /["'`]astro["'`][^;]*\[\s*["'`]build["'`]/,
  /\bbuild\b[^;\n]*from\s+["']astro["']/,
  /\bastro\s+build\b(?!`)/,
];

/** Whether a test source starts an Astro build of its own, so two files could build into the same .astro at once. */
function runsAstroBuild(source: string): boolean {
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return RUNS_ASTRO_BUILD.some((pattern) => pattern.test(code));
}

test("no test file but the global setup runs astro build", () => {
  const offenders = readdirSync(testDir)
    .filter((name) => name.endsWith(".ts") && name !== BUILDER && name !== "build-isolation.test.ts")
    .filter((name) => runsAstroBuild(readFileSync(join(testDir, name), "utf8")));
  assert.deepEqual(
    offenders,
    [],
    "read the shared build with builtBook() from test/built.ts instead of building again",
  );
});

test("the guard fires on a file that builds on its own and passes one that reads the shared build", () => {
  const own = 'await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: app, env });';
  assert.ok(runsAstroBuild(own));
  assert.ok(runsAstroBuild('import { build } from "astro";'));
  assert.ok(runsAstroBuild('execFileSync("pnpm exec astro build")'));
  assert.ok(!runsAstroBuild('import { builtBook } from "./built.js";\nconst out = builtBook();'));
  assert.ok(!runsAstroBuild("// Builds with `astro build` once.\nconst out = builtBook();"));
});

test("the global setup passes its build a folder of its own", () => {
  assert.match(readFileSync(join(testDir, BUILDER), "utf8"), /\["build", "--outDir", out\]/);
});

test("the build tests run side by side from a clean .astro with none skipped or failed", async () => {
  // The failure appeared when .astro/.prerender was missing, so remove it first. The build this run's own global
  // setup made is already finished, and no other test file builds.
  rmSync(join(app, ".astro"), { recursive: true, force: true });
  const files = ["test/build.test.ts", "test/offline-build.test.ts"];
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: tmpdir(),
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  const folder = mkdtempSync(join(tmpdir(), "manual-isolation-"));
  const reportFile = join(folder, "report.json");
  await promisify(execFile)(nearestBin("vitest"), ["run", "--reporter=json", `--outputFile=${reportFile}`, ...files], {
    cwd: app,
    env,
    maxBuffer: 64 * 1024 * 1024,
  }).catch((error: { stdout?: string; stderr?: string }) => {
    throw new Error(`the child run failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`.slice(-4000));
  });
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  rmSync(folder, { recursive: true, force: true });
  assert.equal(report.numTotalTestSuites > 0, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0, "no test is skipped");
  assert.ok(report.numPassedTests > 20, "both files ran their tests");
  assert.equal(report.numFailedTestSuites, 0);
}, 300_000);
