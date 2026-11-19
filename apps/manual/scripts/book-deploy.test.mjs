// Offline checks for the book's deploy workflows, .github/workflows/book-deploy.yml and book-pr-closed.yml: what
// triggers them, what each job may do, which steps see a Cloudflare secret, and how the secrets check and the resolve
// step behave when run under bash. The resolve step runs against a stand-in `gh` that answers from fixtures through
// jq, so its jq filters run too and nothing touches the network. Run with `node --test scripts/*.test.mjs` from
// apps/manual.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const workflows = join(root, ".github", "workflows");
const deployText = readFileSync(join(workflows, "book-deploy.yml"), "utf8");
const deploy = parse(deployText);
const closed = parse(readFileSync(join(workflows, "book-pr-closed.yml"), "utf8"));
const { jobs } = deploy;
const SECRETS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const work = mkdtempSync(join(tmpdir(), "book-deploy-"));
after(() => rmSync(work, { recursive: true, force: true }));

const deployJobs = Object.entries(jobs).filter(([, job]) => job.environment !== undefined);
const environmentOf = (job) => (typeof job.environment === "string" ? job.environment : job.environment.name);

describe("book-deploy.yml's triggers and jobs", () => {
  test("runs only on workflow_run after book-build and book-pr-closed complete", () => {
    assert.deepEqual(deploy.on, {
      workflow_run: { workflows: ["book-build", "book-pr-closed"], types: ["completed"] },
    });
    assert.equal(parse(readFileSync(join(workflows, "book-build.yml"), "utf8")).name, "book-build");
    assert.equal(closed.name, "book-pr-closed");
  });

  // A workflow on pull_request or pull_request_target that named a book environment could reach its token, so only
  // this workflow, which GitHub always runs from main, may name one.
  test("no other workflow names book-production or book-preview, and neither book workflow uses pull_request_target", () => {
    for (const file of readdirSync(workflows).filter((name) => name.endsWith(".yml"))) {
      const workflow = parse(readFileSync(join(workflows, file), "utf8"));
      for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
        const environment = job.environment === undefined ? "" : environmentOf(job);
        if (file !== "book-deploy.yml") assert.doesNotMatch(environment, /^book-/, `${file}: ${name}`);
      }
      if (file.startsWith("book-")) assert.equal(workflow.on.pull_request_target, undefined, file);
    }
  });

  test("grants no permission by default, and each job only what it uses", () => {
    assert.deepEqual(deploy.permissions, {});
    assert.deepEqual(jobs.resolve.permissions, { contents: "read", "pull-requests": "read" });
    assert.deepEqual(jobs.production.permissions, { actions: "read", contents: "read" });
    assert.deepEqual(jobs.preview.permissions, { actions: "read", contents: "read" });
    assert.deepEqual(jobs["delete-preview"].permissions, { contents: "read" });
  });

  test("production runs in book-production, previews and deletions in book-preview, and resolve in none", () => {
    assert.deepEqual(
      deployJobs.map(([name, job]) => [name, environmentOf(job)]),
      [
        ["production", "book-production"],
        ["preview", "book-preview"],
        ["delete-preview", "book-preview"],
      ],
    );
    assert.equal(jobs.resolve.environment, undefined);
  });

  test("production deploys only a push to main from this repository, behind BOOK_DEPLOY_ENABLED", () => {
    const condition = jobs.production.if;
    for (const part of [
      "github.event.workflow_run.name == 'book-build'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "github.event.workflow_run.head_branch == 'main'",
      "vars.BOOK_DEPLOY_ENABLED == 'true'",
      "needs.resolve.outputs.newest == 'true'",
    ]) {
      assert.ok(condition.includes(part), part);
    }
    assert.doesNotMatch(condition, /\|\|/);
    assert.deepEqual(jobs.production.concurrency, { group: "book-production", "cancel-in-progress": false });
  });

  test("a preview needs a pull_request run, and the previews and deletions share one queue per branch", () => {
    assert.match(jobs.preview.if, /github\.event\.workflow_run\.event == 'pull_request'/);
    assert.match(jobs["delete-preview"].if, /github\.event\.workflow_run\.name == 'book-pr-closed'/);
    assert.deepEqual(jobs.preview.concurrency, jobs["delete-preview"].concurrency);
    // Keyed by pull request, not branch: two pull requests from one branch never replace each other's waiting run.
    assert.equal(jobs.preview.concurrency.group, `book-preview-pr-\${{ matrix.number }}`);
    assert.deepEqual(jobs.preview.strategy.matrix, { number: `\${{ fromJSON(needs.resolve.outputs.previews) }}` });
    assert.deepEqual(jobs["delete-preview"].strategy.matrix, {
      number: `\${{ fromJSON(needs.resolve.outputs.deletions) }}`,
    });
    assert.match(jobs.preview.if, /needs\.resolve\.outputs\.previews != '\[\]'/);
    assert.match(jobs["delete-preview"].if, /needs\.resolve\.outputs\.deletions != '\[\]'/);
    assert.equal(jobs.preview.concurrency["cancel-in-progress"], false);
    assert.match(jobs.resolve.if, /conclusion == 'success'/);
  });
});

describe("what touches code and secrets", () => {
  test("every checkout is of main, never of the triggering run's commit or repository", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps.filter((s) => s.uses?.startsWith("actions/checkout@"))) {
        assert.deepEqual(step.with, { ref: "main", "persist-credentials": false }, name);
      }
    }
    assert.equal(
      jobs.resolve.steps.some((s) => s.uses),
      false,
      "resolve runs no action",
    );
  });

  test("the artifact is downloaded unextracted from the triggering run, then checked before the guard and Wrangler", () => {
    for (const name of ["production", "preview"]) {
      const steps = jobs[name].steps;
      const download = steps.findIndex((s) => s.uses?.startsWith("actions/download-artifact@"));
      assert.deepEqual(steps[download].with, {
        name: "book-dist",
        path: `\${{ runner.temp }}/book-dist`,
        "run-id": `\${{ github.event.workflow_run.id }}`,
        "github-token": `\${{ github.token }}`,
        "skip-decompress": true,
      });
      const at = (pattern) => steps.findIndex((s) => pattern.test(s.run ?? ""));
      const stage = at(/stage-dist\.mjs "\$RUNNER_TEMP\/book-dist" apps\/manual\/dist apps\/manual\/public\/_headers/);
      const guard = at(/guard-deploy\.mjs/);
      const wrangler = at(/wrangler (deploy|preview)/);
      assert.ok(download < stage && stage < guard && guard < wrangler, `${name}: download, stage, guard, Wrangler`);
    }
  });

  test("the deploy jobs share one definition of each common step, written once as a YAML anchor", () => {
    const [production, preview, deletion] = ["production", "preview", "delete-preview"].map((n) => jobs[n].steps);
    assert.deepEqual(preview.slice(0, -1), production.slice(0, -1));
    assert.deepEqual(deletion.slice(0, -1), [
      production[0],
      production[1],
      production[3],
      production[4],
      production[5],
    ]);
    assert.equal((deployText.match(/^ {6}- &[a-z-]+$/gm) ?? []).length, 8);
  });

  test("every Wrangler call names wrangler.jsonc, so Wrangler reads the file the guard checked", () => {
    const calls = Object.values(jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.run ?? "").match(/wrangler (deploy|preview)[^\n]*/g) ?? []),
    );
    assert.equal(calls.length, 3);
    for (const call of calls) assert.match(call, /--config wrangler\.jsonc/, call);
  });

  test("secrets reach only each deploy job's first step and its Wrangler step", () => {
    for (const [name, job] of Object.entries(jobs)) {
      // Job-level env holds only the environment's name, which the secrets check's message uses.
      const expected = job.environment === undefined ? undefined : { BOOK_ENVIRONMENT: environmentOf(job) };
      assert.deepEqual(job.env, expected, `${name}'s job-level env`);
      const readers = job.steps.flatMap((step, i) => (JSON.stringify(step).includes("secrets.") ? [i] : []));
      if (job.environment === undefined) {
        assert.deepEqual(readers, [], `${name} reads no secret`);
        continue;
      }
      const last = job.steps.length - 1;
      assert.deepEqual(readers, [0, last], name);
      assert.match(job.steps[last].run, /pnpm exec wrangler/);
      for (const index of readers) {
        for (const secret of SECRETS) assert.equal(job.steps[index].env[secret], `\${{ secrets.${secret} }}`);
      }
    }
    assert.deepEqual([...new Set(deployText.match(/secrets\.[A-Z_]+/g))].sort(), [
      "secrets.CLOUDFLARE_ACCOUNT_ID",
      "secrets.CLOUDFLARE_API_TOKEN",
    ]);
  });

  test("no script interpolates an expression; event values reach the shell through env", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (step.run) assert.doesNotMatch(step.run, /\$\{\{/, `${name}: ${step.name ?? step.run}`);
      }
    }
  });

  test("book-pr-closed.yml holds no secret, checks nothing out and grants no permission", () => {
    assert.deepEqual(closed.on, { pull_request: { types: ["closed"] } });
    assert.deepEqual(closed.permissions, {});
    const text = JSON.stringify(closed);
    assert.doesNotMatch(text, /secrets\.|environment|uses/);
  });
});

// Runs one step's script the way a runner does, with bash -e and only the given environment.
function runStep(script, env) {
  const output = join(work, `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: env.PATH ?? process.env.PATH ?? "", GITHUB_OUTPUT: output, ...env },
  });
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  return { ...result, outputs };
}

describe("the secrets check", () => {
  const CHECKLIST = "https://github.com/owner/repo/blob/main/apps/manual/README.md#what-the-owner-sets-up";

  test("is the first step of every deploy job, the same script each time, naming the job's environment", () => {
    const scripts = deployJobs.map(([, job]) => job.steps[0].run);
    assert.equal(new Set(scripts).size, 1);
    for (const [name, job] of deployJobs) {
      assert.equal(job.steps[0].name, "Check the environment's secrets", name);
      assert.equal(job.env.BOOK_ENVIRONMENT, environmentOf(job), name);
      assert.match(job.steps[0].env.CHECKLIST, /apps\/manual\/README\.md#what-the-owner-sets-up$/);
    }
  });

  const script = jobs.production.steps[0].run;

  test("passes when both secrets are set", () => {
    const result = runStep(script, {
      BOOK_ENVIRONMENT: "book-production",
      CHECKLIST,
      CLOUDFLARE_API_TOKEN: "x",
      CLOUDFLARE_ACCOUNT_ID: "y",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout, "");
  });

  for (const missing of SECRETS) {
    test(`fails naming ${missing} and the checklist when it is missing or empty`, () => {
      for (const value of [undefined, ""]) {
        const env = {
          BOOK_ENVIRONMENT: "book-preview",
          CHECKLIST,
          CLOUDFLARE_API_TOKEN: "x",
          CLOUDFLARE_ACCOUNT_ID: "y",
        };
        if (value === undefined) delete env[missing];
        else env[missing] = value;
        const result = runStep(script, env);
        assert.equal(result.status, 1);
        assert.equal(
          result.stdout.trim(),
          `::error title=Missing secret ${missing}::The book-preview environment has no ${missing} secret, so nothing was deployed. Add it as the owner's checklist says: ${CHECKLIST}`,
        );
      }
    });
  }

  test("names both secrets when both are missing", () => {
    const result = runStep(script, { BOOK_ENVIRONMENT: "book-production", CHECKLIST });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim().split("\n").length, 2);
  });

  test("the checklist it points to exists in the README", () => {
    const readme = readFileSync(join(root, "apps", "manual", "README.md"), "utf8");
    assert.ok(/^## What the owner sets up$/m.test(readme), "README.md has the heading the check links to");
  });
});

describe("the resolve step", () => {
  const SHA = "a".repeat(40);
  const OTHER = "b".repeat(40);
  const REPO = "owner/repo";
  const step = jobs.resolve.steps[0];

  // A stand-in for `gh api <path> --jq <filter>`: it answers from a fixture file named after the path, through jq.
  function fakeGh(answers) {
    const dir = mkdtempSync(join(work, "gh-"));
    mkdirSync(join(dir, "bin"));
    for (const [path, body] of Object.entries(answers)) {
      writeFileSync(join(dir, path.replace(/[/?&=]/g, "_")), JSON.stringify(body));
    }
    const gh = join(dir, "bin", "gh");
    writeFileSync(
      gh,
      `#!/bin/sh\n[ "$1" = api ] && [ "$3" = --jq ] || exit 9\nexec jq -r "$4" "${dir}/$(printf '%s' "$2" | tr '/?&=' '____')"\n`,
    );
    chmodSync(gh, 0o755);
    return `${join(dir, "bin")}:${process.env.PATH ?? ""}`;
  }

  const run = (event, answers = {}) =>
    runStep(step.run, {
      PATH: fakeGh(answers),
      REPO,
      WORKFLOW: "book-build",
      EVENT: "pull_request",
      HEAD_SHA: SHA,
      HEAD_REPO: REPO,
      HEAD_BRANCH: "feature",
      ...event,
    });

  test("reads every event value from env, set from the workflow_run payload", () => {
    assert.equal(step.env.HEAD_SHA, `\${{ github.event.workflow_run.head_sha }}`);
    assert.equal(step.env.GH_TOKEN, `\${{ github.token }}`);
  });

  test("a push to main that is still main's newest commit deploys", () => {
    const result = run({ EVENT: "push", HEAD_BRANCH: "main" }, { "repos/owner/repo/commits/main": { sha: SHA } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { newest: "true", previews: "[]", deletions: "[]" });
  });

  test("a push to main that a newer commit has passed does not", () => {
    const result = run({ EVENT: "push", HEAD_BRANCH: "main" }, { "repos/owner/repo/commits/main": { sha: OTHER } });
    assert.equal(result.outputs.newest, "false");
    assert.match(result.stdout, /no longer main's newest commit/);
  });

  test("a push to main whose newest-commit lookup fails deploys nothing", () => {
    // No fixture for the path, so the stand-in gh fails as an API error would.
    const result = run({ EVENT: "push", HEAD_BRANCH: "main" });
    assert.notEqual(result.status, 0);
    assert.notEqual(result.outputs.newest, "true");
  });

  test("a fork's branch named main is not a push to main", () => {
    const result = run({ EVENT: "push", HEAD_BRANCH: "main", HEAD_REPO: "fork/repo" });
    assert.deepEqual(result.outputs, { newest: "false", previews: "[]", deletions: "[]" });
  });

  const pulls = [
    { number: 7, state: "open", head: { sha: SHA }, base: { repo: { full_name: REPO } } },
    { number: 8, state: "closed", head: { sha: SHA }, base: { repo: { full_name: REPO } } },
    { number: 9, state: "open", head: { sha: OTHER }, base: { repo: { full_name: REPO } } },
    { number: 10, state: "open", head: { sha: SHA }, base: { repo: { full_name: "fork/repo" } } },
  ];

  test("a pull request run previews only open pull requests into this repository whose head is the commit", () => {
    const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { newest: "false", previews: "[7]", deletions: "[]" });
  });

  test("a pull request run whose commit no open pull request has as its head previews nothing", () => {
    const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls.slice(1, 3) });
    assert.equal(result.outputs.previews, "[]");
    assert.match(result.stdout, /no preview/);
  });

  test("a book-pr-closed run deletes the previews of the closed pull requests with that head", () => {
    const result = run(
      { WORKFLOW: "book-pr-closed" },
      {
        "repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100": [
          { number: 8, head: { sha: SHA } },
          { number: 11, head: { sha: OTHER } },
        ],
      },
    );
    assert.deepEqual(result.outputs, { newest: "false", previews: "[]", deletions: "[8]" });
  });

  test("refuses a head SHA that is not a commit SHA", () => {
    const result = run({ HEAD_SHA: "main; curl evil" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not a commit SHA/);
  });

  test("refuses an answer that is not a list of pull request numbers", () => {
    const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: [{ ...pulls[0], number: "7; rm -rf /" }] });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /something other than pull request numbers/);
  });
});
