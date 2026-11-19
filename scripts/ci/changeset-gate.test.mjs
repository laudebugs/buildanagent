// Offline checks for CI's changeset gate: ci.yml runs it on every pull request, and scripts/ci/changeset-gate.mjs
// passes a version bump without a changeset while sending every other shipped change to `pnpm changeset status`.
// The git tests build throwaway repositories in a temp folder and stub the status run, so nothing here installs
// anything or touches the network. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  classifyChange,
  isVersionOnlyChange,
  patternToRegExp,
  runGate,
  shippedChanges,
  versionedPackageDirs,
} from "./changeset-gate.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const config = JSON.parse(readFileSync(path.join(root, ".changeset", "config.json"), "utf8"));

describe("ci.yml's changesets job", () => {
  const { jobs } = parse(readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8"));
  const job = jobs.changesets;

  test("is switched on", () => {
    assert.ok(job, "ci.yml has no changesets job");
    assert.ok(job.if === undefined || job.if === true, `the job's if: is ${job.if}`);
  });

  test("runs the gate against origin/main with the full history", () => {
    const runs = job.steps.map((step) => step.run ?? "");
    assert.ok(runs.includes("node scripts/ci/changeset-gate.mjs origin/main"), "the job doesn't run the gate");
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout"));
    assert.equal(checkout.with["fetch-depth"], 0);
  });
});

describe("changeset-gate.mjs", () => {
  test("matches changedFilePatterns the way Changesets does", () => {
    assert.deepEqual(config.changedFilePatterns, ["src/**", "package.json", "tsconfig.build.json"]);
    const re = config.changedFilePatterns.map(patternToRegExp);
    const matches = (file) => re.some((r) => r.test(file));
    assert.ok(matches("src/index.ts"));
    assert.ok(matches("src/adapters/anthropic/adapter.ts"));
    assert.ok(matches("package.json"));
    assert.ok(matches("tsconfig.build.json"));
    assert.ok(!matches("README.md"));
    assert.ok(!matches("CHANGELOG.md"));
    assert.ok(!matches("test/package.json"));
    assert.ok(!matches("tsconfigXbuild.json"), "a dot matches only a dot");
  });

  test("lists only the shipped files of versioned packages", () => {
    const changed = [
      "packages/gateway/src/retry.ts",
      "packages/gateway/README.md",
      "packages/sdk/package.json",
      "packages/sdkx/src/a.ts",
      "verify/pi/package.json",
      "docs/plans/ci.md",
    ];
    assert.deepEqual(shippedChanges(changed, ["packages/gateway", "packages/sdk"], config.changedFilePatterns), [
      "packages/gateway/src/retry.ts",
      "packages/sdk/package.json",
    ]);
  });

  test("this checkout versions both packages", () => {
    assert.deepEqual(versionedPackageDirs(root), ["packages/gateway", "packages/sdk"]);
  });

  test("a version-only change differs in version and nowhere else", () => {
    const base = { name: "a", version: "0.0.0", scripts: { b: "x", a: "y" } };
    assert.ok(isVersionOnlyChange(base, { name: "a", scripts: { a: "y", b: "x" }, version: "0.1.0" }));
    assert.ok(!isVersionOnlyChange(base, { ...base }), "no version change");
    assert.ok(!isVersionOnlyChange(base, { ...base, version: "0.1.0", dependencies: { c: "1.0.0" } }));
    assert.ok(!isVersionOnlyChange(undefined, base), "a new package.json");
  });

  const manifest = (version, extra = {}) => `${JSON.stringify({ name: "@x/a", version, ...extra })}\n`;
  const files = (base, head) => (file, side) => (side === "base" ? base : head)[file];

  test("passes a bump whose changelog has the new version", () => {
    const read = files(
      { "packages/a/package.json": manifest("0.0.0") },
      { "packages/a/package.json": manifest("0.1.0"), "packages/a/CHANGELOG.md": "# @x/a\n\n## 0.1.0\n\n- first\n" },
    );
    assert.equal(classifyChange(["packages/a/package.json"], read).bump, true);
  });

  test("sends everything else to changeset status", () => {
    const head = { "packages/a/package.json": manifest("0.1.0"), "packages/a/CHANGELOG.md": "## 0.1.0\n\n- x\n" };
    const base = { "packages/a/package.json": manifest("0.0.0") };
    const cases = [
      [[], files(base, head), /no shipped file/],
      [["packages/a/package.json", "packages/a/src/x.ts"], files(base, head), /other than package\.json/],
      [["packages/a/package.json"], files(base, { ...head, "packages/a/CHANGELOG.md": "## 0.0.9\n" }), /no section/],
      [["packages/a/package.json"], files(base, { "packages/a/package.json": manifest("0.1.0", { x: 1 }) }), /more/],
      [["packages/a/package.json"], files(base, {}), /deleted/],
    ];
    for (const [shipped, read, reason] of cases) {
      const verdict = classifyChange(shipped, read);
      assert.equal(verdict.bump, false, String(reason));
      assert.match(verdict.reason, reason);
    }
  });

  describe("in a git repository", () => {
    const dirs = [];
    after(() => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    // A repository with one package at 0.0.0 on `main`, and a `work` branch checked out for the change under test.
    function repo() {
      const dir = mkdtempSync(path.join(tmpdir(), "changeset-gate-"));
      dirs.push(dir);
      const env = { PATH: process.env.PATH, HOME: dir, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1" };
      const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" });
      const write = (file, text) => {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), text);
      };
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "test");
      write(".changeset/config.json", JSON.stringify(config));
      write("packages/a/package.json", manifest("0.0.0"));
      write("packages/a/src/index.ts", "export const a = 1;\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      git("switch", "-qc", "work");
      const commit = () => {
        git("add", "-A");
        git("commit", "-qm", "change");
      };
      return { dir, write, commit };
    }

    function gate(dir) {
      const calls = [];
      const code = runGate({
        root: dir,
        base: "main",
        log: () => {},
        runStatus: (base) => {
          calls.push(base);
          return 1;
        },
      });
      return { code, calls };
    }

    test("a changeset version commit passes without running changeset status", () => {
      const { dir, write, commit } = repo();
      write("packages/a/package.json", manifest("0.1.0"));
      write("packages/a/CHANGELOG.md", "# @x/a\n\n## 0.1.0\n\n### Minor Changes\n\n- first\n");
      commit();
      assert.deepEqual(gate(dir), { code: 0, calls: [] });
    });

    test("a src/ change runs changeset status, whose failure fails the gate", () => {
      const { dir, write, commit } = repo();
      write("packages/a/src/index.ts", "export const a = 2;\n");
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: ["main"] });
    });

    test("a bump that also changes src/ runs changeset status", () => {
      const { dir, write, commit } = repo();
      write("packages/a/package.json", manifest("0.1.0"));
      write("packages/a/CHANGELOG.md", "## 0.1.0\n\n- first\n");
      write("packages/a/src/index.ts", "export const a = 2;\n");
      commit();
      assert.deepEqual(gate(dir).calls, ["main"]);
    });

    test("an uncommitted bump in the working tree doesn't count", () => {
      const { dir, write } = repo();
      write("packages/a/package.json", manifest("0.1.0"));
      write("packages/a/CHANGELOG.md", "## 0.1.0\n\n- first\n");
      assert.deepEqual(gate(dir).calls, ["main"]);
    });
  });
});
