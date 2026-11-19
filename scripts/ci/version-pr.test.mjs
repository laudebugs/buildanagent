// Offline checks for the "Version packages" pull request: scripts/ci/version-pr.mjs, which decides what a version
// commit may change, and .github/workflows/auto-merge-guard.yml, which lets only that pull request auto-merge. The
// last tests trace what happens when this checkout reaches main: they run the real `changeset version` on a copy of
// it. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { runGate, statusEnv } from "./changeset-gate.mjs";
import {
  needsVersion,
  pendingChangesets,
  planRelease,
  preModeMismatch,
  readPreState,
  versionedPackageNames,
} from "./release-plan.mjs";
import {
  checkVersionChange,
  gitChange,
  guardDecision,
  parseRawDiff,
  prBody,
  prTitle,
  RELEASE_BRANCH,
} from "./version-pr.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const guardText = readFileSync(path.join(root, ".github/workflows/auto-merge-guard.yml"), "utf8");
const guard = parse(guardText);
const release = parse(readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

// A git repository whose main holds two packages at 0.1.0-alpha.0 in alpha pre mode and one pending changeset, with
// a `work` branch checked out. `version()` makes the commit `changeset version` would.
function repo({ pre = { mode: "pre", tag: "alpha" } } = {}) {
  const dir = temp("version-pr-");
  const env = { PATH: process.env.PATH, HOME: dir, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" });
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  for (const pkg of ["gateway", "sdk"]) {
    write(`packages/${pkg}/package.json`, manifest(pkg, "0.1.0-alpha.0"));
    write(`packages/${pkg}/CHANGELOG.md`, `# @buildanagent/${pkg}\n\n## 0.1.0-alpha.0\n\n- first\n`);
    write(`packages/${pkg}/src/index.ts`, "export {};\n");
  }
  write("packages/manual/package.json", JSON.stringify({ name: "@buildanagent/manual", private: true }));
  write(".changeset/config.json", JSON.stringify({ changedFilePatterns: ["src/**", "package.json"] }));
  write(".changeset/pre.json", JSON.stringify(pre));
  write(".changeset/brave-cats.md", '---\n"@buildanagent/gateway": minor\n---\n\nBreaking Changes: a thing.\n');
  write(".changeset/pre/first.md", '---\n"@buildanagent/gateway": minor\n---\n\nFirst.\n');
  // main's scripts, which the guard runs.
  for (const script of ["release-plan.mjs", "changeset-gate.mjs", "version-pr.mjs"]) {
    write(`scripts/ci/${script}`, readFileSync(path.join(root, "scripts/ci", script), "utf8"));
  }
  git("add", "-A");
  git("commit", "-qm", "base");
  git("switch", "-qc", "work");
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "change");
  };
  const version = (next = "0.1.0-alpha.1") => {
    for (const pkg of ["gateway", "sdk"]) {
      write(`packages/${pkg}/package.json`, manifest(pkg, next));
      const log = readFileSync(path.join(dir, `packages/${pkg}/CHANGELOG.md`), "utf8");
      write(`packages/${pkg}/CHANGELOG.md`, log.replace("\n\n", `\n\n## ${next}\n\n- a thing\n\n`));
    }
    git("mv", ".changeset/brave-cats.md", ".changeset/pre/brave-cats.md");
  };
  const check = () => {
    const { entries, read, packages } = gitChange(dir, "main", "HEAD");
    return checkVersionChange(entries, read, packages);
  };
  return { dir, git, write, commit, version, check };
}

function manifest(pkg, version, extra = {}) {
  return `${JSON.stringify({ name: `@buildanagent/${pkg}`, version, ...extra }, null, 2)}\n`;
}

describe("version-pr.mjs", () => {
  test("parses git's raw diff, with a move as a deletion and an addition", () => {
    const blob = "a".repeat(40);
    const zero = "0".repeat(40);
    const text = `:100644 000000 ${blob} ${zero} D\0.changeset/x.md\0:000000 100644 ${zero} ${blob} A\0.changeset/pre/x.md\0`;
    assert.deepEqual(parseRawDiff(text), [
      { status: "D", srcMode: "100644", dstMode: "000000", srcBlob: blob, dstBlob: zero, path: ".changeset/x.md" },
      { status: "A", srcMode: "000000", dstMode: "100644", srcBlob: zero, dstBlob: blob, path: ".changeset/pre/x.md" },
    ]);
    assert.deepEqual(parseRawDiff(""), []);
    assert.throws(() => parseRawDiff("garbage\0x\0"), /can't read/);
  });

  test("accepts the commit changeset version makes in pre mode", () => {
    const r = repo();
    r.version();
    r.commit();
    const result = r.check();
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.version, "0.1.0-alpha.1");
    assert.equal(result.bumped, true);
    assert.deepEqual(result.consumed, ["brave-cats.md"]);
    assert.equal(prTitle(result), "chore(release): version packages to 0.1.0-alpha.1");
  });

  test("refuses every change a version commit doesn't make", () => {
    const cases = [
      ["a source edit", (r) => r.write("packages/gateway/src/index.ts", "steal();\n"), /src\/index\.ts: a version/],
      ["a workflow", (r) => r.write(".github/workflows/x.yml", "on: push\n"), /x\.yml: a version commit doesn't/],
      ["a lockfile", (r) => r.write("pnpm-lock.yaml", "x\n"), /pnpm-lock\.yaml/],
      [
        "a dependency",
        (r) => r.write("packages/sdk/package.json", manifest("sdk", "0.1.0-alpha.1", { dependencies: { x: "1" } })),
        /not a version bump: packages\/sdk\/package\.json changed in more than its version/,
      ],
      [
        "an edited changeset on its move",
        (r) => r.write(".changeset/pre/brave-cats.md", "---\n---\n\nRewritten.\n"),
        /must be \.changeset\/brave-cats\.md, moved without a change/,
      ],
      [
        "an edit to a consumed changeset",
        (r) => r.write(".changeset/pre/first.md", "---\n---\n\nRewritten.\n"),
        /M \.changeset\/pre\/first\.md/,
      ],
      ["a deleted pre.json in pre mode", (r) => r.git("rm", "-q", ".changeset/pre.json"), /D \.changeset\/pre\.json/],
      ["an executable", (r) => chmodSync(path.join(r.dir, "packages/sdk/CHANGELOG.md"), 0o755), /mode 100755/],
      ["an unhidden package", (r) => r.write("packages/manual/package.json", manifest("manual", "1.0.0")), /manual/],
      [
        "a private package's version",
        (r) => r.write("packages/manual/package.json", manifest("manual", "0.0.1", { private: true })),
        /M packages\/manual\/package\.json: a version commit doesn't change this file/,
      ],
    ];
    for (const [name, edit, reason] of cases) {
      const r = repo();
      r.version();
      edit(r);
      r.commit();
      const result = r.check();
      assert.equal(result.ok, false, name);
      assert.match(result.problems.join("\n"), reason, name);
    }
  });

  test("refuses a bump that splits the group, moves back or leaves the pre mode", () => {
    for (const [next, reason] of [
      ["0.1.0", /isn't a alpha prerelease/],
      ["0.0.9-alpha.0", /moved back/],
    ]) {
      const r = repo();
      r.version(next);
      r.commit();
      assert.match(r.check().problems.join("\n"), reason, next);
    }
    const r = repo();
    r.version();
    r.write("packages/sdk/package.json", manifest("sdk", "0.1.0-alpha.0"));
    r.commit();
    assert.match(r.check().problems.join("\n"), /leaves out packages\/sdk/);
  });

  test("refuses changelog edits without a bump, and a change that consumes nothing", () => {
    const r = repo();
    r.write("packages/gateway/CHANGELOG.md", "# rewritten\n");
    r.commit();
    const problems = r.check().problems.join("\n");
    assert.match(problems, /changelogs changed without a version bump/);
    assert.match(problems, /consumes no changeset/);
  });

  test("accepts consuming empty changesets without a bump, titled as such", () => {
    const r = repo();
    r.write(".changeset/brave-cats.md", "---\n---\n");
    r.commit();
    r.git("switch", "-q", "main");
    r.git("merge", "-q", "--ff-only", "work");
    r.git("switch", "-qc", "next");
    r.git("mv", ".changeset/brave-cats.md", ".changeset/pre/brave-cats.md");
    r.commit();
    const { entries, read, packages } = gitChange(r.dir, "main", "HEAD");
    const result = checkVersionChange(entries, read, packages);
    assert.deepEqual(result.problems, []);
    assert.equal(result.bumped, false);
    assert.equal(prTitle(result), "chore(release): consume changesets that bump no package");
  });

  test("accepts leaving pre mode, which deletes pre.json and the consumed changesets", () => {
    const r = repo({ pre: { mode: "exit", tag: "alpha" } });
    for (const pkg of ["gateway", "sdk"]) {
      r.write(`packages/${pkg}/package.json`, manifest(pkg, "0.1.0"));
      r.write(`packages/${pkg}/CHANGELOG.md`, `## 0.1.0\n\n- stable\n`);
    }
    r.git("rm", "-q", ".changeset/pre.json", ".changeset/pre/first.md", ".changeset/brave-cats.md");
    r.commit();
    const result = r.check();
    assert.deepEqual(result.problems, []);
    assert.equal(result.version, "0.1.0");
  });

  test("writes a body that lists each consumed changeset", () => {
    const body = prBody({
      version: "0.1.0-alpha.1",
      bumped: true,
      distTag: "alpha",
      changesets: [
        { name: "a.md", text: '---\n"@buildanagent/gateway": minor\n---\n\nBreaking Changes: x.\n\nMore.\n' },
        { name: "b.md", text: "---\n---\n" },
      ],
    });
    assert.match(body, /0\.1\.0-alpha\.1 to npm under the `alpha` dist-tag/);
    assert.match(body, /^- `a\.md` \("@buildanagent\/gateway": minor\): Breaking Changes: x\.$/m);
    assert.match(body, /^- `b\.md` \(no package\): \(no summary\)$/m);
  });

  test("the guard lets only changeset-release/main in this repository, into main, keep auto-merge", () => {
    const repoName = "laudebugs/buildanagent";
    const pr = (overrides) =>
      guardDecision({ headRef: RELEASE_BRANCH, headRepo: repoName, repo: repoName, baseRef: "main", ...overrides });
    assert.equal(pr({}).release, true);
    assert.match(pr({ headRef: "feature" }).reason, /head branch is feature/);
    assert.match(pr({ headRepo: "someone/buildanagent" }).reason, /head is in someone\/buildanagent/);
    assert.match(pr({ headRepo: undefined }).reason, /another repository/);
    assert.match(pr({ baseRef: "release" }).reason, /merges into release/);
    for (const overrides of [{ headRef: "feature" }, { headRepo: "x/y" }, { baseRef: "dev" }]) {
      assert.equal(pr(overrides).release, false);
    }
  });
});

describe("auto-merge-guard.yml", () => {
  const { jobs } = guard;
  const [checkout, decide] = jobs.guard.steps;
  const [disable] = jobs.disable.steps;

  test("runs when auto-merge is turned on, and again when a pull request with it on changes", () => {
    assert.deepEqual(guard.on, {
      pull_request_target: { types: ["auto_merge_enabled", "synchronize", "edited", "reopened"] },
    });
    assert.deepEqual(guard.permissions, {});
    assert.deepEqual(Object.keys(jobs), ["guard", "disable"]);
    // Auto-merge stays on when someone with write access pushes or changes the base, so those events are checked too.
    assert.equal(
      jobs.guard.if,
      "github.event.action == 'auto_merge_enabled' || github.event.pull_request.auto_merge != null",
    );
  });

  test("holds only GITHUB_TOKEN, never checks out the pull request's code, and writes only in a job that runs gh", () => {
    assert.deepEqual(jobs.guard.permissions, { contents: "read" });
    // GitHub lets people with write access to the repository turn auto-merge off.
    assert.deepEqual(jobs.disable.permissions, { contents: "write", "pull-requests": "write" });
    assert.equal(jobs.disable.steps.length, 1);
    assert.equal(disable.uses, undefined);
    assert.doesNotMatch(disable.run, /\bnode\b|\bgit\b/);
    assert.doesNotMatch(guardText, /secrets\./);
    assert.equal(disable.env.GH_TOKEN, `\${{ github.token }}`);
    assert.match(checkout.uses, /^actions\/checkout@/);
    // No `ref`: pull_request_target checks out the base branch's latest commit.
    assert.deepEqual(checkout.with, { "fetch-depth": 0, "persist-credentials": false });
    assert.equal(jobs.guard.steps.filter((s) => s.uses).length, 1);
    // The pull request's commits are fetched as data and read only through git.
    assert.match(decide.run, /git fetch --quiet --no-tags origin "\+\$\{HEAD_SHA\}:refs\/remotes\/pr\/head"/);
    assert.match(decide.run, /^ *node scripts\/ci\/version-pr\.mjs guard origin\/main refs\/remotes\/pr\/head/m);
    assert.doesNotMatch(guardText, /pnpm|npx|npm |node_modules/);
  });

  test("passes pull request fields through env vars, never through an expression in a script", () => {
    for (const step of jobs.guard.steps) assert.doesNotMatch(step.run ?? "", /\$\{\{/, step.name);
    assert.equal(decide.env.HEAD_REF, `\${{ github.event.pull_request.head.ref }}`);
    assert.equal(decide.env.HEAD_REPO, `\${{ github.event.pull_request.head.repo.full_name }}`);
    assert.equal(decide.env.HEAD_SHA, `\${{ github.event.pull_request.head.sha }}`);
  });

  test("turns auto-merge off on anything but a clear keep, a failed check included", () => {
    assert.equal(jobs.disable.needs, "guard");
    assert.equal(
      jobs.disable.if,
      "always() && needs.guard.result != 'skipped' && needs.guard.outputs.action != 'keep'",
    );
    assert.equal(jobs.guard.outputs.action, `\${{ steps.decide.outputs.action }}`);
    assert.match(disable.run, /^gh pr merge "\$NUMBER" --repo "\$REPO" --disable-auto$/m);
    assert.match(decide.run, /set -euo pipefail/);
  });

  // Runs the guard's decide step for real: a bare remote holds main and the pull request's head under
  // refs/pull/7/head, as GitHub keeps it, and the step runs in a clone of main on the event's head commit. With
  // `stale`, refs/pull/7/head still names the commit before the one the event names.
  function runDecide(edit, prEnv, { stale } = {}) {
    const r = repo();
    if (stale) {
      r.version();
      r.commit();
    }
    edit(r);
    r.commit();
    const remote = path.join(r.dir, "..", `${path.basename(r.dir)}-remote.git`);
    dirs.push(remote);
    r.git("init", "-q", "--bare", remote);
    r.git("push", "-q", remote, "main", `${stale ? "work~1" : "work"}:refs/pull/7/head`, "work:refs/heads/later");
    const headSha = r.git("rev-parse", "work").trim();
    const clone = `${remote}-clone`;
    dirs.push(clone);
    r.git("clone", "-q", "-b", "main", remote, clone);
    const output = path.join(clone, "..", `${path.basename(clone)}-output`);
    const summary = `${output}-summary`;
    dirs.push(output, summary);
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", decide.run], {
      cwd: clone,
      env: {
        PATH: process.env.PATH,
        HOME: r.dir,
        GIT_CONFIG_NOSYSTEM: "1",
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        NUMBER: "7",
        HEAD_SHA: headSha,
        HEAD_REF: RELEASE_BRANCH,
        HEAD_REPO: "o/r",
        BASE_REF: "main",
        REPO: "o/r",
        ...prEnv,
      },
      encoding: "utf8",
    });
    const action = /^action=(.*)$/m.exec(readFileSync(output, "utf8"))?.[1];
    return { ...result, action, summary: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
  }

  test("keeps auto-merge on the Version packages pull request when it changes only versions", () => {
    const run = runDecide((r) => r.version(), {});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.action, "keep");
    assert.match(run.summary, /auto-merge stays on/);
    assert.match(run.summary, /Pull request #7: its head is changeset-release\/main in o\/r, and it changes only/);
  });

  test("turns auto-merge off on the release branch when it changes more than versions", () => {
    const run = runDecide((r) => {
      r.version();
      r.write(".github/workflows/release.yml", "on: push\n");
    }, {});
    assert.equal(run.action, "disable");
    assert.match(run.summary, /auto-merge turned off/);
    assert.match(run.summary, /- A \.github\/workflows\/release\.yml: a version commit doesn't change this file/);
  });

  test("turns auto-merge off on any other pull request, whatever it changes", () => {
    for (const env of [{ HEAD_REF: "feature" }, { HEAD_REPO: "fork/r" }, { BASE_REF: "dev" }]) {
      const run = runDecide((r) => r.version(), env);
      assert.equal(run.action, "disable", JSON.stringify(env));
      assert.match(run.summary, /only a pull request from changeset-release\/main into main may auto-merge/);
    }
  });

  test("checks the commit the event names, even when refs/pull/N/head hasn't caught up", () => {
    const run = runDecide((r) => r.write("packages/gateway/src/index.ts", "steal();\n"), {}, { stale: true });
    assert.equal(run.action, "disable");
    assert.match(run.summary, /- M packages\/gateway\/src\/index\.ts: a version commit doesn't change this file/);
  });

  test("leaves no action when the check can't run, so the next job turns auto-merge off", () => {
    const run = runDecide((r) => r.version(), { HEAD_SHA: "0".repeat(40) });
    assert.notEqual(run.status, 0);
    assert.equal(run.action, undefined);
  });
});

// What merging this checkout to main does, traced on the real files. While changesets are pending, the release run
// must version them into a Version packages pull request and publish nothing; this runs the real `changeset version`
// on a copy of the checkout's release files.
describe("this checkout on main", () => {
  const pending = pendingChangesets(root);
  const skip = pending.length === 0 ? "no changeset is pending" : false;

  test("plans a version and no publish, so release.yml opens the pull request instead of publishing", {
    skip,
  }, async () => {
    const plan = await planRelease({ root, fetchImpl: async () => ({ status: 404 }) });
    assert.equal(plan.needsVersion, true);
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /pending/);
    assert.match(release.jobs.version.if, /needs\.plan\.outputs\.needs_version == 'true'/);
    assert.match(release.jobs.pack.if, /needs\.plan\.outputs\.publish == 'true'/);
    assert.match(release.jobs.publish.if, /needs\.pack\.result == 'success'/);
  });

  test("versions only the public packages, never a private one such as agent-safety", () => {
    const { packages } = gitChange(root, "HEAD", "HEAD");
    assert.deepEqual(packages.map((pkg) => pkg.name).sort(), ["@buildanagent/gateway", "@buildanagent/sdk"]);
  });

  test("its real version commit passes the version-pr check and the changeset gate", { skip }, () => {
    const changeset = path.join(root, "node_modules", ".bin", "changeset");
    assert.ok(existsSync(changeset), "run pnpm install first");
    const dir = temp("version-pr-real-");
    // Only the files Changesets reads: the workspace's manifests, the changelogs and .changeset/, plus the pending
    // changesets themselves, which may not be in git yet.
    const tracked = execFileSync(
      "git",
      [
        "ls-files",
        "--",
        "package.json",
        "pnpm-workspace.yaml",
        ".changeset",
        ":(glob)*/*/package.json",
        ":(glob)packages/*/CHANGELOG.md",
        "scripts/ci",
      ],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    const files = [...new Set([...tracked, ...pending.map((name) => `.changeset/${name}`)])];
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), readFileSync(path.join(root, file)));
    }
    const env = { PATH: process.env.PATH, HOME: dir, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1", TMPDIR: tmpdir() };
    const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "main with a pending changeset");
    git("switch", "-qc", RELEASE_BRANCH);
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
    const run = spawnSync(changeset, ["version"], { cwd: dir, env, encoding: "utf8", input: "" });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    rmSync(path.join(dir, "node_modules"));
    git("add", "-A");
    git("commit", "-qm", "version");
    const { entries, read, packages } = gitChange(dir, "main", "HEAD");
    const result = checkVersionChange(entries, read, packages);
    assert.deepEqual(result.problems, []);
    // Changesets leaves private packages, such as agent-safety and manual, alone.
    const versioned = packages.map((pkg) => `${pkg.dir}/`);
    for (const { path: file } of entries.filter((e) => e.path.startsWith("packages/"))) {
      assert.ok(
        versioned.some((dir) => file.startsWith(dir)),
        `changeset version changed ${file}`,
      );
    }
    assert.deepEqual(result.consumed, pending.sort());
    // An empty changeset (`pnpm changeset --empty`, for a change users don't see) bumps nothing, and so does one that
    // gives its packages `none`, so when no pending changeset bumps a package the version commit only consumes them and
    // names no version. Leaving pre mode bumps the prereleases to their plain version even with no changeset.
    const pre = readPreState(root);
    const names = versionedPackageNames(root);
    const bumps =
      pre?.mode === "exit" ||
      pending.some((name) => bumpsAPackage(readFileSync(path.join(root, ".changeset", name), "utf8"), names));
    assert.equal(result.bumped, bumps);
    if (bumps) {
      assert.equal(preModeMismatch(result.version, pre?.mode === "pre" ? pre : undefined), undefined);
      assert.equal(prTitle(result), `chore(release): version packages to ${result.version}`);
    } else {
      assert.equal(prTitle(result), "chore(release): consume changesets that bump no package");
    }
    // The gate in ci.yml passes a bump without a changeset and without running changeset status. A commit that only
    // consumes changesets changes no shipped file, so the gate leaves it to the real `changeset status`, which must pass.
    const calls = [];
    const runStatus = (base) => {
      calls.push(base);
      symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
      try {
        const status = spawnSync(changeset, ["status", `--since=${base}`], {
          cwd: dir,
          env: statusEnv(env, dir),
          encoding: "utf8",
        });
        assert.equal(status.status, 0, status.stderr + status.stdout);
        return status.status;
      } finally {
        rmSync(path.join(dir, "node_modules"));
      }
    };
    const code = runGate({ root: dir, base: "main", log: () => {}, runStatus });
    assert.deepEqual({ code, calls }, { code: 0, calls: bumps ? [] : ["main"] });
    assert.equal(needsVersion(dir), false, "nothing is pending once the pull request merges");
  });
});

/**
 * Whether a changeset releases one of the `versioned` packages, read as Changesets reads it (@changesets/parse): the
 * front matter between the `---` lines is YAML mapping package names to `major`, `minor`, `patch` or `none`, so CRLF,
 * quotes and comments work, and `none` releases nothing.
 */
function bumpsAPackage(text, versioned) {
  const frontMatter = /\s*---([\s\S]*?)\r?\n\s*---(\s*(?:\n|$))/.exec(text)?.[1] ?? "";
  const releases = parse(frontMatter) ?? {};
  return Object.entries(releases).some(([name, type]) => versioned.includes(name) && type !== "none");
}
