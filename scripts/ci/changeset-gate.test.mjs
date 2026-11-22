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
  changedStamps,
  classifyChange,
  isVersionOnlyChange,
  newChangesets,
  patternToRegExp,
  RELEASE_STAMPS,
  releasingChangesets,
  runGate,
  shippedChanges,
  statusEnv,
  unreadableStamps,
  versionedPackageDirs,
} from "./changeset-gate.mjs";
import { isPendingChangeset, RELEASE_ORDER, versionedPackageNames } from "./release-plan.mjs";

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

  test("this checkout versions the six packages RELEASE_ORDER lists", () => {
    // packages/ also holds private packages, such as evals, which the gate never counts.
    assert.deepEqual(versionedPackageDirs(root), RELEASE_ORDER.map((dir) => `packages/${dir}`).sort());
  });

  test("a changeset naming only a formerly private package is pending once RELEASE_ORDER lists it", () => {
    const text = '---\n"@buildanagent/protocol": minor\n---\n\nThe first protocol alpha.\n';
    // Before L11, Changesets versioned only the gateway and the SDK, and never consumed such a changeset.
    assert.equal(isPendingChangeset("first.md", text, ["@buildanagent/gateway", "@buildanagent/sdk"]), false);
    const versioned = versionedPackageNames(root);
    for (const dir of ["agent-safety", "protocol", "harness", "cli"]) {
      assert.ok(versioned.includes(`@buildanagent/${dir}`), `${dir} isn't versioned`);
      const named = text.replace("protocol", dir);
      assert.equal(isPendingChangeset("first.md", named, versioned), true, dir);
      assert.deepEqual(
        newChangesets([".changeset/first.md"], () => named, versioned),
        [".changeset/first.md"],
      );
    }
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
    assert.equal(classifyChange(["packages/a/package.json"], read, ["packages/a"]).bump, true);
  });

  test("passes a bump only when the whole fixed group moves forward to one version", () => {
    const base = {
      "packages/a/package.json": manifest("0.1.0-alpha.1"),
      "packages/b/package.json": manifest("0.1.0-alpha.1"),
    };
    const head = (a, b) => ({
      ".changeset/pre.json": JSON.stringify({ mode: "pre", tag: "alpha" }),
      "packages/a/package.json": manifest(a),
      "packages/a/CHANGELOG.md": `## ${a}\n\n- x\n`,
      "packages/b/package.json": manifest(b),
      "packages/b/CHANGELOG.md": `## ${b}\n\n- x\n`,
    });
    const both = ["packages/a/package.json", "packages/b/package.json"];
    const dirs = ["packages/a", "packages/b"];
    const verdict = (shipped, a, b) => classifyChange(shipped, files(base, head(a, b)), dirs);
    assert.equal(verdict(both, "0.1.0-alpha.2", "0.1.0-alpha.2").bump, true);
    const cases = [
      [verdict(["packages/b/package.json"], "0.1.0-alpha.1", "0.1.0-alpha.5"), /leaves out packages\/a/],
      [verdict(both, "0.1.0-alpha.2", "0.1.0-alpha.3"), /different versions/],
      [verdict(both, "0.1.0-alpha.0", "0.1.0-alpha.0"), /moved back from 0\.1\.0-alpha\.1 to 0\.1\.0-alpha\.0/],
      [verdict(both, "0.0.9", "0.0.9"), /moved back/],
    ];
    for (const [result, reason] of cases) {
      assert.equal(result.bump, false, String(reason));
      assert.match(result.reason, reason);
    }
  });

  test("passes a bump only to a version that fits pre.json's pre mode", () => {
    const pre = (mode) => ({ ".changeset/pre.json": JSON.stringify({ mode, tag: "alpha" }) });
    const head = (version, extra = {}) => ({
      "packages/a/package.json": manifest(version),
      "packages/a/CHANGELOG.md": `## ${version}\n\n- x\n`,
      ...extra,
    });
    const verdict = (version, extra) =>
      classifyChange(
        ["packages/a/package.json"],
        files({ "packages/a/package.json": manifest("0.1.0-alpha.2") }, head(version, extra)),
        ["packages/a"],
      );
    assert.equal(verdict("0.1.0-alpha.3", pre("pre")).bump, true);
    // A stable version in pre mode would make every later release plan throw, so it isn't a bump.
    assert.match(verdict("0.1.0", pre("pre")).reason, /0\.1\.0 isn't a alpha prerelease/);
    assert.match(verdict("0.1.0-beta.0", pre("pre")).reason, /isn't a alpha prerelease/);
    assert.match(verdict("0.1.0-alpha.3").reason, /not a plain x\.y\.z version/);
    assert.equal(verdict("0.1.0", pre("exit")).bump, true);
    assert.equal(verdict("0.1.0").bump, true);
  });

  test("counts only top-level changesets that changeset version would consume", () => {
    const text = {
      ".changeset/brave-cats.md": '---\n"@x/a": patch\n---\n\nFix.\n',
      ".changeset/quiet-dogs.md": "---\n---\n",
      ".changeset/pre/first.md": '---\n"@x/a": minor\n---\n\nFirst.\n',
      ".changeset/README.md": "# Changesets\n",
      ".changeset/AGENTS.md": "# Notes\n",
      ".changeset/manual.md": '---\n"@x/manual": patch\n---\n\nA private app.\n',
      ".changeset/config.json": "{}",
    };
    const read = (file) => text[file];
    assert.deepEqual(newChangesets(Object.keys(text), read, ["@x/a"]), [
      ".changeset/brave-cats.md",
      ".changeset/quiet-dogs.md",
    ]);
  });

  test("a stamp counts as changed when the head adds it or gives it a new value, not when it stays or goes", () => {
    const stamp = { file: "f.ts", pattern: /HASH = "(\w+)"/ };
    const sides = (base, head) => (_file, side) => (side === "base" ? base : head);
    assert.equal(changedStamps([stamp], sides('HASH = "a"', 'HASH = "b"')).length, 1);
    assert.equal(changedStamps([stamp], sides(undefined, 'HASH = "b"')).length, 1);
    assert.equal(changedStamps([stamp], sides('HASH = "a"', '// HASH = "a"\nHASH = "a"')).length, 0);
    assert.equal(changedStamps([stamp], sides('HASH = "a"', undefined)).length, 0);
  });

  test("the SDK's defaults hash is a release stamp, and its pattern finds the hash in src/defaults.ts", () => {
    const [stamp] = RELEASE_STAMPS;
    assert.equal(stamp.file, "packages/sdk/src/defaults.ts");
    assert.match(stamp.pattern.exec(readFileSync(path.join(root, stamp.file), "utf8"))?.[1] ?? "", /^[0-9a-f]{64}$/);
  });

  test("only an added changeset that bumps a versioned package releases a stamped change", () => {
    const text = {
      ".changeset/brave-cats.md": '---\n"@x/a": patch\n---\n\nFix.\n',
      ".changeset/quiet-dogs.md": "---\n---\n",
      ".changeset/none-bump.md": '---\n"@x/a": none\n---\n\nNothing.\n',
      ".changeset/other-app.md": '---\n"@x/app": minor\n---\n\nApp.\n',
      ".changeset/old-entry.md": '---\n"@x/a": minor\n---\n\nAn earlier change, reworded.\n',
    };
    const read = (file, side) =>
      side === "base" ? (file === ".changeset/old-entry.md" ? "old" : undefined) : text[file];
    assert.deepEqual(releasingChangesets(Object.keys(text), read, ["@x/a"]), [".changeset/brave-cats.md"]);
  });

  test("a stamp file whose value the pattern can't find is unreadable", () => {
    const stamp = { file: "f.ts", pattern: RELEASE_STAMPS[0].pattern };
    const head = (text) => (_file, side) => (side === "head" ? text : undefined);
    const hash = "0".repeat(64);
    assert.equal(unreadableStamps([stamp], head(`export const DEFAULTS_HASH = "${hash}";`)).length, 0);
    assert.equal(unreadableStamps([stamp], head(`export const DEFAULTS_HASH: string = "${hash}";`)).length, 1);
    assert.equal(unreadableStamps([stamp], head(undefined)).length, 0);
    const moved = (_file, side) => (side === "base" ? `export const DEFAULTS_HASH = "${hash}";` : undefined);
    assert.equal(unreadableStamps([stamp], moved).length, 1, "a stamp file moved or deleted at head is unreadable");
  });

  test("runs changeset status with an allowlisted environment", () => {
    const parent = { PATH: "/bin", PNPM_HOME: "/pnpm", LANG: "en_US.UTF-8", GH_TOKEN: "t", NPM_TOKEN: "n", HOME: "/h" };
    const env = statusEnv(parent, "/tmp/home");
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "PNPM_HOME", "TMPDIR"]);
    assert.equal(env.HOME, "/tmp/home");
    assert.equal(env.PATH, "/bin");
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
      const verdict = classifyChange(shipped, read, ["packages/a"]);
      assert.equal(verdict.bump, false, String(reason));
      assert.match(verdict.reason, reason);
    }
  });

  describe("in a git repository", () => {
    const dirs = [];
    after(() => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    // A repository with one package at 0.0.0 on `main`, plus `baseFiles`, and a `work` branch checked out for the
    // change under test.
    function repo(baseFiles = {}) {
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
      for (const [file, text] of Object.entries(baseFiles)) write(file, text);
      git("add", "-A");
      git("commit", "-qm", "base");
      git("switch", "-qc", "work");
      const commit = () => {
        git("add", "-A");
        git("commit", "-qm", "change");
      };
      return { dir, write, commit };
    }

    function gate(dir, stamps = []) {
      const calls = [];
      const code = runGate({
        root: dir,
        base: "main",
        stamps,
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

    const changeset = '---\n"@x/a": patch\n---\n\nFix a thing.\n';

    test("the Version packages pull request passes in pre mode without a new changeset", () => {
      // What release.yml's version job pushes to changeset-release/main: the package moves to the next alpha, its
      // changeset moves into .changeset/pre/, and no top-level changeset is added.
      const { dir, write, commit } = repo({
        ".changeset/pre.json": JSON.stringify({ mode: "pre", tag: "alpha" }),
        "packages/a/package.json": manifest("0.1.0-alpha.0"),
        "packages/a/CHANGELOG.md": "## 0.1.0-alpha.0\n\n- first\n",
        ".changeset/brave-cats.md": changeset,
      });
      write("packages/a/package.json", manifest("0.1.0-alpha.1"));
      write("packages/a/CHANGELOG.md", "## 0.1.0-alpha.1\n\n- Fix a thing.\n\n## 0.1.0-alpha.0\n\n- first\n");
      rmSync(path.join(dir, ".changeset/brave-cats.md"));
      write(".changeset/pre/brave-cats.md", changeset);
      commit();
      assert.deepEqual(gate(dir), { code: 0, calls: [] });
    });

    test("a src/ change with a changeset runs changeset status, whose failure fails the gate", () => {
      const { dir, write, commit } = repo();
      write("packages/a/src/index.ts", "export const a = 2;\n");
      write(".changeset/brave-cats.md", changeset);
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: ["main"] });
    });

    test("a src/ change without a top-level changeset fails without running changeset status", () => {
      const { dir, write, commit } = repo();
      write("packages/a/src/index.ts", "export const a = 2;\n");
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: [] });
    });

    test("an edit to a consumed changeset in .changeset/pre/ doesn't release a src/ change", () => {
      // changeset status counts the pre/ edit as this change's changeset, but changeset version never consumes it
      // again, so the src/ change would merge and never publish.
      const { dir, write, commit } = repo({ ".changeset/pre/first-release.md": changeset });
      write(".changeset/pre/first-release.md", `${changeset}A typo fixed.\n`);
      write("packages/a/src/index.ts", "export const a = 2;\n");
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: [] });
    });

    test("a changeset that names only a package Changesets skips doesn't release a src/ change", () => {
      const { dir, write, commit } = repo();
      write("packages/a/src/index.ts", "export const a = 2;\n");
      write(".changeset/manual.md", '---\n"@x/manual": patch\n---\n\nA private app.\n');
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: [] });
    });

    test("a bump that also changes src/ needs a changeset like any other change", () => {
      const { dir, write, commit } = repo();
      write("packages/a/package.json", manifest("0.1.0"));
      write("packages/a/CHANGELOG.md", "## 0.1.0\n\n- first\n");
      write("packages/a/src/index.ts", "export const a = 2;\n");
      commit();
      assert.deepEqual(gate(dir), { code: 1, calls: [] });
      write(".changeset/brave-cats.md", changeset);
      commit();
      assert.deepEqual(gate(dir).calls, ["main"]);
    });

    test("a changed defaults hash fails with only an empty changeset, and passes on to status with a real one", () => {
      const hash = (digit) => `export const DEFAULTS_HASH = "${digit.repeat(64)}";\n`;
      const stamps = [{ file: "packages/a/src/defaults.ts", pattern: RELEASE_STAMPS[0].pattern }];
      const { dir, write, commit } = repo({ "packages/a/src/defaults.ts": hash("0") });
      write("packages/a/src/defaults.ts", hash("1"));
      write(".changeset/quiet-dogs.md", "---\n---\n");
      commit();
      assert.deepEqual(gate(dir, stamps), { code: 1, calls: [] });
      write(".changeset/brave-cats.md", changeset);
      commit();
      assert.deepEqual(gate(dir, stamps), { code: 1, calls: ["main"] });
    });

    test("a changed defaults hash isn't covered by an edit to a changeset already pending on main", () => {
      const hash = (digit) => `export const DEFAULTS_HASH = "${digit.repeat(64)}";\n`;
      const stamps = [{ file: "packages/a/src/defaults.ts", pattern: RELEASE_STAMPS[0].pattern }];
      const { dir, write, commit } = repo({
        "packages/a/src/defaults.ts": hash("0"),
        ".changeset/brave-cats.md": changeset,
      });
      write("packages/a/src/defaults.ts", hash("1"));
      write(".changeset/brave-cats.md", `${changeset}\nReworded.\n`);
      commit();
      assert.deepEqual(gate(dir, stamps), { code: 1, calls: [] });
    });

    test("a defaults hash the gate can't read fails it", () => {
      const stamps = [{ file: "packages/a/src/defaults.ts", pattern: RELEASE_STAMPS[0].pattern }];
      const { dir, write, commit } = repo({
        "packages/a/src/defaults.ts": `export const DEFAULTS_HASH = "${"0".repeat(64)}";\n`,
      });
      write("packages/a/src/defaults.ts", `export const DEFAULTS_HASH: string = "${"1".repeat(64)}";\n`);
      write(".changeset/quiet-dogs.md", "---\n---\n");
      commit();
      assert.deepEqual(gate(dir, stamps), { code: 1, calls: [] });
    });

    test("an empty changeset still covers a src/ change that leaves the defaults hash alone", () => {
      const stamps = [{ file: "packages/a/src/defaults.ts", pattern: RELEASE_STAMPS[0].pattern }];
      const { dir, write, commit } = repo({
        "packages/a/src/defaults.ts": `export const DEFAULTS_HASH = "${"0".repeat(64)}";\n`,
      });
      write("packages/a/src/index.ts", "export const a = 2;\n");
      write(".changeset/quiet-dogs.md", "---\n---\n");
      commit();
      assert.deepEqual(gate(dir, stamps), { code: 1, calls: ["main"] });
    });

    // agent-safety, the protocol, the harness and the CLI were private until L11. Once `private` is gone, a change to
    // any shipped file of theirs needs a changeset, as the gateway's and the SDK's always have.
    test("a formerly private package's src/, package.json and tsconfig.build.json need a changeset once it is public", () => {
      // Each shipped file's text before and after the change; `hidden` keeps the package private on both sides.
      const p = (hidden, extra = {}) =>
        `${JSON.stringify({ name: "@x/p", version: "0.0.0", ...(hidden ? { private: true } : {}), ...extra })}\n`;
      const files = {
        "packages/p/src/index.ts": () => ["export const p = 1;\n", "export const p = 2;\n"],
        "packages/p/package.json": (hidden) => [p(hidden), p(hidden, { description: "now with one" })],
        "packages/p/tsconfig.build.json": () => [
          '{ "compilerOptions": {} }\n',
          '{ "compilerOptions": { "strict": true } }\n',
        ],
      };
      for (const [file, sides] of Object.entries(files)) {
        // While it is private, the gate doesn't count it, and the change goes straight to changeset status.
        const [hiddenBefore, hiddenAfter] = sides(true);
        const hidden = repo({ "packages/p/package.json": p(true), [file]: hiddenBefore });
        hidden.write(file, hiddenAfter);
        hidden.commit();
        assert.deepEqual(gate(hidden.dir), { code: 1, calls: ["main"] }, `${file} while private`);

        const [before, after] = sides(false);
        const shown = repo({ "packages/p/package.json": p(false), [file]: before });
        shown.write(file, after);
        shown.commit();
        assert.deepEqual(gate(shown.dir), { code: 1, calls: [] }, `${file} without a changeset`);
        shown.write(".changeset/first-p.md", '---\n"@x/p": minor\n---\n\nThe first release of p.\n');
        shown.commit();
        assert.deepEqual(gate(shown.dir), { code: 1, calls: ["main"] }, `${file} with a changeset`);
      }
    });

    test("an uncommitted bump in the working tree doesn't count", () => {
      const { dir, write } = repo();
      write("packages/a/package.json", manifest("0.1.0"));
      write("packages/a/CHANGELOG.md", "## 0.1.0\n\n- first\n");
      // The committed side has no shipped change, so the gate goes straight to changeset status.
      assert.deepEqual(gate(dir), { code: 1, calls: ["main"] });
    });
  });
});
