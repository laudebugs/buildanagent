import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
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

// A source that runs `astro build`, found by its text: the astro binary or package named next to "build" in an argument
// list, `astro build` or `pnpm build` in a command string, `build` imported from "astro", or "astro" imported
// dynamically. Remaining limits: a command assembled from variables (execFile(bin, args) with both built elsewhere) or
// from concatenated strings is invisible to a text scan, and so is a build started through a script this file never
// names. The proof test below catches those cases by outcome, since a second build breaks the run it shares.
const RUNS_ASTRO_BUILD = [
  /["'`]astro["'`]\s*,\s*["'`]build["'`]/,
  /["'`]astro["'`][^;]*\[\s*["'`]build["'`]/,
  /\[[^\]]*["'`]build["'`]\s*,\s*["'`]--outDir/,
  /\bbuild\b[^;\n]*from\s+["']astro["']/,
  /\bimport\(\s*["']astro["']\s*\)/,
  /\bastro\s+build\b/,
  /\bpnpm\s+(?:exec\s+|run\s+)?build\b/,
  /["'`]pnpm["'`]\s*,\s*\[\s*(?:["'`](?:exec|run)["'`]\s*,\s*)?["'`]build["'`]/,
];

/** The source without block comments and whole-line comments, which may name a build without running one. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** Whether a test source starts an Astro build of its own, so two files could build into the same .astro at once. */
function runsAstroBuild(source: string): boolean {
  const code = withoutComments(source);
  return RUNS_ASTRO_BUILD.some((pattern) => pattern.test(code));
}

/** Every script under the test folder, subfolders included, as a path relative to it. */
function scripts(dir = testDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "fixtures" ? [] : scripts(path);
    return /\.(?:ts|mts|js|mjs)$/.test(entry.name) ? [relative(testDir, path)] : [];
  });
}

test("no test file but the global setup runs astro build", () => {
  const offenders = scripts()
    .filter((name) => name !== BUILDER && name !== "build-isolation.test.ts")
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
  for (const own of [
    'execFile("pnpm", ["exec", "astro", "build"])',
    'spawn("pnpm", ["build"])',
    'execSync("pnpm build")',
    'const { build } = await import("astro"); await build({})',
    "run([astroJs, 'build', '--outDir', out])",
    'const { build: run } = await import("astro");',
  ]) {
    assert.ok(runsAstroBuild(own), own);
  }
  assert.ok(!runsAstroBuild("/*\n * runs astro build once\n */\nconst out = builtBook();"));
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
  let report: {
    numTotalTestSuites: number;
    numFailedTests: number;
    numPendingTests: number;
    numPassedTests: number;
    numFailedTestSuites: number;
  };
  try {
    await promisify(execFile)(
      nearestBin("vitest"),
      ["run", "--reporter=json", `--outputFile=${reportFile}`, ...files],
      {
        cwd: app,
        env,
        maxBuffer: 64 * 1024 * 1024,
      },
    ).catch((error: { stdout?: string; stderr?: string }) => {
      throw new Error(`the child run failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`.slice(-4000));
    });
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assert.equal(report.numTotalTestSuites > 0, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0, "no test is skipped");
  assert.ok(report.numPassedTests > 20, "both files ran their tests");
  assert.equal(report.numFailedTestSuites, 0);
}, 300_000);
