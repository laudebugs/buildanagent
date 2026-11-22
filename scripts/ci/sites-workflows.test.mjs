// Offline checks for the two sites' build, deploy and pull-request-closed workflows: docs-build.yml, site-build.yml,
// docs-deploy.yml, site-deploy.yml, docs-pr-closed.yml and site-pr-closed.yml. It reads them from .github/workflows/
// once docs-deploy.yml is there, or else from the directory that SITES_WORKFLOWS_DIR names, or else from
// scripts/ci/site-workflows/, where they wait until the owner commits them; with none of these, every test is skipped. It checks the shape that keeps the Cloudflare
// secrets away from a pull request's code, compares every deploy job's `if:` with the exact text below, then runs the
// resolve, stable-tag, record, delete and comment steps under bash against stand-in `gh` and `pnpm` commands that
// answer from fixtures, so nothing touches the network. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../..", import.meta.url));
const committed = join(root, ".github", "workflows");
// The workflows wait in scripts/ci/site-workflows/ until the owner commits them, because a session may not write
// .github/; the owner moves them with `git mv` and this test then reads the committed copies.
const staged = join(root, "scripts", "ci", "site-workflows");
const dir = existsSync(join(committed, "docs-deploy.yml"))
  ? committed
  : (process.env.SITES_WORKFLOWS_DIR ?? (existsSync(join(staged, "docs-deploy.yml")) ? staged : undefined));
const skip =
  dir === undefined ? "the site workflows are not in .github/workflows/ and SITES_WORKFLOWS_DIR is unset" : false;
const read = (name) => (skip ? {} : parse(readFileSync(join(dir, name), "utf8")));
const SITES = { docs: read("docs-deploy.yml"), site: read("site-deploy.yml") };
const BUILDS = { docs: read("docs-build.yml"), site: read("site-build.yml") };
const CLOSED = { docs: read("docs-pr-closed.yml"), site: read("site-pr-closed.yml") };
const WORKERS = { docs: "buildanagent-docs", site: "buildanagent-site" };
const work = mkdtempSync(join(tmpdir(), "sites-workflows-"));
after(() => rmSync(work, { recursive: true, force: true }));

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const REPO = "owner/repo";

const environmentOf = (job) => (typeof job.environment === "string" ? job.environment : job.environment?.name);
const steps = (job) => job.steps ?? [];
const runs = (workflow) =>
  Object.values(workflow.jobs ?? {}).flatMap((job) => steps(job).map((step) => step.run ?? ""));
const stepNamed = (job, name) => steps(job).find((step) => step.name === name);

// Runs one step's script the way a runner does, with bash -e and only the given environment.
function runStep(script, env) {
  const output = join(mkdtempSync(join(work, "out-")), "output");
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output, ...env },
  });
  const pairs = readFileSync(output, "utf8").split("\n").filter(Boolean);
  return { ...result, outputs: Object.fromEntries(pairs.map((line) => line.split(/=(.*)/s).slice(0, 2))) };
}

// A stand-in for `gh api [--paginate] <path> [--jq <filter>]`: it answers from a fixture named after the path, through
// jq when the call has --jq and as raw JSON when it does not, and fails as an API error would when there is none. It
// logs each path it was asked for, so a test can check that no call was made.
function fakeGh(answers) {
  const home = mkdtempSync(join(work, "gh-"));
  mkdirSync(join(home, "bin"));
  const file = (path) => join(home, path.replace(/[^a-z0-9.]/gi, "_"));
  for (const [path, body] of Object.entries(answers)) writeFileSync(file(path), JSON.stringify(body));
  const gh = join(home, "bin", "gh");
  writeFileSync(
    gh,
    `#!/bin/bash\n[ "$1" = api ] || exit 9\nshift\n[ "$1" = --paginate ] && shift\n` +
      `printf '%s\\n' "$1" >> "${home}/calls"\n` +
      `f="${home}/$(printf '%s' "$1" | tr -c 'a-zA-Z0-9.' '_')"\n[ -f "$f" ] || exit 1\n` +
      `if [ $# -eq 1 ]; then exec cat "$f"; fi\n[ "$2" = --jq ] && [ $# -eq 3 ] || exit 9\nexec jq -r "$3" "$f"\n`,
  );
  chmodSync(gh, 0o755);
  const calls = () =>
    (existsSync(join(home, "calls")) ? readFileSync(join(home, "calls"), "utf8").split("\n") : []).filter(Boolean);
  return { PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}`, calls };
}

describe("the build workflows", { skip }, () => {
  for (const [name, workflow] of Object.entries(BUILDS)) {
    test(`${name}-build runs on pull requests and pushes to main, with read-only contents and no secrets`, () => {
      assert.deepEqual(workflow.on, { push: { branches: ["main"] }, pull_request: null });
      assert.deepEqual(workflow.permissions, { contents: "read" });
      assert.doesNotMatch(JSON.stringify(workflow), /secrets\./);
      assert.ok(Object.values(workflow.jobs).every((job) => job.environment === undefined));
    });

    test(`${name}-build keys its concurrency by ref, so a pull request of ours never cancels main's build`, () => {
      assert.deepEqual(workflow.concurrency, { group: `${name}-build-\${{ github.ref }}`, "cancel-in-progress": true });
    });

    test(`${name}-build uploads only apps/${name}/dist/`, () => {
      const uploads = Object.values(workflow.jobs)
        .flatMap(steps)
        .filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
      assert.deepEqual(
        uploads.map((step) => [step.with.name, step.with.path]),
        [[`${name}-dist`, `apps/${name}/dist/`]],
      );
    });
  }
});

describe("the pull-request-closed workflows", { skip }, () => {
  for (const [name, workflow] of Object.entries(CLOSED)) {
    test(`${name}-pr-closed runs on a closed pull request, holds nothing and runs no action`, () => {
      assert.deepEqual(workflow.on, { pull_request: { types: ["closed"] } });
      assert.equal(workflow.name, `${name}-pr-closed`);
      assert.deepEqual(workflow.permissions, {});
      assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|environment|uses|permissions":\{"/);
      assert.deepEqual(Object.keys(workflow.jobs), ["closed"]);
    });
  }
});

// Every deploy job's condition, exactly. A changed condition must change this table too, so a review sees it.
const PUSH = (name) => [
  `github.event.workflow_run.name == '${name}-build'`,
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_repository.full_name == github.repository",
  "github.event.workflow_run.head_branch == 'main'",
];
const CONDITIONS = {
  docs: {
    resolve:
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success') || " +
      "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')",
    secrets: "needs.resolve.outputs.target != 'none' && github.ref == 'refs/heads/main'",
    "build-release": "github.event_name == 'workflow_dispatch' && needs.resolve.outputs.target == 'release'",
    production: [
      "!cancelled()",
      "github.ref == 'refs/heads/main'",
      "vars.DOCS_DEPLOY_ENABLED == 'true'",
      "needs.secrets.outputs.present == 'true'",
      `((github.event_name == 'workflow_run' && ${PUSH("docs").join(" && ")} && ` +
        "needs.resolve.outputs.target == 'production') || (github.event_name == 'workflow_dispatch' && " +
        "needs.resolve.outputs.target == 'release' && needs.build-release.result == 'success'))",
    ].join(" && "),
    next: [
      "github.ref == 'refs/heads/main'",
      "github.event_name == 'workflow_run'",
      ...PUSH("docs"),
      "vars.DOCS_DEPLOY_ENABLED == 'true'",
      "needs.resolve.outputs.target == 'next'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    preview: [
      "github.ref == 'refs/heads/main'",
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.name == 'docs-build'",
      "github.event.workflow_run.event == 'pull_request'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "needs.resolve.outputs.target == 'previews'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    "delete-preview": [
      "github.ref == 'refs/heads/main'",
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.name == 'docs-pr-closed'",
      "github.event.workflow_run.event == 'pull_request'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "needs.resolve.outputs.target == 'deletions'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    comment: [
      "!cancelled()",
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.name == 'docs-build'",
      "github.event.workflow_run.event == 'pull_request'",
      "needs.resolve.result == 'success'",
      "needs.resolve.outputs.target == 'previews'",
    ].join(" && "),
    "comment-deleted": [
      "!cancelled()",
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.name == 'docs-pr-closed'",
      "github.event.workflow_run.event == 'pull_request'",
      "needs.resolve.result == 'success'",
      "needs.resolve.outputs.target == 'deletions'",
    ].join(" && "),
  },
  site: {
    resolve: "github.event.workflow_run.conclusion == 'success'",
    secrets: "needs.resolve.outputs.target != 'none'",
    production: [
      ...PUSH("site"),
      "vars.SITE_DEPLOY_ENABLED == 'true'",
      "needs.resolve.outputs.target == 'production'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    preview: [
      "github.event.workflow_run.name == 'site-build'",
      "github.event.workflow_run.event == 'pull_request'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "needs.resolve.outputs.target == 'previews'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    "delete-preview": [
      "github.event.workflow_run.name == 'site-pr-closed'",
      "github.event.workflow_run.event == 'pull_request'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "needs.resolve.outputs.target == 'deletions'",
      "needs.secrets.outputs.present == 'true'",
    ].join(" && "),
    comment: [
      "!cancelled()",
      "github.event.workflow_run.name == 'site-build'",
      "github.event.workflow_run.event == 'pull_request'",
      "needs.resolve.result == 'success'",
      "needs.resolve.outputs.target == 'previews'",
    ].join(" && "),
    "comment-deleted": [
      "!cancelled()",
      "github.event.workflow_run.name == 'site-pr-closed'",
      "github.event.workflow_run.event == 'pull_request'",
      "needs.resolve.result == 'success'",
      "needs.resolve.outputs.target == 'deletions'",
    ].join(" && "),
  },
};
// Folded YAML keeps the line breaks inside the parentheses as spaces; compare with single spaces.
const condition = (job) => job.if.replace(/\s+/g, " ").replace(/\( /g, "(").trim();

describe("the deploy workflows", { skip }, () => {
  for (const [name, workflow] of Object.entries(SITES)) {
    const jobs = Object.entries(workflow.jobs ?? {});

    test(`${name}-deploy starts only after ${name}-build or ${name}-pr-closed${name === "docs" ? ", or from a dispatch with a tag" : ""}`, () => {
      assert.deepEqual(workflow.on.workflow_run, {
        workflows: [`${name}-build`, `${name}-pr-closed`],
        types: ["completed"],
      });
      assert.deepEqual(
        Object.keys(workflow.on),
        name === "docs" ? ["workflow_run", "workflow_dispatch"] : ["workflow_run"],
      );
      if (name === "docs") {
        const { inputs } = workflow.on.workflow_dispatch;
        assert.deepEqual(Object.keys(inputs), ["tag"]);
        assert.equal(inputs.tag.required, true);
        assert.equal(inputs.tag.type, "string");
      }
      assert.deepEqual(workflow.permissions, {});
    });

    test(`${name}-deploy: every job's condition is exactly the expected one`, () => {
      assert.deepEqual(Object.keys(workflow.jobs).sort(), Object.keys(CONDITIONS[name]).sort());
      for (const [id, job] of jobs) assert.equal(condition(job), CONDITIONS[name][id], id);
    });

    test(`${name}-deploy: every job sets its own permissions and runs on the pinned runner`, () => {
      for (const [id, job] of jobs) {
        assert.ok(job.permissions !== undefined, id);
        assert.equal(job["runs-on"], "ubuntu-24.04", id);
        assert.ok(job["timeout-minutes"] > 0, id);
      }
    });

    test(`${name}-deploy: only jobs in the cloudflare environment read a secret, and every one of them waits for the secrets check`, () => {
      for (const [id, job] of jobs) {
        const usesSecrets = /secrets\./.test(JSON.stringify(job));
        if (job.environment === undefined) assert.ok(!usesSecrets, `${id} reads a secret outside the environment`);
        else {
          assert.equal(environmentOf(job), "cloudflare", id);
          if (id !== "secrets") assert.ok([job.needs].flat().includes("secrets"), `${id} must need the secrets job`);
        }
      }
    });

    test(`${name}-deploy: a Cloudflare secret reaches only the steps that run Wrangler`, () => {
      for (const [id, job] of jobs.filter(([key]) => key !== "secrets")) {
        for (const step of steps(job).filter((step) => /secrets\./.test(JSON.stringify(step)))) {
          assert.match(step.run, /pnpm exec wrangler /, `${id}: ${step.name}`);
          assert.equal(step.env.GH_TOKEN, undefined, `${id}: ${step.name}`);
        }
      }
    });

    test(`${name}-deploy: jobs with a secret check out only main and never write to GitHub`, () => {
      for (const [id, job] of jobs.filter(([, job]) => job.environment !== undefined)) {
        for (const step of steps(job).filter((step) => step.uses?.startsWith("actions/checkout@"))) {
          assert.equal(step.with.ref, "main", id);
          assert.equal(step.with["persist-credentials"], false, id);
        }
        assert.ok(!Object.values(job.permissions).includes("write"), id);
      }
    });

    test(`${name}-deploy: no run script interpolates an expression; values arrive through env`, () => {
      for (const script of runs(workflow)) assert.doesNotMatch(script, /\$\{\{/);
    });

    test(`${name}-deploy: no deploy is cancelled mid-way, and a preview and its deletion share one queue`, () => {
      for (const [id, job] of jobs.filter(([, job]) => job.concurrency)) {
        assert.equal(job.concurrency["cancel-in-progress"], false, id);
      }
      const group = `${name}-preview-pr-\${{ matrix.number }}`;
      assert.equal(workflow.jobs.preview.concurrency.group, group);
      assert.equal(workflow.jobs["delete-preview"].concurrency.group, group);
      // A push and a release must not share a group: a waiting run is replaced by the next, and a release's must not be.
      assert.equal(
        workflow.jobs.production.concurrency.group,
        name === "docs" ? `docs-production-\${{ github.event_name }}` : "site-production",
      );
    });

    test(`${name}-deploy: the comment jobs hold only pull-requests: write and no environment`, () => {
      for (const id of ["comment", "comment-deleted"]) {
        const job = workflow.jobs[id];
        assert.deepEqual(job.permissions, { "pull-requests": "write" }, id);
        assert.equal(job.environment, undefined, id);
        assert.ok(!steps(job).some((step) => step.uses?.startsWith("actions/checkout@")), id);
      }
      assert.equal(
        workflow.jobs.comment.steps.at(-1).run,
        workflow.jobs["comment-deleted"].steps.at(-1).run,
        "both comment jobs run one script",
      );
      assert.equal(workflow.jobs.comment.steps.at(-1).env.MODE, "preview");
      assert.equal(workflow.jobs["comment-deleted"].steps.at(-1).env.MODE, "deleted");
    });

    test(`${name}-deploy: the preview runs wrangler preview with main's config and the pull request number from resolve`, () => {
      const { preview } = workflow.jobs;
      assert.equal(preview.strategy.matrix.number, `\${{ fromJSON(needs.resolve.outputs.previews) }}`);
      assert.ok(runs({ jobs: { preview } }).some((script) => /wrangler preview --config wrangler\.toml/.test(script)));
    });

    test(`${name}-deploy: the deletion checks out main, downloads no artifact and takes its number from resolve`, () => {
      const job = workflow.jobs["delete-preview"];
      assert.equal(job.strategy.matrix.number, `\${{ fromJSON(needs.resolve.outputs.deletions) }}`);
      assert.deepEqual(job.permissions, { contents: "read" });
      assert.ok(!steps(job).some((step) => step.uses?.startsWith("actions/download-artifact@")));
    });
  }

  test("docs-deploy builds a release only from the resolved commit, with no environment", () => {
    const job = SITES.docs.jobs["build-release"];
    assert.equal(job.environment, undefined);
    assert.deepEqual(job.permissions, { contents: "read" });
    const checkout = steps(job).find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, `\${{ needs.resolve.outputs.sha }}`);
  });

  test("docs-deploy sends next only to --env next, marked noindex", () => {
    const scripts = runs({ jobs: { next: SITES.docs.jobs.next } }).join("\n");
    assert.match(scripts, /--noindex/);
    assert.match(scripts, /wrangler deploy --config wrangler\.toml --env next/);
  });

  test("docs-deploy's production checks the tag and main's tip before a push's deploy, and a release always deploys", () => {
    const job = SITES.docs.jobs.production;
    const names = steps(job).map((step) => step.name);
    const before = names.indexOf("Check that no stable release exists yet");
    const newest = names.indexOf("Check that this commit is still main's newest");
    const deploy = names.indexOf("Deploy");
    const ended = names.indexOf("Record when the deploy ended");
    const afterDeploy = names.indexOf("Check that no release deployed during this deploy");
    assert.ok(
      before >= 0 && before < newest && newest === deploy - 1 && ended === deploy + 1 && afterDeploy === ended + 1,
      names.join(", "),
    );
    assert.equal(steps(job)[before].if, "github.event_name == 'workflow_run'");
    assert.equal(steps(job)[newest].if, "github.event_name == 'workflow_run'");
    assert.equal(
      steps(job)[deploy].if.replace(/\s+/g, " ").trim(),
      "github.event_name == 'workflow_dispatch' || " +
        "(steps.unreleased.outputs.deploy == 'true' && steps.newest.outputs.deploy == 'true')",
    );
    for (const at of [ended, afterDeploy]) {
      assert.equal(steps(job)[at].if, "github.event_name == 'workflow_run' && steps.deploy.outcome == 'success'");
    }
    assert.equal(steps(job)[deploy].id, "deploy");
    assert.equal(steps(job)[ended].id, "ended");
    assert.equal(steps(job)[afterDeploy].env.STARTED, `\${{ steps.unreleased.outputs.started }}`);
    assert.equal(steps(job)[afterDeploy].env.ENDED, `\${{ steps.ended.outputs.ended }}`);
  });

  // The check finds release deploys by their job's and step's names, so a rename must fail here, not switch it off.
  test("docs-deploy's release check names production's own job and Deploy step, through env only", () => {
    const job = SITES.docs.jobs.production;
    const step = stepNamed(job, "Check that no release deployed during this deploy");
    assert.equal(step.env.JOB_NAME, job.name);
    assert.equal(step.env.STEP_NAME, steps(job).find((each) => each.id === "deploy").name);
    assert.match(step.run, /--arg job "\$JOB_NAME" --arg step "\$STEP_NAME"/);
    assert.match(step.run, /select\(\.name == \$job\)/);
    assert.match(step.run, /select\(\.name == \$step and /);
    assert.ok(!step.run.includes(job.name), "the job's name must come from env");
  });

  test("docs-deploy's next and site-deploy's production check main's tip just before they deploy", () => {
    for (const job of [SITES.docs.jobs.next, SITES.site.jobs.production]) {
      const names = steps(job).map((step) => step.name);
      const newest = names.indexOf("Check that this commit is still main's newest");
      assert.ok(newest >= 0 && names[newest + 1] === "Deploy", names.join(", "));
      assert.equal(steps(job)[newest + 1].if, "steps.newest.outputs.deploy == 'true'");
    }
  });

  test("every preview checks its pull request just before it deploys, and reads pull requests only", () => {
    for (const workflow of Object.values(SITES)) {
      const job = workflow.jobs.preview;
      const names = steps(job).map((step) => step.name);
      const open = names.indexOf("Check that the pull request is still open at this commit");
      const late = "Delete the preview of a pull request that closed meanwhile";
      assert.ok(open >= 0 && names[open + 1] === late && names[open + 2] === "Deploy the preview", names.join(", "));
      assert.doesNotMatch(JSON.stringify(steps(job)[open]), /secrets\./);
      // The same script as the deletion job's, so both validate the number and run one Wrangler command.
      assert.equal(stepNamed(job, late).if, "steps.open.outputs.delete == 'true'");
      assert.equal(stepNamed(job, late).run, stepNamed(workflow.jobs["delete-preview"], "Delete the preview").run);
      assert.equal(
        stepNamed(job, late)["working-directory"],
        stepNamed(workflow.jobs["delete-preview"], "Delete the preview")["working-directory"],
      );
      assert.deepEqual(stepNamed(job, late).env, stepNamed(workflow.jobs["delete-preview"], "Delete the preview").env);
      for (const name of ["Deploy the preview", "Record the preview's URLs"]) {
        assert.equal(stepNamed(job, name).if, "steps.open.outputs.deploy == 'true'", name);
      }
      assert.equal(job.permissions["pull-requests"], "read");
    }
  });

  test("every action is one the lock already holds at that tag", () => {
    const lock = readFileSync(join(committed, "actions.lock"), "utf8");
    for (const workflow of [...Object.values(SITES), ...Object.values(BUILDS), ...Object.values(CLOSED)]) {
      for (const job of Object.values(workflow.jobs)) {
        for (const step of steps(job).filter((step) => step.uses)) {
          assert.ok(lock.includes(`'${step.uses}':`), `${step.uses} is not in actions.lock's dependencies`);
        }
      }
    }
  });
});

const pull = (number, { state = "open", sha = SHA, head = REPO, base = REPO } = {}) => ({
  number,
  state,
  head: { sha, repo: { full_name: head } },
  base: { repo: { full_name: base } },
});
const CLOSED_PATH = "repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100";

for (const name of ["docs", "site"]) {
  describe(`the ${name} resolve step`, { skip }, () => {
    const step = skip ? {} : SITES[name].jobs.resolve.steps[0];
    const dispatchEnv = name === "docs" ? { EVENT_NAME: "workflow_run" } : {};
    const run = (env, answers = {}) => {
      const gh = fakeGh(answers);
      const result = runStep(step.run, {
        PATH: gh.PATH,
        REPO,
        ...dispatchEnv,
        WORKFLOW: `${name}-build`,
        EVENT: "pull_request",
        HEAD_SHA: SHA,
        HEAD_REPO: REPO,
        HEAD_BRANCH: "feature",
        ...env,
      });
      return { ...result, calls: gh.calls() };
    };
    const push = (answers) => run({ EVENT: "push", HEAD_BRANCH: "main" }, answers);
    const tags = name === "docs" ? { "repos/owner/repo/git/matching-refs/tags/v": [] } : {};

    test("reads every event value from env, set from the workflow_run payload", () => {
      assert.equal(step.env.WORKFLOW, `\${{ github.event.workflow_run.name }}`);
      assert.equal(step.env.HEAD_REPO, `\${{ github.event.workflow_run.head_repository.full_name }}`);
      assert.equal(step.env.HEAD_SHA, `\${{ github.event.workflow_run.head_sha }}`);
    });

    test("a push of main's newest commit deploys production", () => {
      const result = push({ "repos/owner/repo/commits/main": { sha: SHA }, ...tags });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "production");
    });

    test("a push that is no longer main's newest commit deploys nothing", () => {
      const result = push({ "repos/owner/repo/commits/main": { sha: OTHER }, ...tags });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "none");
      assert.match(result.stdout, /no longer main's newest commit/);
    });

    test("a push whose main lookup fails deploys nothing", () => {
      const result = push({});
      assert.notEqual(result.status, 0);
      assert.notEqual(result.outputs.target, "production");
    });

    test("a push from a fork's branch named main deploys nothing and calls no API", () => {
      const result = run({ EVENT: "push", HEAD_REPO: "fork/repo", HEAD_BRANCH: "main" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "none");
      assert.deepEqual(result.calls, []);
    });

    test("a push reported by the closed workflow deploys nothing", () => {
      const result = run({ WORKFLOW: `${name}-pr-closed`, EVENT: "push", HEAD_BRANCH: "main" });
      assert.equal(result.outputs.target, "none");
      assert.deepEqual(result.calls, []);
    });

    test("a pull request from this repository previews only open pull requests from a branch of it", () => {
      const pulls = [
        pull(7, { head: "fork/repo" }),
        pull(8),
        pull(9, { state: "closed" }),
        pull(10, { sha: OTHER }),
        pull(11, { base: "other/repo" }),
      ];
      const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "previews");
      assert.equal(result.outputs.previews, "[8]");
      assert.equal(result.outputs.deletions, "[]");
    });

    test("a fork's pull request gets no preview and calls no API", () => {
      const result = run(
        { HEAD_REPO: "fork/repo" },
        { [`repos/owner/repo/commits/${SHA}/pulls`]: [pull(7, { head: "fork/repo" })] },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual([result.outputs.target, result.outputs.previews], ["none", "[]"]);
      assert.match(result.stdout, /fork's pull request/);
      assert.deepEqual(result.calls, []);
    });

    test("a run whose fork was deleted, with no head repository, deploys nothing", () => {
      const result = run({ HEAD_REPO: "" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "none");
    });

    for (const headRepo of ['owner/repo") or true or ("', "owner/repo\nx", "owner", "a/b/c", "own er/repo"]) {
      test(`refuses the head repository ${JSON.stringify(headRepo)} before any API call`, () => {
        const result = run({ HEAD_REPO: headRepo });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /not an owner\/name pair/);
        assert.deepEqual(result.calls, []);
      });
    }

    test("refuses a head SHA that is not a commit SHA", () => {
      const result = run({ HEAD_SHA: `${SHA}\nx` });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
    });

    test("a closed pull request from a branch of this repository is deleted; open and fork pull requests are not", () => {
      const pulls = [
        pull(7, { state: "closed" }),
        pull(8, { state: "closed", head: "fork/repo" }),
        pull(9),
        pull(10, { state: "closed", sha: OTHER }),
      ];
      const result = run({ WORKFLOW: `${name}-pr-closed` }, { [CLOSED_PATH]: pulls });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        [result.outputs.target, result.outputs.deletions, result.outputs.previews],
        ["deletions", "[7]", "[]"],
      );
    });

    test("a fork's closed pull request deletes nothing and calls no API", () => {
      const result = run(
        { WORKFLOW: `${name}-pr-closed`, HEAD_REPO: "fork/repo" },
        { [CLOSED_PATH]: [pull(8, { state: "closed", head: "fork/repo" })] },
      );
      assert.equal(result.outputs.target, "none");
      assert.deepEqual(result.calls, []);
    });

    test("a closed pull request with no match deletes nothing", () => {
      const result = run({ WORKFLOW: `${name}-pr-closed` }, { [CLOSED_PATH]: [] });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.target, "none");
    });

    test("a pull request lookup that fails deploys nothing", () => {
      const result = run({});
      assert.notEqual(result.status, 0);
      assert.notEqual(result.outputs.target, "previews");
    });
  });
}

describe("the docs' dispatch and next", { skip }, () => {
  const TAG_OBJECT = "c".repeat(40);
  const step = skip ? {} : SITES.docs.jobs.resolve.steps[0];
  const run = (env, answers = {}) => runStep(step.run, { PATH: fakeGh(answers).PATH, REPO, ...env });
  const dispatch = (tag, answers) => run({ EVENT_NAME: "workflow_dispatch", TAG: tag }, answers);
  const push = (answers) =>
    run(
      {
        EVENT_NAME: "workflow_run",
        WORKFLOW: "docs-build",
        EVENT: "push",
        HEAD_SHA: SHA,
        HEAD_REPO: REPO,
        HEAD_BRANCH: "main",
      },
      answers,
    );

  test("takes the tag from inputs through env only", () => {
    assert.equal(step.env.TAG, `\${{ inputs.tag }}`);
  });

  test("a dispatch of a lightweight stable tag on main resolves to its commit", () => {
    const result = dispatch("v0.1.0", {
      "repos/owner/repo/git/ref/tags/v0.1.0": { object: { type: "commit", sha: SHA } },
      [`repos/owner/repo/compare/${SHA}...main`]: { status: "ahead" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { target: "release", previews: "[]", deletions: "[]", sha: SHA });
  });

  test("a dispatch of an annotated tag follows it to its commit", () => {
    const result = dispatch("v1.2.3", {
      "repos/owner/repo/git/ref/tags/v1.2.3": { object: { type: "tag", sha: TAG_OBJECT } },
      [`repos/owner/repo/git/tags/${TAG_OBJECT}`]: { object: { type: "commit", sha: SHA } },
      [`repos/owner/repo/compare/${SHA}...main`]: { status: "identical" },
    });
    assert.equal(result.outputs.sha, SHA, result.stderr);
  });

  for (const tag of ["v0.1.0-alpha.0", "0.1.0", "v01.0.0", "v0.1.0\n", "v0.1.0; rm -rf /", "../v0.1.0", ""]) {
    test(`a dispatch refuses the tag ${JSON.stringify(tag)} before any API call`, () => {
      const result = dispatch(tag, {});
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /must be a stable release tag/);
    });
  }

  test("a dispatch refuses a tag that main does not contain, or that does not exist", () => {
    const diverged = dispatch("v0.2.0", {
      "repos/owner/repo/git/ref/tags/v0.2.0": { object: { type: "commit", sha: SHA } },
      [`repos/owner/repo/compare/${SHA}...main`]: { status: "diverged" },
    });
    assert.notEqual(diverged.status, 0);
    assert.match(diverged.stdout, /not reachable from main/);
    assert.match(dispatch("v0.3.0", {}).stdout, /does not exist/);
  });

  test("a push to main deploys production while only prerelease tags exist, and next once a stable one does", () => {
    const main = { "repos/owner/repo/commits/main": { sha: SHA } };
    const alpha = [{ ref: "refs/tags/v0.1.0-alpha.0" }, { ref: "refs/tags/v0.1.0-alpha.1" }];
    assert.equal(push({ ...main, "repos/owner/repo/git/matching-refs/tags/v": alpha }).outputs.target, "production");
    assert.equal(push({ ...main, "repos/owner/repo/git/matching-refs/tags/v": [] }).outputs.target, "production");
    const stable = [...alpha, { ref: "refs/tags/v0.1.0" }];
    assert.equal(push({ ...main, "repos/owner/repo/git/matching-refs/tags/v": stable }).outputs.target, "next");
  });

  test("a push whose tag lookup fails deploys nothing", () => {
    const result = push({ "repos/owner/repo/commits/main": { sha: SHA } });
    assert.notEqual(result.status, 0);
    assert.notEqual(result.outputs.target, "production");
  });
});

describe("the docs' stable-tag checks in production", { skip }, () => {
  const job = skip ? {} : SITES.docs.jobs.production;
  const before = skip ? "" : stepNamed(job, "Check that no stable release exists yet").run;
  const afterStep = skip ? {} : stepNamed(job, "Check that no release deployed during this deploy");
  const endedScript = skip ? "" : stepNamed(job, "Record when the deploy ended").run;
  const TAGS = "repos/owner/repo/git/matching-refs/tags/v";
  const RUNS = "repos/owner/repo/actions/workflows/docs-deploy.yml/runs?event=workflow_dispatch&per_page=30";
  const jobsOf = (id) => `repos/owner/repo/actions/runs/${id}/jobs?per_page=100`;
  const STARTED = "2026-11-22T10:00:00Z";
  const ENDED = "2026-11-22T10:10:00Z";
  const STABLE = [{ ref: "refs/tags/v0.1.0-alpha.3" }, { ref: "refs/tags/v0.1.0" }];
  const check = (answers) => runStep(before, { PATH: fakeGh(answers).PATH, REPO });
  // The job and step names come from the step's own env, which a test above ties to the production job.
  const checkAfter = (answers, { started = STARTED, ended = ENDED } = {}) => {
    const gh = fakeGh(answers);
    const { JOB_NAME, STEP_NAME } = afterStep.env;
    const env = { PATH: gh.PATH, REPO, STARTED: started, ENDED: ended, JOB_NAME, STEP_NAME };
    return { ...runStep(afterStep.run, env), calls: gh.calls() };
  };
  const release = (id, updated_at, status = "completed") => ({ id, status, updated_at });
  // A release run whose production job's Deploy step ended at completed_at, beside a build job with a Deploy step
  // of its own, which must not count.
  const deployJob = (conclusion, completed_at, name = skip ? "" : job.name) => ({
    jobs: [
      { name: "Build the docs at v0.1.0", steps: [{ name: "Deploy", conclusion: "success", completed_at }] },
      { name, steps: [{ name: "Deploy", conclusion, completed_at }] },
    ],
  });

  test("records the window's end a minute after the deploy ends", () => {
    const result = runStep(endedScript, {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.outputs.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(result.outputs.ended) >= Date.now() + 58_000, result.outputs.ended);
  });

  test("lets the deploy go ahead while only prerelease tags exist, and records when its window opens", () => {
    const result = check({ [TAGS]: [{ ref: "refs/tags/v0.1.0-alpha.3" }, { ref: "refs/tags/v0.1.0x" }] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.deploy, "true");
    assert.match(result.outputs.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(result.outputs.started) <= Date.now() - 59_000, result.outputs.started);
  });

  test("skips the deploy with a notice when a stable tag appeared before it", () => {
    const result = check({ [TAGS]: [{ ref: "refs/tags/v0.1.0" }] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.deploy, "false");
    assert.match(result.stdout, /::notice::/);
  });

  test("a failed tag lookup stops the deploy", () => {
    const result = check({});
    assert.notEqual(result.status, 0);
    assert.notEqual(result.outputs.deploy, "true");
  });

  test("after the deploy, with still no stable tag, succeeds quietly and reads no runs", () => {
    const result = checkAfter({ [TAGS]: [{ ref: "refs/tags/v0.1.0-alpha.3" }] });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /::(error|notice)::/);
    assert.deepEqual(result.calls, [TAGS]);
  });

  test("a tag that appeared during the deploy, with its release deploy still to come, leaves a notice and succeeds", () => {
    const result = checkAfter({ [TAGS]: STABLE, [RUNS]: { workflow_runs: [] } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::notice::/);
    assert.doesNotMatch(result.stdout, /::error::/);
  });

  test("ignores release runs from before the window, and ones whose deploy failed, ended earlier or is another job's", () => {
    const result = checkAfter({
      [TAGS]: STABLE,
      [RUNS]: {
        workflow_runs: [
          release(1, "2026-11-22T09:59:59Z"),
          release(2, STARTED),
          release(3, STARTED),
          release(4, STARTED),
        ],
      },
      [jobsOf(1)]: deployJob("success", "2026-11-22T10:05:00Z"),
      [jobsOf(2)]: deployJob("failure", "2026-11-22T10:05:00Z"),
      [jobsOf(3)]: deployJob("success", "2026-11-22T09:59:00Z"),
      [jobsOf(4)]: deployJob("success", "2026-11-22T10:05:00Z", "Deploy next.docs.buildanagent.fyi"),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::notice::A stable release was tagged during this push's deploy/);
    assert.ok(!result.calls.includes(jobsOf(1)), result.calls.join(", "));
  });

  test("fails loudly when a release's deploy succeeded inside the window, at either edge too", () => {
    for (const completed of ["2026-11-22T10:05:00Z", STARTED, ENDED]) {
      const result = checkAfter({
        [TAGS]: STABLE,
        [RUNS]: { workflow_runs: [release(9, "2026-11-22T10:11:00Z")] },
        [jobsOf(9)]: deployJob("success", completed),
      });
      assert.notEqual(result.status, 0, completed);
      assert.match(result.stdout, /::error::Release deploy run 9 /, completed);
    }
  });

  test("passes with a notice when a release's deploy ended after the window, so the release is live", () => {
    const result = checkAfter({
      [TAGS]: STABLE,
      [RUNS]: { workflow_runs: [release(9, "2026-11-22T10:12:00Z")] },
      [jobsOf(9)]: deployJob("success", "2026-11-22T10:10:01Z"),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /::error::/);
    assert.match(result.stdout, /::notice::Release deploy run 9 finished after this push's deploy/);
  });

  test("reads a release run still in progress even if its updated_at predates the window, and lets it finish", () => {
    const running = {
      jobs: [
        {
          name: job.name,
          status: "in_progress",
          steps: [{ name: "Deploy", status: "in_progress", conclusion: null, completed_at: null }],
        },
      ],
    };
    const result = checkAfter({
      [TAGS]: STABLE,
      [RUNS]: { workflow_runs: [release(8, "2026-11-22T09:30:00Z", "in_progress")] },
      [jobsOf(8)]: running,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.includes(jobsOf(8)), result.calls.join(", "));
    assert.match(result.stdout, /::notice::A stable release was tagged during this push's deploy/);
    // The same run, had its Deploy already succeeded inside the window, fails the check.
    const done = checkAfter({
      [TAGS]: STABLE,
      [RUNS]: { workflow_runs: [release(8, "2026-11-22T09:30:00Z", "in_progress")] },
      [jobsOf(8)]: deployJob("success", "2026-11-22T10:05:00Z"),
    });
    assert.notEqual(done.status, 0);
    assert.match(done.stdout, /::error::Release deploy run 8 /);
  });

  test("fails on a window edge, a run id or a job list it cannot trust, and on a failed lookup", () => {
    const none = { [TAGS]: STABLE, [RUNS]: { workflow_runs: [] } };
    assert.notEqual(checkAfter(none, { started: "now; rm -rf /" }).status, 0);
    assert.notEqual(checkAfter(none, { ended: "" }).status, 0);
    assert.notEqual(checkAfter(none, { ended: "2026-11-22T10:10:00Z\nx" }).status, 0);
    for (const id of ["1 x", "*", "0"]) {
      const result = checkAfter({ [TAGS]: STABLE, [RUNS]: { workflow_runs: [release(id, STARTED)] } });
      assert.notEqual(result.status, 0, id);
      assert.match(result.stdout, /run id that is not a number/, id);
    }
    assert.notEqual(
      checkAfter({ [TAGS]: STABLE, [RUNS]: { workflow_runs: [release(5, STARTED)] }, [jobsOf(5)]: { jobs: null } })
        .status,
      0,
    );
    assert.notEqual(checkAfter({ [TAGS]: STABLE }).status, 0);
    assert.notEqual(checkAfter({}).status, 0);
  });
});

describe("the re-check of main's newest commit before a push deploys", { skip }, () => {
  for (const [label, job] of skip
    ? []
    : [
        ["docs production", SITES.docs.jobs.production],
        ["docs next", SITES.docs.jobs.next],
        ["site production", SITES.site.jobs.production],
      ]) {
    const script = stepNamed(job, "Check that this commit is still main's newest").run;
    const check = (answers, headSha = SHA) => {
      const gh = fakeGh(answers);
      return { ...runStep(script, { PATH: gh.PATH, REPO, HEAD_SHA: headSha }), calls: gh.calls() };
    };

    test(`${label}: deploys while this commit is main's newest`, () => {
      const result = check({ "repos/owner/repo/commits/main": { sha: SHA } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.deploy, "true");
    });

    test(`${label}: a stale tip at deploy time deploys nothing, with a notice`, () => {
      const result = check({ "repos/owner/repo/commits/main": { sha: OTHER } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.deploy, "false");
      assert.match(result.stdout, /::notice::.*no longer main's newest commit/);
    });

    test(`${label}: a failed lookup, a tip that is not a SHA or a bad head SHA deploys nothing`, () => {
      for (const result of [
        check({}),
        check({ "repos/owner/repo/commits/main": { sha: `${SHA}\nx` } }),
        check({ "repos/owner/repo/commits/main": { sha: SHA } }, `${SHA}\nx`),
      ]) {
        assert.notEqual(result.status, 0);
        assert.notEqual(result.outputs.deploy, "true");
      }
      assert.deepEqual(check({}, "nope").calls, []);
    });
  }
});

// Runs a deletion script with a stand-in pnpm that logs its arguments and exits with the given status.
function runDeletion(script, number, status) {
  const at = mkdtempSync(join(work, "delete-"));
  mkdirSync(join(at, "bin"));
  writeFileSync(join(at, "bin", "pnpm"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${at}/args"\nexit ${status}\n`);
  chmodSync(join(at, "bin", "pnpm"), 0o755);
  const result = spawnSync("bash", ["-e", "-c", script], {
    cwd: at,
    encoding: "utf8",
    env: {
      PATH: `${join(at, "bin")}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: join(at, "output"),
      NUMBER: number,
      DELETED_DIR: join(at, "deleted"),
    },
  });
  const marker = join(at, "deleted", "deleted.txt");
  return {
    ...result,
    args: existsSync(join(at, "args")) ? readFileSync(join(at, "args"), "utf8").trim().split("\n") : null,
    marker: existsSync(marker) ? readFileSync(marker, "utf8") : null,
    output: existsSync(join(at, "output")) ? readFileSync(join(at, "output"), "utf8") : "",
  };
}

for (const name of ["docs", "site"]) {
  const WORKER = WORKERS[name];
  const ALIAS = `https://pr-7-${WORKER}.example.workers.dev`;
  const VERSION = `https://1a2b3c4d-${WORKER}.example.workers.dev`;

  describe(`the ${name} preview's pull request check`, { skip }, () => {
    const script = skip
      ? ""
      : stepNamed(SITES[name].jobs.preview, "Check that the pull request is still open at this commit").run;
    const PR = "repos/owner/repo/pulls/7";
    const check = (pr, number = "7") => {
      const gh = fakeGh(pr === undefined ? {} : { [PR]: pr });
      return { ...runStep(script, { PATH: gh.PATH, REPO, NUMBER: number, HEAD_SHA: SHA }), calls: gh.calls() };
    };

    const late = skip
      ? {}
      : stepNamed(SITES[name].jobs.preview, "Delete the preview of a pull request that closed meanwhile");

    test("deploys while the pull request is open, from a branch of this repository, at this commit", () => {
      const result = check(pull(7));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outputs.deploy, "true");
      assert.equal(result.outputs.delete, undefined);
    });

    // This job may have replaced the closed pull request's waiting deletion in their shared queue.
    for (const [label, pr] of [
      ["closed after resolve", pull(7, { state: "closed" })],
      ["closed after resolve, at a newer commit", pull(7, { state: "closed", sha: OTHER })],
    ]) {
      test(`deletes the preview instead of deploying it when the pull request ${label}`, () => {
        const result = check(pr);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.outputs.deploy, "false");
        assert.equal(result.outputs.delete, "true");
        assert.match(result.stdout, /::notice::.*deleted instead of deployed/);
        const deleted = runDeletion(late.run, "7", 0);
        assert.equal(deleted.status, 0, deleted.stderr);
        assert.deepEqual(deleted.args.slice(0, 4), ["exec", "wrangler", "preview", "delete"]);
        assert.deepEqual(deleted.args.slice(-3), ["--name", "pr-7", "--skip-confirmation"]);
        assert.equal(runDeletion(late.run, "7 --name pr-1", 0).args, null);
      });
    }

    for (const [label, pr] of [
      ["closed, from a fork", pull(7, { state: "closed", head: "fork/repo" })],
      ["closed, from a fork since deleted", { ...pull(7, { state: "closed" }), head: { sha: SHA, repo: null } }],
      ["moved on to a new head SHA", pull(7, { sha: OTHER })],
      ["now from a fork", pull(7, { head: "fork/repo" })],
      ["from a fork since deleted", { ...pull(7), head: { sha: SHA, repo: null } }],
    ]) {
      test(`skips the preview with a notice when the pull request is ${label}`, () => {
        const result = check(pr);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.outputs.deploy, "false");
        assert.equal(result.outputs.delete, undefined);
        assert.match(result.stdout, /::notice::/);
      });
    }

    test("a failed lookup or a number that is not a number deploys nothing", () => {
      assert.notEqual(check(undefined).status, 0);
      const bad = check(pull(7), "7/../../x");
      assert.notEqual(bad.status, 0);
      assert.deepEqual(bad.calls, []);
    });
  });

  describe(`the ${name} preview's URL check`, { skip }, () => {
    const record = skip ? {} : SITES[name].jobs.preview.steps.find((step) => step.id === "record");

    function recordWith(lines, number = "7") {
      const at = mkdtempSync(join(work, "record-"));
      const output = join(at, "wrangler-output.jsonl");
      if (lines !== null) writeFileSync(output, lines.map((line) => JSON.stringify(line)).join("\n"));
      const result = runStep(record.run, { NUMBER: number, WORKER, OUTPUT_FILE: output, URLS_DIR: join(at, "urls") });
      const file = join(at, "urls", "urls.txt");
      return { ...result, urls: existsSync(file) ? readFileSync(file, "utf8") : null };
    }
    const entry = (preview_urls, deployment_urls) => ({ type: "preview", version: 1, preview_urls, deployment_urls });

    test("takes the Worker's name from a fixed env value", () => {
      assert.equal(record.env.WORKER, WORKER);
    });

    test("keeps the preview URL and the commit's URL on the same subdomain", () => {
      const result = recordWith([{ type: "wrangler-session" }, entry([`${ALIAS}/`], [VERSION])]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.urls, `${ALIAS}\n${VERSION}\n`);
      assert.equal(result.outputs.found, "true");
    });

    test("drops a commit URL on another subdomain, keeping the preview URL alone", () => {
      const result = recordWith([entry([ALIAS], [`https://1a2b3c4d-${WORKER}.attacker.workers.dev`])]);
      assert.equal(result.urls, `${ALIAS}\n\n`);
    });

    test("rejects a URL holding a newline, so one string never reads as two lines", () => {
      const result = recordWith([entry([`${ALIAS}\nhttps://evil.example`], [VERSION])]);
      assert.equal(result.urls, null);
      assert.equal(result.outputs.found, "false");
    });

    test("rejects another Worker's preview, another pull request's, and a host that is not workers.dev", () => {
      const other = name === "docs" ? "buildanagent-site" : "buildanagent-docs";
      for (const url of [
        `https://pr-7-${other}.example.workers.dev`,
        `https://pr-70-${WORKER}.example.workers.dev`,
        `https://pr-7-${WORKER}.example.workers.dev.evil.example`,
        `http://pr-7-${WORKER}.example.workers.dev`,
        `https://pr-7-${WORKER}.example.workers.dev/path`,
      ]) {
        const result = recordWith([entry([url], [])]);
        assert.equal(result.urls, null, url);
        assert.equal(result.outputs.found, "false", url);
      }
    });

    test("ignores URLs outside a preview entry, and a missing output file", () => {
      assert.equal(recordWith([{ type: "deploy", preview_urls: [ALIAS] }]).urls, null);
      assert.equal(recordWith(null).outputs.found, "false");
    });

    test("refuses a pull request number that is not a number", () => {
      assert.notEqual(recordWith([entry([ALIAS], [])], "7 -x").status, 0);
    });
  });

  describe(`the ${name} preview's deletion`, { skip }, () => {
    const step = skip ? {} : stepNamed(SITES[name].jobs["delete-preview"], "Delete the preview");

    const deleteWith = (number, status) => runDeletion(step.run, number, status);

    test("deletes pr-<n> from main's config and leaves the marker", () => {
      const result = deleteWith("7", 0);
      assert.equal(result.status, 0, result.stderr);
      const env = name === "docs" ? ["--env", ""] : [];
      assert.deepEqual(result.args, [
        "exec",
        "wrangler",
        "preview",
        "delete",
        "--config",
        "wrangler.toml",
        ...env,
        "--name",
        "pr-7",
        "--skip-confirmation",
      ]);
      assert.equal(result.marker, "deleted\n");
      assert.match(result.output, /deleted=true/);
    });

    test("a failed deletion warns and leaves no marker", () => {
      const result = deleteWith("7", 1);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.marker, null);
      assert.match(result.stdout, /::warning::/);
    });

    test("refuses a pull request number that is not a number, before Wrangler runs", () => {
      for (const number of ["7 --name pr-1", "0", "", "07"]) {
        const result = deleteWith(number, 0);
        assert.notEqual(result.status, 0, number);
        assert.equal(result.args, null, number);
      }
    });
  });

  describe(`the ${name} comment script`, { skip }, () => {
    const script = skip ? "" : SITES[name].jobs.comment.steps.at(-1).run;
    const env = skip ? {} : SITES[name].jobs.comment.steps.at(-1).env;
    const MARKER = env.MARKER;
    const C_SHA = "c".repeat(40);
    const bot = { login: "github-actions[bot]", type: "Bot" };

    // A stand-in for the `gh api` calls the script makes. It keeps the pull request and its comments in a state file,
    // answers reads through jq, applies POST and PATCH to the state, and fails on any flag the script should not use.
    function fakeCommentGh(state) {
      const at = mkdtempSync(join(work, "gh-comment-"));
      mkdirSync(join(at, "bin"));
      const stateFile = join(at, "state.json");
      writeFileSync(stateFile, JSON.stringify({ nextId: 100, ...state }));
      writeFileSync(
        join(at, "bin", "gh"),
        `#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const stateFile = ${JSON.stringify(stateFile)};
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2);
if (args[0] !== "api") process.exit(9);
let method = "GET", jq, path, fields = {};
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--method") method = args[++i];
  else if (a === "--jq") jq = args[++i];
  else if (a === "-f") { const kv = args[++i]; fields[kv.slice(0, kv.indexOf("="))] = kv.slice(kv.indexOf("=") + 1); }
  else if (a === "--paginate" || a === "--silent") {}
  else if (a.startsWith("-")) { console.error("unexpected flag " + a); process.exit(9); }
  else path = a;
}
fs.appendFileSync(stateFile + ".calls", JSON.stringify({ method, path, fields }) + "\\n");
let data;
if (method === "GET" && /^repos\\/owner\\/repo\\/pulls\\/\\d+$/.test(path)) data = state.pull;
else if (method === "GET" && /^repos\\/owner\\/repo\\/issues\\/\\d+\\/comments\\?per_page=100$/.test(path)) data = state.comments;
else if (method === "POST" && /^repos\\/owner\\/repo\\/issues\\/\\d+\\/comments$/.test(path)) {
  state.comments.push({ id: state.nextId++, user: { login: "github-actions[bot]", type: "Bot" }, body: fields.body });
} else if (method === "PATCH" && /^repos\\/owner\\/repo\\/issues\\/comments\\/\\d+$/.test(path)) {
  const target = state.comments.find((c) => String(c.id) === path.split("/").pop());
  if (!target) { console.error("HTTP 404"); process.exit(1); }
  target.body = fields.body;
} else { console.error("unexpected call " + method + " " + path); process.exit(9); }
fs.writeFileSync(stateFile, JSON.stringify(state));
if (data !== undefined) {
  const out = spawnSync("jq", ["-r", jq], { input: JSON.stringify(data), encoding: "utf8" });
  process.stdout.write(out.stdout);
  process.exit(out.status);
}
`,
      );
      chmodSync(join(at, "bin", "gh"), 0o755);
      const calls = () =>
        existsSync(`${stateFile}.calls`)
          ? readFileSync(`${stateFile}.calls`, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
          : [];
      return {
        PATH: `${join(at, "bin")}:${process.env.PATH ?? ""}`,
        dir: at,
        comments: () => JSON.parse(readFileSync(stateFile, "utf8")).comments,
        writes: () => calls().filter((call) => call.method !== "GET"),
      };
    }

    const open = { state: "open", head: { sha: C_SHA, repo: { full_name: REPO } } };
    const closed = { ...open, state: "closed" };
    const run = (gh, { mode = "preview", signalText = `${ALIAS}\n${VERSION}\n`, ...rest } = {}) => {
      const signal = join(gh.dir, "signal.txt");
      if (signalText !== null) writeFileSync(signal, signalText);
      return runStep(script, {
        PATH: gh.PATH,
        GH_TOKEN: "test",
        REPO,
        NUMBER: "7",
        HEAD_SHA: C_SHA,
        WORKER,
        MARKER,
        TITLE: env.TITLE,
        MODE: mode,
        SIGNAL: signal,
        ...rest,
      });
    };
    const BODY = [
      MARKER,
      `**${env.TITLE}** of ccccccc`,
      "",
      `- Pull request preview, which follows its newest commit: ${ALIAS}`,
      `- This commit only: ${VERSION}`,
    ].join("\n");

    test("both comment jobs pass the same fixed marker, title and Worker", () => {
      const deleted = SITES[name].jobs["comment-deleted"].steps.at(-1).env;
      assert.equal(MARKER, `<!-- ${name}-preview -->`);
      for (const key of ["MARKER", "TITLE", "WORKER", "REPO", "NUMBER", "HEAD_SHA"])
        assert.equal(deleted[key], env[key], key);
      assert.equal(env.WORKER, WORKER);
    });

    test("creates one comment holding only the marker, the short SHA and the two URLs", () => {
      const gh = fakeCommentGh({ pull: open, comments: [] });
      const result = run(gh);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        gh.comments().map((c) => c.body),
        [BODY],
      );
    });

    test("edits the bot's own marked comment and leaves a person's quote of the marker alone", () => {
      const person = { id: 5, user: { login: "someone", type: "User" }, body: `${MARKER} quoted` };
      const ours = { id: 6, user: bot, body: `${MARKER}\nold` };
      const gh = fakeCommentGh({ pull: open, comments: [person, ours] });
      run(gh);
      assert.deepEqual(
        gh.comments().map((c) => c.body),
        [person.body, BODY],
      );
      assert.deepEqual(
        gh.writes().map((w) => [w.method, w.path]),
        [["PATCH", "repos/owner/repo/issues/comments/6"]],
      );
    });

    test("leaves a marked comment alone unless github-actions[bot] wrote it as a Bot", () => {
      const app = { id: 3, user: { login: "other-app[bot]", type: "Bot" }, body: `${MARKER}\napp` };
      const user = { id: 4, user: { login: "github-actions[bot]", type: "User" }, body: `${MARKER}\nuser` };
      const ours = { id: 6, user: bot, body: `${MARKER}\nold` };
      const gh = fakeCommentGh({ pull: open, comments: [app, user, ours] });
      const result = run(gh);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        gh.comments().map((c) => c.body),
        [app.body, user.body, BODY],
      );
      assert.deepEqual(
        gh.writes().map((w) => [w.method, w.path]),
        [["PATCH", "repos/owner/repo/issues/comments/6"]],
      );
    });

    for (const [label, pr] of [
      ["a closed pull request", closed],
      ["a pull request with a newer commit", { ...open, head: { ...open.head, sha: OTHER } }],
      ["a fork's pull request", { ...open, head: { ...open.head, repo: { full_name: "fork/repo" } } }],
      ["a pull request whose fork was deleted", { ...open, head: { sha: C_SHA, repo: null } }],
    ]) {
      test(`writes nothing on ${label}`, () => {
        const gh = fakeCommentGh({ pull: pr, comments: [] });
        const result = run(gh);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(gh.writes(), []);
      });
    }

    for (const [label, text] of [
      ["one line only", `${ALIAS}\n`],
      ["three lines", `${ALIAS}\n${VERSION}\nhttps://evil.example\n`],
      ["another Worker's preview", `${ALIAS.replace(WORKER, "buildanagent-manual")}\n\n`],
      ["another pull request's preview", `${ALIAS.replace("pr-7-", "pr-8-")}\n\n`],
      ["a commit URL on another subdomain", `${ALIAS}\n${VERSION.replace(".example.", ".attacker.")}\n`],
      ["a commit URL with markdown", `${ALIAS}\n${VERSION})[x](https://evil.example\n`],
    ]) {
      test(`writes nothing for a URL file with ${label}`, () => {
        const gh = fakeCommentGh({ pull: open, comments: [] });
        const result = run(gh, { signalText: text });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(gh.writes(), []);
      });
    }

    test("writes nothing when the preview handed on no URLs", () => {
      const gh = fakeCommentGh({ pull: open, comments: [] });
      run(gh, { signalText: null });
      assert.deepEqual(gh.writes(), []);
    });

    test("marks the comment deleted once a closed pull request's preview is gone", () => {
      const ours = { id: 6, user: bot, body: BODY };
      const gh = fakeCommentGh({ pull: closed, comments: [ours] });
      const result = run(gh, { mode: "deleted", signalText: "deleted\n" });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        gh.comments().map((c) => c.body),
        [`${MARKER}\n**${env.TITLE} deleted.** The pull request closed, so its preview, pr-7, no longer serves it.`],
      );
    });

    for (const [label, pr, signalText, comments] of [
      ["the pull request was reopened", open, "deleted\n", [{ id: 6, user: bot, body: BODY }]],
      [
        "the pull request is a fork's",
        { ...closed, head: { ...closed.head, repo: { full_name: "fork/repo" } } },
        "deleted\n",
        [{ id: 6, user: bot, body: BODY }],
      ],
      ["the deletion failed", closed, null, [{ id: 6, user: bot, body: BODY }]],
      ["the marker file holds something else", closed, "a URL\n", [{ id: 6, user: bot, body: BODY }]],
      ["there is no comment to mark", closed, "deleted\n", []],
    ]) {
      test(`a deletion writes nothing when ${label}`, () => {
        const gh = fakeCommentGh({ pull: pr, comments });
        const result = run(gh, { mode: "deleted", signalText });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(gh.writes(), []);
      });
    }
  });
}
