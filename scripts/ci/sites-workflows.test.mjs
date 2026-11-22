// Offline checks for the two sites' build and deploy workflows: docs-build.yml, site-build.yml, docs-deploy.yml and
// site-deploy.yml. It reads them from .github/workflows/ once docs-deploy.yml is there, or else from the directory that
// SITES_WORKFLOWS_DIR names, which lets a draft be checked before it is committed; with neither, every test is skipped.
// It checks the shape that keeps the Cloudflare secrets away from a pull request's code, then runs the docs' resolve
// step under bash against a stand-in `gh` that answers from fixtures through jq. Run with
// `node --test scripts/ci/*.test.mjs`.
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
const dir = existsSync(join(committed, "docs-deploy.yml")) ? committed : process.env.SITES_WORKFLOWS_DIR;
const skip =
  dir === undefined ? "the site workflows are not in .github/workflows/ and SITES_WORKFLOWS_DIR is unset" : false;
const read = (name) => (skip ? {} : parse(readFileSync(join(dir, name), "utf8")));
const SITES = { docs: read("docs-deploy.yml"), site: read("site-deploy.yml") };
const BUILDS = { docs: read("docs-build.yml"), site: read("site-build.yml") };
const work = mkdtempSync(join(tmpdir(), "sites-workflows-"));
after(() => rmSync(work, { recursive: true, force: true }));

const environmentOf = (job) => (typeof job.environment === "string" ? job.environment : job.environment?.name);
const steps = (job) => job.steps ?? [];
const runs = (workflow) =>
  Object.values(workflow.jobs ?? {}).flatMap((job) => steps(job).map((step) => step.run ?? ""));

describe("the build workflows", { skip }, () => {
  for (const [name, workflow] of Object.entries(BUILDS)) {
    test(`${name}-build runs on pull requests and pushes to main, with read-only contents and no secrets`, () => {
      assert.deepEqual(workflow.on, { push: { branches: ["main"] }, pull_request: null });
      assert.deepEqual(workflow.permissions, { contents: "read" });
      assert.doesNotMatch(JSON.stringify(workflow), /secrets\./);
      assert.ok(Object.values(workflow.jobs).every((job) => job.environment === undefined));
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

describe("the deploy workflows", { skip }, () => {
  for (const [name, workflow] of Object.entries(SITES)) {
    const jobs = Object.entries(workflow.jobs ?? {});

    test(`${name}-deploy starts only after ${name}-build${name === "docs" ? ", or from a dispatch with a tag" : ""}`, () => {
      assert.deepEqual(workflow.on.workflow_run, { workflows: [`${name}-build`], types: ["completed"] });
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
          if (id !== "secrets") {
            assert.ok([job.needs].flat().includes("secrets"), `${id} must need the secrets job`);
            assert.match(job.if, /needs\.secrets\.outputs\.present == 'true'/, id);
          }
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

    test(`${name}-deploy: production needs a push to main from this repository and the owner's switch`, () => {
      const production = workflow.jobs.production.if;
      for (const condition of [
        "github.event.workflow_run.event == 'push'",
        "github.event.workflow_run.head_repository.full_name == github.repository",
        "github.event.workflow_run.head_branch == 'main'",
        `vars.${name.toUpperCase()}_DEPLOY_ENABLED == 'true'`,
      ]) {
        assert.ok(production.includes(condition), condition);
      }
      assert.equal(workflow.jobs.production.concurrency["cancel-in-progress"], false);
    });

    test(`${name}-deploy: the comment job holds only pull-requests: write and no environment`, () => {
      const { comment } = workflow.jobs;
      assert.deepEqual(comment.permissions, { "pull-requests": "write" });
      assert.equal(comment.environment, undefined);
      assert.ok(!steps(comment).some((step) => step.uses?.startsWith("actions/checkout@")));
    });

    test(`${name}-deploy: the preview runs wrangler preview with main's config and the pull request number from resolve`, () => {
      const { preview } = workflow.jobs;
      assert.equal(preview.strategy.matrix.number, `\${{ fromJSON(needs.resolve.outputs.previews) }}`);
      assert.ok(runs({ jobs: { preview } }).some((script) => /wrangler preview --config wrangler\.toml/.test(script)));
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

  test("every action is one the lock already holds at that tag", () => {
    const lock = readFileSync(join(committed, "actions.lock"), "utf8");
    for (const workflow of [...Object.values(SITES), ...Object.values(BUILDS)]) {
      for (const job of Object.values(workflow.jobs)) {
        for (const step of steps(job).filter((step) => step.uses)) {
          assert.ok(lock.includes(`'${step.uses}':`), `${step.uses} is not in actions.lock's dependencies`);
        }
      }
    }
  });
});

describe("the docs' resolve step", { skip }, () => {
  const SHA = "a".repeat(40);
  const TAG_OBJECT = "c".repeat(40);
  const REPO = "owner/repo";
  const step = skip ? {} : SITES.docs.jobs.resolve.steps[0];

  // A stand-in for `gh api [--paginate] <path> --jq <filter>`: it answers from a fixture named after the path, through
  // jq, and fails as an API error would when there is none.
  function fakeGh(answers) {
    const home = mkdtempSync(join(work, "gh-"));
    mkdirSync(join(home, "bin"));
    const file = (path) => join(home, path.replace(/[^a-z0-9.]/gi, "_"));
    for (const [path, body] of Object.entries(answers)) writeFileSync(file(path), JSON.stringify(body));
    const gh = join(home, "bin", "gh");
    writeFileSync(
      gh,
      `#!/bin/bash\n[ "$1" = api ] || exit 9\nshift\n[ "$1" = --paginate ] && shift\n[ "$2" = --jq ] || exit 9\n` +
        `f="${home}/$(printf '%s' "$1" | tr -c 'a-zA-Z0-9.' '_')"\n[ -f "$f" ] || exit 1\nexec jq -r "$3" "$f"\n`,
    );
    chmodSync(gh, 0o755);
    return `${join(home, "bin")}:${process.env.PATH ?? ""}`;
  }

  function run(env, answers = {}) {
    const outputs = join(mkdtempSync(join(work, "out-")), "output");
    writeFileSync(outputs, "");
    const result = spawnSync("bash", ["-e", "-c", step.run], {
      encoding: "utf8",
      env: { PATH: fakeGh(answers), GITHUB_OUTPUT: outputs, REPO, ...env },
    });
    const pairs = readFileSync(outputs, "utf8").trim().split("\n").filter(Boolean);
    return { ...result, outputs: Object.fromEntries(pairs.map((line) => line.split(/=(.*)/s).slice(0, 2))) };
  }

  const dispatch = (tag, answers) => run({ EVENT_NAME: "workflow_dispatch", TAG: tag }, answers);
  const push = (answers) =>
    run({ EVENT_NAME: "workflow_run", EVENT: "push", HEAD_SHA: SHA, HEAD_REPO: REPO, HEAD_BRANCH: "main" }, answers);

  test("takes the tag from inputs through env only", () => {
    assert.equal(step.env.TAG, `\${{ inputs.tag }}`);
  });

  test("a dispatch of a lightweight stable tag on main resolves to its commit", () => {
    const result = dispatch("v0.1.0", {
      "repos/owner/repo/git/ref/tags/v0.1.0": { object: { type: "commit", sha: SHA } },
      [`repos/owner/repo/compare/${SHA}...main`]: { status: "ahead" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { target: "release", previews: "[]", sha: SHA });
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

  test("a push from a fork's branch named main deploys nothing", () => {
    const result = run(
      { EVENT_NAME: "workflow_run", EVENT: "push", HEAD_SHA: SHA, HEAD_REPO: "fork/repo", HEAD_BRANCH: "main" },
      {},
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.target, "none");
  });

  test("a pull request previews only open pull requests from the head repository the build ran for", () => {
    const pulls = [
      {
        number: 7,
        state: "open",
        head: { sha: SHA, repo: { full_name: "fork/repo" } },
        base: { repo: { full_name: REPO } },
      },
      { number: 8, state: "open", head: { sha: SHA, repo: { full_name: REPO } }, base: { repo: { full_name: REPO } } },
      {
        number: 9,
        state: "closed",
        head: { sha: SHA, repo: { full_name: "fork/repo" } },
        base: { repo: { full_name: REPO } },
      },
    ];
    const result = run(
      { EVENT_NAME: "workflow_run", EVENT: "pull_request", HEAD_SHA: SHA, HEAD_REPO: "fork/repo", HEAD_BRANCH: "main" },
      { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { target: "previews", previews: "[7]", sha: "" });
  });
});
