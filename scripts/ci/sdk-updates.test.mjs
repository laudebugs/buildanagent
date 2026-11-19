// Offline tests for sdk-updates.mjs and sdk-updates.yml: the version choice, the check on an update's change, the
// workflow's shape, which must keep its token away from the job that runs the new releases, and open-pr's steps run
// against a local bare repository with a stand-in gh. Nothing here touches the network. Run with
// `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { FAKE_GH } from "./fake-gh.mjs";
import { lockfileProblems, manifestProblems, newestEligible, parseBumps, updateProblems } from "./sdk-updates.mjs";

const NOW = Date.parse("2026-11-19T00:00:00Z");
const times = {
  "1.0.0": "2026-10-01T00:00:00Z",
  "1.1.0": "2026-11-01T00:00:00Z",
  "1.2.0": "2026-11-18T00:00:00Z",
  "2.0.0-beta.1": "2026-11-02T00:00:00Z",
  "0.9.0-beta.2": "2026-11-03T00:00:00Z",
  "0.9.0-beta.1": "2026-10-03T00:00:00Z",
};
const versions = Object.keys(times);

test("picks the newest stable release at least seven days old", () => {
  assert.deepEqual(newestEligible("1.0.0", versions, times, NOW), { version: "1.1.0", published: times["1.1.0"] });
});

test("skips a release younger than seven days", () => {
  assert.equal(newestEligible("1.1.0", versions, times, NOW), undefined);
});

test("a stable pin never moves to a prerelease", () => {
  assert.equal(newestEligible("1.1.0", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("a prerelease pin may move to a newer stable release or a prerelease of its own major", () => {
  assert.equal(newestEligible("0.9.0-beta.1", versions, times, NOW)?.version, "1.1.0");
  assert.equal(newestEligible("0.9.0-beta.1", ["0.9.0-beta.2"], times, NOW)?.version, "0.9.0-beta.2");
  assert.equal(newestEligible("0.9.0-beta.1", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("an unparseable pin is left alone", () => {
  assert.equal(newestEligible("latest", versions, times, NOW), undefined);
});

test("skips a deprecated release", () => {
  assert.equal(newestEligible("1.0.0", versions, times, NOW, new Set(["1.1.0"])), undefined);
});

describe("updateProblems", () => {
  const entry = (status, file, dstMode = "100644") => ({ status, path: file, dstMode });

  test("accepts the harness's pins, its results and the lockfile", () => {
    const entries = [
      entry("M", "verify/pi/package.json"),
      entry("M", "pnpm-lock.yaml"),
      entry("M", "verify/pi/results/run-docs.json"),
      entry("A", "verify/pi/results/new.json"),
      entry("D", "verify/pi/results/old.json", "000000"),
    ];
    assert.deepEqual(updateProblems(entries, "pi"), []);
  });

  test("refuses any other path, including another harness, the workflows and the scripts", () => {
    for (const file of [
      "verify/langchain/package.json",
      "verify/pi/scripts/verify.mjs",
      "verify/pi-extra/results/run.json",
      "verify/pi/results/",
      "scripts/ci/version-commit.mjs",
      ".github/workflows/ci.yml",
      "package.json",
    ]) {
      const [problem] = updateProblems([entry("M", file)], "pi");
      assert.match(problem ?? "", /an update may edit only verify\/pi\/package\.json and pnpm-lock\.yaml/, file);
    }
  });

  test("refuses adding or deleting the pins or the lockfile, and renames, copies and type changes", () => {
    assert.equal(updateProblems([entry("D", "pnpm-lock.yaml", "000000")], "pi").length, 1);
    assert.equal(updateProblems([entry("A", "verify/pi/package.json")], "pi").length, 1);
    for (const status of ["R", "C", "T"]) {
      assert.match(updateProblems([entry(status, "verify/pi/results/a.json")], "pi")[0], /only additions, edits/);
    }
  });

  test("refuses executable files and symbolic links, which createCommitOnBranch can't write", () => {
    for (const mode of ["100755", "120000", "160000"]) {
      const [problem] = updateProblems([entry("A", "verify/pi/results/run.sh", mode)], "pi");
      assert.match(problem, new RegExp(`regular, non-executable file \\(mode ${mode}\\)`));
    }
  });

  test("refuses an empty change and a harness name that isn't one", () => {
    assert.deepEqual(updateProblems([], "pi"), ["the change is empty"]);
    for (const name of ["", "../pi", "pi/x", "Pi", "-pi"]) {
      assert.match(updateProblems([entry("M", "pnpm-lock.yaml")], name)[0], /isn't a harness name/);
    }
  });
});

describe("parseBumps and manifestProblems", () => {
  const before = `${JSON.stringify({ name: "verify-pi", scripts: { verify: "node v.mjs" }, dependencies: { "@s/a": "1.0.0", b: "2.0.0" } }, null, 2)}\n`;
  const bumped = (change) => {
    const manifest = JSON.parse(before);
    change(manifest);
    return `${JSON.stringify(manifest, null, 2)}\n`;
  };
  const bumps = parseBumps("@s/a@1.1.0");

  test("reads the plan's bumps and refuses anything else", () => {
    assert.deepEqual(parseBumps("@s/a@1.1.0 b@2.0.1-beta.1"), [
      { name: "@s/a", version: "1.1.0" },
      { name: "b", version: "2.0.1-beta.1" },
    ]);
    for (const bad of ["", "b", "b@latest", "@s/a", "B@1.0.0", "../x@1.0.0"]) assert.throws(() => parseBumps(bad), bad);
  });

  test("accepts exactly apply's rewrite with the planned versions", () => {
    assert.deepEqual(
      manifestProblems(
        before,
        bumped((m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" })),
        bumps,
      ),
      [],
    );
  });

  test("refuses a version the plan didn't choose, a new script, dependency, override or pnpm setting", () => {
    for (const change of [
      (m) => Object.assign(m.dependencies, { "@s/a": "1.2.0" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0", b: "2.0.1" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0", evil: "1.0.0" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" }) && Object.assign(m.scripts, { postinstall: "x" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" }) && Object.assign(m, { pnpm: { overrides: {} } }),
    ]) {
      assert.match(manifestProblems(before, bumped(change), bumps)[0] ?? "", /changes more than the planned versions/);
    }
    assert.match(manifestProblems(before, before, parseBumps("c@1.0.0"))[0], /c isn't a dependency to bump/);
  });
});

// A small lockfile in pnpm's v9 layout: the root importer, the harness's and another harness's.
const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      typescript:
        specifier: 7.0.2
        version: 7.0.2

  verify/other:
    dependencies:
      sdk-x:
        specifier: 3.0.0
        version: 3.0.0(peer@1.0.0)

  verify/pi:
    dependencies:
      pi-ai:
        specifier: 1.0.0
        version: 1.0.0(peer@1.0.0)

packages:

  peer@1.0.0:
    resolution: {integrity: sha512-cGVlcjE=}

  pi-ai@1.0.0:
    resolution: {integrity: sha512-cGktYWkx}
    peerDependencies:
      peer: ^1.0.0 || ^2.0.0

  sdk-x@3.0.0:
    resolution: {integrity: sha512-c2RrLXg=}
    deprecated: Use your platform's sdk-y instead

  typescript@7.0.2:
    resolution: {integrity: sha512-dHM=}
    hasBin: true

snapshots:

  peer@1.0.0: {}

  pi-ai@1.0.0(peer@1.0.0):
    dependencies:
      peer: 1.0.0

  sdk-x@3.0.0(peer@1.0.0):
    dependencies:
      peer: 1.0.0

  typescript@7.0.2: {}
`;

describe("lockfileProblems", () => {
  // pi-ai 1.1.0 needs peer 2, which pnpm then shares with verify/other.
  const BUMPED = LOCK.replace(
    "specifier: 1.0.0\n        version: 1.0.0(peer@1.0.0)",
    "specifier: 1.1.0\n        version: 1.1.0(peer@2.0.0)",
  )
    .replace("version: 3.0.0(peer@1.0.0)", "version: 3.0.0(peer@2.0.0)")
    .replace(
      "  pi-ai@1.0.0:\n    resolution: {integrity: sha512-cGktYWkx}\n",
      "  peer@2.0.0:\n    resolution: {integrity: sha512-cGVlcjI=}\n    deprecated: |-\n      Use peer 3; it's: #faster\n\n  pi-ai@1.1.0:\n    resolution: {integrity: sha512-cGktYWky}\n",
    )
    .replace(
      "  pi-ai@1.0.0(peer@1.0.0):",
      "  pi-ai@1.1.0(peer@2.0.0):\n    dependencies:\n      peer: 2.0.0\n\n  sdk-x@3.0.0(peer@2.0.0):",
    );

  test("accepts a bump: the harness's pins, a peer another harness shares, and new or removed entries", () => {
    assert.deepEqual(lockfileProblems(LOCK, BUMPED, "pi"), []);
  });

  test("accepts the repository's own lockfile with any of its entries new", () => {
    const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    for (const parity of [0, 1]) {
      let section = "";
      let n = 0;
      let skip = false;
      const lines = lock.split("\n").filter((line) => {
        if (/^\S/.test(line)) [section, skip] = [line, false];
        else if (/^(packages|snapshots):$/.test(section) && /^ {2}\S/.test(line)) skip = n++ % 2 === parity;
        return !skip;
      });
      assert.deepEqual(lockfileProblems(lines.join("\n"), lock, "pi"), []);
    }
  });

  for (const [name, edit, message] of [
    ["changes the root importer", (t) => t.replace("version: 7.0.2\n", "version: 7.0.3\n"), /changes the \. importer/],
    [
      "changes another harness's pin",
      (t) => t.replace("specifier: 3.0.0", "specifier: 3.0.1"),
      /more of the verify\/other importer/,
    ],
    [
      "changes another harness's resolved version",
      (t) => t.replace("version: 3.0.0(", "version: 3.0.1("),
      /verify\/other/,
    ],
    [
      "changes the harness's importer beyond its pins",
      (t) => t.replace("      pi-ai:\n", "      pi-ai:\n        optional: true\n"),
      /more of the verify\/pi importer/,
    ],
    [
      "adds an importer",
      (t) => t.replace("\npackages:", "  verify/new: {}\n\npackages:"),
      /adds, removes or reorders an importer/,
    ],
    ["changes settings", (t) => t.replace("autoInstallPeers: true", "autoInstallPeers: false"), /changes settings/],
    [
      "adds overrides",
      (t) => t.replace("\nimporters:", "\noverrides:\n  typescript: 9.9.9\n\nimporters:"),
      /sections changed/,
    ],
    [
      "rewrites an existing package",
      (t) => t.replace("sha512-dHM=", "sha512-ZXZpbA=="),
      /changes packages typescript@7\.0\.2/,
    ],
    [
      "rewrites an existing snapshot",
      (t) => t.replace("  typescript@7.0.2: {}", "  typescript@7.0.2:\n    dependencies:\n      evil: 1.0.0"),
      /changes snapshots typescript@7\.0\.2/,
    ],
    [
      "respells an existing package to list it twice",
      (t) =>
        t.replace("\nsnapshots:", '  "typescript@7.0.2":\n    resolution: {integrity: sha512-ZXZpbA==}\n\nsnapshots:'),
      /isn't an entry pnpm writes/,
    ],
    [
      "lists a package twice",
      (t) =>
        t.replace("\nsnapshots:", "  typescript@7.0.2:\n    resolution: {integrity: sha512-ZXZpbA==}\n\nsnapshots:"),
      /lists typescript@7\.0\.2 twice/,
    ],
    [
      "adds a package from a tarball URL",
      (t) =>
        t.replace(
          "\nsnapshots:",
          "  evil@1.0.0:\n    resolution: {tarball: https://example.invalid/e.tgz}\n\nsnapshots:",
        ),
      /evil@1\.0\.0 doesn't resolve from the npm registry/,
    ],
    [
      "opens a quote that swallows the next entry",
      (t) => t.replace("    hasBin: true", "    hasBin: 'true"),
      /isn't an entry|holds a line pnpm doesn't write|changes packages/,
    ],
    [
      "adds an alias",
      (t) =>
        t.replace(
          "\nsnapshots:",
          "  evil@1.0.0:\n    resolution: {integrity: sha512-ZXZpbA==}\n    x: *a\n\nsnapshots:",
        ),
      /evil@1\.0\.0 holds a line pnpm doesn't write/,
    ],
    [
      "opens a flow mapping across lines",
      (t) => t.replace("\nsnapshots:", "  evil@1.0.0:\n    resolution: {integrity: sha512-ZXZpbA==\n\nsnapshots:"),
      /holds a line pnpm doesn't write|doesn't resolve/,
    ],
    [
      "indents a line by three",
      (t) => t.replace("\nsnapshots:", "  evil@1.0.0:\n   x: 1\n\nsnapshots:"),
      /badly indented/,
    ],
    [
      "points the harness's dependency at a local path",
      (t) => t.replace("version: 1.1.0(peer@2.0.0)", "version: link:results/evil"),
      /verify\/pi importer points a dependency at something other than a registry version/,
    ],
    [
      "points another harness's peer at a local path",
      (t) => t.replace("version: 3.0.0(peer@2.0.0)", "version: 3.0.0(peer@file:x)"),
      /verify\/other importer points a dependency/,
    ],
    [
      "gives a new snapshot a local dependency",
      (t) => t.replace("      peer: 2.0.0", "      peer: link:../../verify/pi/results"),
      /snapshot pi-ai@1\.1\.0\(peer@2\.0\.0\) depends on something other than a registry version/,
    ],
    ["uses a tab", (t) => t.replace("hasBin: true", "hasBin:\ttrue"), /tab or a carriage return/],
  ]) {
    test(`refuses a lockfile that ${name}`, () => {
      const after = edit(BUMPED);
      assert.notEqual(after, BUMPED, "the edit applies");
      assert.match(lockfileProblems(LOCK, after, "pi").join("\n"), message);
    });
  }
});

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowText = readFileSync(path.join(root, ".github/workflows/sdk-updates.yml"), "utf8");
const workflow = parse(workflowText);
const { jobs } = workflow;

describe("sdk-updates.yml", () => {
  test("only open-pr's last step reads a secret, a personal access token, and the run's own token only reads", () => {
    const readers = [];
    for (const [name, job] of Object.entries(jobs)) {
      if (JSON.stringify({ ...job, steps: undefined }).includes("secrets.")) readers.push(`${name} (job)`);
      job.steps.forEach((step, i) => {
        if (JSON.stringify(step).includes("secrets.")) readers.push(`${name} step ${i}`);
      });
    }
    assert.deepEqual(readers, [`open-pr step ${jobs["open-pr"].steps.length - 1}`]);
    assert.equal(
      jobs["open-pr"].steps.at(-1).env.GH_TOKEN,
      `\${{ secrets.SDK_UPDATES_TOKEN || secrets.RELEASE_PR_TOKEN }}`,
    );
    // GITHUB_TOKEN would open a pull request whose CI runs wait for someone's approval.
    assert.doesNotMatch(workflowText, /github\.token|secrets\.GITHUB_TOKEN/);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    for (const [name, job] of Object.entries(jobs)) {
      assert.ok(job.permissions === undefined || JSON.stringify(job.permissions) === '{"contents":"read"}', name);
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout")) assert.equal(step.with?.["persist-credentials"], false, name);
      }
    }
  });

  test("no run step expands an expression, so no matrix or event field can be injected into a script", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) assert.doesNotMatch(step.run ?? "", /\$\{\{/, `${name}: ${step.name ?? step.run}`);
    }
  });

  test("the update job, which runs the new releases, holds no token", () => {
    const { update } = jobs;
    for (const step of update.steps) {
      for (const key of Object.keys(step.env ?? {})) assert.doesNotMatch(key, /TOKEN|AUTH/i, step.name);
    }
    assert.equal(update.env, undefined);
  });

  test("open-pr runs no third-party code, checks the patch before the token step, and never turns on auto-merge", () => {
    const job = jobs["open-pr"];
    assert.doesNotMatch(JSON.stringify(job), /\bpnpm\b|\bnpx\b|node_modules|\bnpm\b|\byarn\b|corepack/);
    const uses = job.steps.filter((s) => s.uses).map((s) => s.uses.replace(/@.*/, ""));
    assert.deepEqual(uses, ["actions/checkout", "actions/download-artifact"]);
    const [, , commit, push] = job.steps;
    assert.equal(commit.env, undefined, "the step that checks the patch holds no token");
    assert.match(commit.run, /git apply --cached --binary/);
    assert.doesNotMatch(commit.run, /--index/);
    const nodeCalls = job.steps.flatMap((s) => (s.run ?? "").match(/\bnode\b.*$/gm) ?? []);
    assert.deepEqual(nodeCalls, [
      'node scripts/ci/sdk-updates.mjs check "$HARNESS" "$base" HEAD "$BUMPS"',
      'node scripts/ci/version-commit.mjs --replace-own-only "$BASE" HEAD "$branch" "deps/staging/sdk-$HARNESS"',
    ]);
    assert.equal(job.env.BUMPS, `\${{ matrix.bumps }}`, "the check compares the patch with the plan's bumps");
    assert.doesNotMatch(push.run, /summary\.md|SUMMARY/, "the pull request's body is the one the commit step wrote");
    assert.equal(push.if, "steps.commit.outputs.changed == 'true'");
    assert.doesNotMatch(push.run, /git push|x-access-token|gh pr merge|--auto/);
    assert.ok(push.run.indexOf("version-commit.mjs") < push.run.indexOf("gh pr list"));
  });

  test("the update job writes the plan's bumps rather than asking the registry again", () => {
    const step = jobs.update.steps.find((s) => /sdk-updates\.mjs apply/.test(s.run ?? ""));
    assert.equal(step.run, 'node scripts/ci/sdk-updates.mjs apply "$HARNESS" "$BUMPS" > bumps.md');
    assert.equal(step.env.BUMPS, `\${{ matrix.bumps }}`);
  });

  test("runs only from main, and opens the other harnesses' pull requests when one harness's update fails", () => {
    assert.equal(jobs.plan.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(jobs.update.needs, "plan");
    assert.equal(
      jobs["open-pr"].if,
      `\${{ !cancelled() && needs.plan.result == 'success' && needs.plan.outputs.any == 'true' }}`,
    );
  });

  test("sdk-updates.mjs and version-commit.mjs import nothing but node: modules and the scripts beside them", () => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(path.join(root, "scripts/ci", file), "utf8");
      for (const [, spec] of text.matchAll(/^import [^;]*?from "([^"]+)";/gms)) {
        if (spec.startsWith("node:")) continue;
        assert.match(spec, /^\.\/[a-z-]+\.mjs$/, `${file} imports ${spec}`);
        visit(spec.slice(2));
      }
      assert.doesNotMatch(text, /\bimport\(/, `${file} has a dynamic import`);
    };
    visit("sdk-updates.mjs");
    visit("version-commit.mjs");
    assert.deepEqual([...seen].sort(), [
      "changeset-gate.mjs",
      "release-plan.mjs",
      "sdk-updates.mjs",
      "version-commit.mjs",
      "version-pr.mjs",
    ]);
  });
});

// These tests run open-pr's own shell scripts, taken from sdk-updates.yml, in a temp folder. The fake gh from
// fake-gh.mjs acts on a local bare repository that stands for the one on GitHub, so nothing touches the network.
describe("sdk-updates.yml's open-pr steps, run for real", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const harness = "pi";
  const branch = "deps/sdk-pi";
  const staging = "deps/staging/sdk-pi";
  const job = jobs["open-pr"];
  const title = job.env.TITLE.replace(`\${{ matrix.harness }}`, harness);
  const bumps = "pi-ai@1.1.0";
  const manifest = (version) =>
    `${JSON.stringify({ name: "verify-pi", dependencies: { "pi-ai": version } }, null, 2)}\n`;

  // A main with one harness and the CI scripts, pushed to a bare remote, and a checkout of it as open-pr's checkout is.
  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), "sdk-updates-steps-"));
    dirs.push(dir);
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), FAKE_GH);
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(path.join(dir, "gitconfig"), "[user]\n\tname = test\n\temail = test@example.invalid\n");
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: dir,
      LANG: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
    };
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    };
    write("verify/pi/package.json", manifest("1.0.0"));
    write("verify/pi/results/run-docs.json", '{"pass":1}\n');
    write("verify/pi/results/old.json", "{}\n");
    write("pnpm-lock.yaml", LOCK);
    for (const script of ["sdk-updates.mjs", "version-pr.mjs", "changeset-gate.mjs", "release-plan.mjs"]) {
      write(`scripts/ci/${script}`, readFileSync(path.join(root, "scripts/ci", script), "utf8"));
    }
    write("scripts/ci/version-commit.mjs", readFileSync(path.join(root, "scripts/ci/version-commit.mjs"), "utf8"));
    git(work, "add", "-A");
    git(work, "commit", "-qm", "main");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "-q", "origin", "main");
    return { dir, remote, work, env, git, write };
  }

  // Writes the update job's artifact: the patch, made the way its step makes it, and the summary.
  function artifact(repo, change) {
    const update = path.join(repo.dir, "runner", "update");
    mkdirSync(update, { recursive: true });
    change(repo);
    repo.git(repo.work, "add", "-A");
    const patch = execFileSync("git", ["diff", "--cached", "--binary"], { cwd: repo.work, env: repo.env });
    writeFileSync(path.join(update, "update.patch"), patch);
    writeFileSync(path.join(update, "summary.md"), "| `pi-ai` | 1.0.0 | 1.1.0 | 2026-11-01 |\n");
    repo.git(repo.work, "reset", "-q", "--hard");
  }
  const bump = ({ write }) => {
    write("verify/pi/package.json", manifest("1.1.0"));
    write("verify/pi/results/run-docs.json", '{"pass":2}\n');
    write(
      "pnpm-lock.yaml",
      LOCK.replace("specifier: 1.0.0\n        version: 1.0.0", "specifier: 1.1.0\n        version: 1.1.0"),
    );
  };

  // Runs open-pr's commit step in a fresh clone of main, then its token step when the commit step says there is a change.
  function runOpenPr(repo, extraEnv = {}) {
    const clone = path.join(repo.dir, `pr-${Math.random().toString(36).slice(2)}`);
    repo.git(repo.dir, "clone", "-q", "-b", "main", repo.remote, clone);
    const runner = path.join(repo.dir, "runner");
    const output = path.join(repo.dir, "commit-output");
    writeFileSync(output, "");
    const log = path.join(repo.dir, "gh-log");
    writeFileSync(log, "");
    const [, , commit, push] = job.steps;
    const env = {
      ...repo.env,
      HARNESS: harness,
      BUMPS: bumps,
      TITLE: title,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: output,
    };
    const commitRun = spawnSync("bash", ["-e", "-c", commit.run], { cwd: clone, env, encoding: "utf8" });
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    if (commitRun.status !== 0 || outputs.changed !== "true") return { commit: commitRun, outputs, gh: [], clone };
    const pushRun = spawnSync("bash", ["-e", "-c", push.run], {
      cwd: clone,
      env: {
        ...env,
        GH_TOKEN: "secret",
        REPO: "o/r",
        BASE: outputs.base,
        GH_LOG: log,
        FAKE_REMOTE: repo.remote,
        ...extraEnv,
      },
      encoding: "utf8",
    });
    const gh = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { commit: commitRun, push: pushRun, outputs, gh, clone };
  }
  const ref = (repo, name) => {
    try {
      return repo.git(repo.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`);
    } catch {
      return "";
    }
  };
  const signed = (repo) => {
    const file = path.join(repo.remote, "signed");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };
  const prCalls = (gh) => gh.filter((call) => !call.startsWith("api "));

  test("makes the update commit through the API, verified, and opens a pull request without auto-merge", () => {
    const repo = setup();
    const main = ref(repo, "main");
    artifact(repo, (r) => {
      bump(r);
      rmSync(path.join(r.work, "verify/pi/results/old.json"));
    });
    const run = runOpenPr(repo);
    assert.equal(run.commit.status, 0, run.commit.stderr);
    assert.equal(run.push.status, 0, run.push.stderr);
    const head = ref(repo, branch);
    assert.deepEqual(signed(repo), [head], "the branch holds the commit made through createCommitOnBranch");
    assert.equal(repo.git(repo.remote, "rev-parse", `${head}^{tree}`), repo.git(run.clone, "rev-parse", "HEAD^{tree}"));
    assert.equal(repo.git(repo.remote, "rev-parse", `${head}^`), main);
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%s", head), title);
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%b", head), "Bumps verify/pi to pi-ai@1.1.0.");
    const body = readFileSync(path.join(repo.dir, "runner", "body.md"), "utf8");
    assert.match(body, /^Bumps `verify\/pi` to `pi-ai@1\.1\.0`\. The plan job chose these releases/);
    assert.match(body, /a malicious release could have rewritten it\.\n\n\| `pi-ai` \| 1\.0\.0 \| 1\.1\.0 \|/);
    assert.equal(ref(repo, staging), "", "the staging branch is deleted");
    assert.equal(ref(repo, "main"), main, "main stays as it was");
    const calls = prCalls(run.gh);
    assert.equal(calls.length, 2);
    assert.match(
      calls[0],
      /^pr list --repo o\/r --head deps\/sdk-pi --base main --state open --json number,isCrossRepository/,
    );
    assert.match(calls[0], /select\(\.isCrossRepository \| not\)/, "a fork's branch of the same name doesn't count");
    assert.match(
      calls[1],
      /^pr create --repo o\/r --base main --head deps\/sdk-pi --title chore\(deps\): update the pi.* --body-file .*body\.md$/,
    );
    assert.ok(!run.gh.some((call) => /pr merge/.test(call)), "auto-merge stays off");
  });

  test("a rerun on the same main changes nothing and updates the open pull request", () => {
    const repo = setup();
    artifact(repo, bump);
    assert.equal(runOpenPr(repo).push.status, 0);
    const head = ref(repo, branch);
    const run = runOpenPr(repo, { EXISTING_PR: "42" });
    assert.equal(run.push.status, 0, run.push.stderr);
    assert.equal(ref(repo, branch), head);
    assert.deepEqual(signed(repo), [head]);
    assert.match(run.push.stdout, /already holds the checked commit, verified/);
    assert.match(prCalls(run.gh).at(-1), /^pr edit 42 --repo o\/r --title chore\(deps\)/);
  });

  for (const [name, change, message] of [
    [
      "rewrites the script that makes the commit",
      (r) => {
        bump(r);
        r.write("scripts/ci/version-commit.mjs", "steal();\n");
      },
      /M scripts\/ci\/version-commit\.mjs: an update may edit only/,
    ],
    ["edits a workflow", (r) => r.write(".github/workflows/ci.yml", "on: push\n"), /A \.github\/workflows\/ci\.yml/],
    [
      "adds a script to the harness's package.json",
      (r) => {
        bump(r);
        r.write(
          "verify/pi/package.json",
          manifest("1.1.0").replace('"name"', '"scripts": { "postinstall": "steal" },\n  "name"'),
        );
      },
      /verify\/pi\/package\.json: changes more than the planned versions \(pi-ai@1\.1\.0\)/,
    ],
    [
      "moves the root's tools in the lockfile",
      (r) => {
        bump(r);
        r.write(
          "pnpm-lock.yaml",
          readFileSync(path.join(r.work, "pnpm-lock.yaml"), "utf8").replace("version: 7.0.2\n", "version: 7.0.3\n"),
        );
      },
      /pnpm-lock\.yaml: changes the \. importer/,
    ],
    [
      "adds an executable file",
      (r) => {
        r.write("verify/pi/results/run.sh", "#!/bin/sh\n");
        chmodSync(path.join(r.work, "verify/pi/results/run.sh"), 0o755);
      },
      /mode 100755/,
    ],
  ]) {
    test(`refuses a patch that ${name}, before any token step`, () => {
      const repo = setup();
      artifact(repo, change);
      const run = runOpenPr(repo);
      assert.notEqual(run.commit.status, 0);
      assert.match(run.commit.stderr, message);
      assert.equal(run.push, undefined);
      assert.deepEqual(run.gh, []);
      assert.equal(ref(repo, branch), "");
    });
  }

  test("refuses to drop a commit someone pushed to the update branch, and leaves its pull request alone", () => {
    const repo = setup();
    artifact(repo, bump);
    assert.equal(runOpenPr(repo).push.status, 0);
    // A maintainer re-mirrors the docs on the pull request's branch.
    const pushed = path.join(repo.dir, "maintainer");
    repo.git(repo.dir, "clone", "-q", "-b", branch, repo.remote, pushed);
    writeFileSync(path.join(pushed, "notes.md"), "re-mirrored\n");
    repo.git(pushed, "add", "-A");
    repo.git(pushed, "commit", "-qm", "docs(pi): re-mirror the docs at the new tag");
    repo.git(pushed, "push", "-q", "origin", branch);
    const head = ref(repo, branch);
    // main moves on, so the next run's checked commit differs from the branch's.
    repo.write("verify/pi/results/later.json", "{}\n");
    repo.git(repo.work, "add", "-A");
    repo.git(repo.work, "commit", "-qm", "later");
    repo.git(repo.work, "push", "-q", "origin", "main");
    artifact(repo, bump);
    const run = runOpenPr(repo, { EXISTING_PR: "42" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stderr, /isn't a commit this workflow made, so deps\/sdk-pi stays as it was/);
    assert.equal(ref(repo, branch), head);
    assert.deepEqual(prCalls(run.gh), []);
  });

  test("fails, leaving the update branch and the pull request alone, when GitHub doesn't verify the commit", () => {
    const repo = setup();
    artifact(repo, bump);
    const run = runOpenPr(repo, { UNVERIFIED: "1" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stderr, /didn't verify the signature/);
    assert.equal(ref(repo, branch), "");
    assert.equal(ref(repo, staging), "");
    assert.deepEqual(prCalls(run.gh), []);
  });

  test("fails before any call when neither token is set", () => {
    const repo = setup();
    artifact(repo, bump);
    const run = runOpenPr(repo, { GH_TOKEN: "" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stdout, /Neither SDK_UPDATES_TOKEN nor RELEASE_PR_TOKEN is set/);
    assert.deepEqual(run.gh, []);
  });

  test("an empty patch opens nothing", () => {
    const repo = setup();
    artifact(repo, () => {});
    const run = runOpenPr(repo);
    assert.equal(run.commit.status, 0, run.commit.stderr);
    assert.equal(run.outputs.changed, "false");
    assert.deepEqual(run.gh, []);
  });
});
