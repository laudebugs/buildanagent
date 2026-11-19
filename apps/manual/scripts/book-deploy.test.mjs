// Offline checks for the book's deploy workflows, .github/workflows/book-deploy.yml and book-pr-closed.yml: what
// triggers them, what each job may do, which steps see a Cloudflare secret, and how the secrets check, the resolve
// step, the preview's URL check and the comment script behave when run under bash. The resolve and comment steps run
// against stand-in `gh` commands that answer from fixtures through jq, so their jq filters run too and nothing
// touches the network. Run with `node --test scripts/*.test.mjs` from apps/manual.
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
    assert.deepEqual(jobs.comment.permissions, { "pull-requests": "write" });
    assert.deepEqual(jobs["comment-deleted"].permissions, { "pull-requests": "write" });
  });

  test("only the two comment jobs may write, and only to pull requests; no job holding a secret may write", () => {
    for (const [name, job] of Object.entries(jobs)) {
      const writes = Object.entries(job.permissions).filter(([, level]) => level !== "read");
      const expected = name.startsWith("comment") ? [["pull-requests", "write"]] : [];
      assert.deepEqual(writes, expected, name);
      if (job.environment !== undefined) assert.deepEqual(writes, [], `${name} holds a secret`);
    }
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
    assert.equal(jobs.comment.environment, undefined);
    assert.equal(jobs["comment-deleted"].environment, undefined);
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

  test("a preview needs a pull_request run, and each pull request's previews and deletion share one queue", () => {
    assert.match(jobs.preview.if, /github\.event\.workflow_run\.event == 'pull_request'/);
    assert.match(jobs["delete-preview"].if, /github\.event\.workflow_run\.name == 'book-pr-closed'/);
    assert.deepEqual(jobs.preview.concurrency, jobs["delete-preview"].concurrency);
    // Keyed by pull request, not branch: two pull requests from one branch never replace each other's waiting run.
    assert.equal(jobs.preview.concurrency.group, `book-preview-pr-\${{ matrix.number }}`);
    // fail-fast: false, so one pull request's failed job never cancels another's.
    assert.deepEqual(jobs.preview.strategy, {
      "fail-fast": false,
      matrix: { number: `\${{ fromJSON(needs.resolve.outputs.previews) }}` },
    });
    assert.deepEqual(jobs["delete-preview"].strategy, {
      "fail-fast": false,
      matrix: { number: `\${{ fromJSON(needs.resolve.outputs.deletions) }}` },
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

  // Comments wrap at 120 columns, as Biome wraps the code; script lines and expressions may run longer.
  test("no comment in either book workflow runs past 120 columns", () => {
    for (const file of ["book-deploy.yml", "book-pr-closed.yml"]) {
      const long = readFileSync(join(workflows, file), "utf8")
        .split("\n")
        .filter((line) => /^\s*#/.test(line) && line.length > 120);
      assert.deepEqual(long, [], file);
    }
  });

  test("the deploy jobs share one definition of each common step, written once as a YAML anchor", () => {
    const [production, preview, deletion] = ["production", "preview", "delete-preview"].map((n) => jobs[n].steps);
    assert.deepEqual(preview.slice(0, 6), production.slice(0, 6));
    assert.deepEqual(deletion.slice(0, 5), [production[0], production[1], production[3], production[4], production[5]]);
    assert.equal((deployText.match(/^ {6}- &[a-z-]+$/gm) ?? []).length, 6);
  });

  test("a preview stages and guards the noindex variant of _headers, and production the plain copy", () => {
    const runs = (name) => jobs[name].steps.map((step) => step.run ?? "");
    assert.ok(runs("preview").some((r) => /stage-dist\.mjs .* apps\/manual\/public\/_headers --preview$/.test(r)));
    assert.ok(runs("preview").includes("node apps/manual/scripts/guard-deploy.mjs --preview"));
    assert.ok(runs("production").some((r) => /stage-dist\.mjs .*_headers$/.test(r)));
    assert.ok(runs("production").includes("node apps/manual/scripts/guard-deploy.mjs"));
    assert.doesNotMatch(runs("production").join("\n"), /--preview/);
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
      const wrangler = job.steps.findIndex((step) => /pnpm exec wrangler/.test(step.run ?? ""));
      assert.deepEqual(readers, [0, wrangler], name);
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

  const head = (sha, repo = REPO) => ({ sha, repo: { full_name: repo } });
  const base = { repo: { full_name: REPO } };
  const pulls = [
    { number: 7, state: "open", head: head(SHA), base },
    { number: 8, state: "closed", head: head(SHA), base },
    { number: 9, state: "open", head: head(OTHER), base },
    { number: 10, state: "open", head: head(SHA), base: { repo: { full_name: "fork/repo" } } },
    { number: 12, state: "open", head: head(SHA, "fork/repo"), base },
    { number: 13, state: "open", head: { sha: SHA, repo: null }, base },
  ];

  test("a pull request run previews only open pull requests from a branch of this repository, at the commit", () => {
    const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { newest: "false", previews: "[7]", deletions: "[]" });
  });

  test("a fork's pull request gets no preview, even into this repository", () => {
    const result = run({}, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls.slice(4) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.previews, "[]");
    assert.match(result.stdout, /from a branch of owner\/repo/);
  });

  // A fork can open a pull request whose head is the same commit as a branch's open pull request. Its run's
  // artifact is the fork's own build, so it must never deploy to, or comment on, the branch's pull request.
  test("a fork-triggered run gets no preview, even when a branch's open pull request has the same commit", () => {
    const result = run({ HEAD_REPO: "fork/repo" }, { [`repos/owner/repo/commits/${SHA}/pulls`]: pulls });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.outputs, { newest: "false", previews: "[]", deletions: "[]" });
    assert.match(result.stdout, /fork\/repo, a fork, so nothing is previewed or deleted/);
  });

  test("a fork-triggered book-pr-closed run deletes nothing, even a branch's closed pull request at that commit", () => {
    const result = run(
      { WORKFLOW: "book-pr-closed", HEAD_REPO: "fork/repo" },
      {
        "repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100": [
          { number: 8, head: head(SHA) },
        ],
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.deletions, "[]");
    assert.match(result.stdout, /fork\/repo, a fork, so nothing is previewed or deleted/);
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
          { number: 8, head: head(SHA) },
          { number: 11, head: head(OTHER) },
          { number: 12, head: head(SHA, "fork/repo") },
        ],
      },
    );
    // A fork's pull request never had a preview, so it has none to delete.
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

describe("the comment jobs", () => {
  const comment = jobs.comment;
  const deleted = jobs["comment-deleted"];

  test("run after their deploy job whatever its result, unless the run was cancelled, once per pull request", () => {
    assert.deepEqual(comment.needs, ["resolve", "preview"]);
    assert.deepEqual(deleted.needs, ["resolve", "delete-preview"]);
    for (const [job, list, workflow] of [
      [comment, "previews", "book-build"],
      [deleted, "deletions", "book-pr-closed"],
    ]) {
      assert.match(job.if, /^!cancelled\(\) &&/);
      assert.ok(job.if.includes(`github.event.workflow_run.name == '${workflow}'`));
      assert.ok(job.if.includes("needs.resolve.result == 'success'"));
      assert.ok(job.if.includes(`needs.resolve.outputs.${list} != '[]'`));
      assert.doesNotMatch(job.if, /\|\|/);
      assert.deepEqual(job.strategy, {
        "fail-fast": false,
        matrix: { number: `\${{ fromJSON(needs.resolve.outputs.${list}) }}` },
      });
    }
  });

  test("name no environment, read no secret, check nothing out and run no action but the artifact download", () => {
    for (const job of [comment, deleted]) {
      assert.equal(job.environment, undefined);
      assert.doesNotMatch(JSON.stringify(job), /secrets\./);
      const actions = job.steps.filter((step) => step.uses).map((step) => step.uses);
      assert.deepEqual(actions, ["actions/download-artifact@v8.0.2"]);
      const download = job.steps[0];
      assert.equal(download["continue-on-error"], true);
      // The same run's artifact, so no token and no run-id: the job has no actions permission to lend one.
      assert.deepEqual(Object.keys(download.with).sort(), ["name", "path"]);
    }
    assert.equal(comment.steps[0].with.name, `book-preview-urls-\${{ matrix.number }}`);
    assert.equal(deleted.steps[0].with.name, `book-preview-deleted-\${{ matrix.number }}`);
  });

  test("both run the same comment script, and pass every value through env", () => {
    assert.equal(comment.steps[1].run, deleted.steps[1].run);
    assert.equal(comment.steps[1].env.MODE, "preview");
    assert.equal(deleted.steps[1].env.MODE, "deleted");
    for (const job of [comment, deleted]) {
      assert.equal(job.steps[1].env.GH_TOKEN, `\${{ github.token }}`);
      assert.equal(job.steps[1].env.HEAD_SHA, `\${{ github.event.workflow_run.head_sha }}`);
      assert.equal(job.steps[1].env.NUMBER, `\${{ matrix.number }}`);
    }
  });

  test("the deploy jobs hand on one artifact per pull request, after Wrangler, without failing the deploy", () => {
    for (const [job, name, after] of [
      [jobs.preview, "book-preview-urls", "record"],
      [jobs["delete-preview"], "book-preview-deleted", "delete"],
    ]) {
      const upload = job.steps.at(-1);
      assert.equal(upload.uses, "actions/upload-artifact@v7.0.2");
      assert.equal(upload.with.name, `${name}-\${{ matrix.number }}`);
      assert.equal(upload["continue-on-error"], true);
      assert.equal(upload.with.overwrite, true);
      assert.match(upload.if, new RegExp(`^steps\\.${after}\\.outputs\\.`));
      // The upload holds no secret: it is not the Wrangler step.
      assert.doesNotMatch(JSON.stringify(upload), /secrets\./);
    }
    const record = jobs.preview.steps.find((step) => step.id === "record");
    assert.equal(record.if, undefined, "the record step runs only after a successful preview");
    assert.doesNotMatch(JSON.stringify(record), /secrets\./);
    assert.match(
      jobs.preview.steps.find((step) => /wrangler preview/.test(step.run ?? "")).env.WRANGLER_OUTPUT_FILE_PATH,
      /^\$\{\{ runner\.temp \}\}\/wrangler-output\.jsonl$/,
    );
  });
});

describe("the preview's URL check", () => {
  const record = jobs.preview.steps.find((step) => step.id === "record");
  const ALIAS = "https://pr-7.manual.buildanagent.fyi";
  // The form Wrangler 4.160.1 printed for PR #89 (run 44588564990): an 8-hex-digit deployment id, no -pr-<n>.
  const VERSION = "https://40f313de.manual.buildanagent.fyi";

  // Runs the record step on Wrangler output lines and returns its result and the URL file, if it wrote one.
  function recordWith(lines, number = "7") {
    const dir = mkdtempSync(join(work, "record-"));
    const output = join(dir, "wrangler-output.jsonl");
    if (lines !== null) writeFileSync(output, lines.map((line) => JSON.stringify(line)).join("\n"));
    const result = runStep(record.run, { NUMBER: number, OUTPUT_FILE: output, URLS_DIR: join(dir, "urls") });
    const file = join(dir, "urls", "urls.txt");
    let urls = null;
    try {
      urls = readFileSync(file, "utf8");
    } catch {}
    return { ...result, urls };
  }
  const entry = (preview_urls, deployment_urls) => ({ type: "preview", version: 1, preview_urls, deployment_urls });

  test("keeps the custom-domain alias and the commit's URL, dropping workers.dev and other entries", () => {
    const result = recordWith([
      { type: "wrangler-session", version: 1 },
      entry(
        ["https://pr-7-buildanagent-manual.example.workers.dev", `${ALIAS}/`],
        ["https://1a2b3c4d-buildanagent-manual.example.workers.dev", VERSION],
      ),
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.urls, `${ALIAS}\n${VERSION}\n`);
    assert.equal(result.outputs.found, "true");
  });

  test("keeps the URLs Wrangler 4.160.1 printed for pull request #89, a bare 8-hex-digit id on the custom domain", () => {
    const alias = "https://pr-89.manual.buildanagent.fyi";
    const result = recordWith([entry([alias], ["https://40f313de.manual.buildanagent.fyi"])], "89");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.urls, `${alias}\nhttps://40f313de.manual.buildanagent.fyi\n`);
    assert.equal(result.outputs.found, "true");
  });

  test("keeps any 8 lowercase hex digits as the commit's id", () => {
    for (const id of ["00000000", "ffffffff", "0123abcd"]) {
      const result = recordWith([entry([ALIAS], [`https://${id}.manual.buildanagent.fyi`])]);
      assert.equal(result.outputs.found, "true", id);
    }
  });

  const hostile = [
    ["another host", "https://pr-7.manual.buildanagent.fyi.evil.example", VERSION],
    ["a sibling site", "https://pr-7.buildanagent.fyi", VERSION],
    ["http", "http://pr-7.manual.buildanagent.fyi", VERSION],
    ["another pull request", "https://pr-8.manual.buildanagent.fyi", VERSION],
    ["a path", `${ALIAS}/x`, VERSION],
    ["user info", "https://evil@pr-7.manual.buildanagent.fyi", VERSION],
    ["a port", "https://pr-7.manual.buildanagent.fyi:8443", VERSION],
    ["a newline", `${ALIAS}\nhttps://evil.example`, VERSION],
    ["a commit URL on another host", ALIAS, "https://40f313de.evil.example"],
    ["a commit URL under another host", ALIAS, "https://40f313de.manual.buildanagent.fyi.evil.example"],
    ["a commit URL on a sibling site", ALIAS, "https://40f313de.buildanagent.fyi"],
    ["a commit URL over http", ALIAS, "http://40f313de.manual.buildanagent.fyi"],
    ["a commit URL with a path", ALIAS, `${VERSION}/x`],
    ["production as the commit URL", ALIAS, "https://manual.buildanagent.fyi"],
    ["the docs' <id>-pr-<n> form", ALIAS, "https://1a2b3c4d-pr-7.manual.buildanagent.fyi"],
    ["another pull request's alias as the commit URL", ALIAS, "https://pr-8.manual.buildanagent.fyi"],
    ["7 hex digits", ALIAS, "https://40f313d.manual.buildanagent.fyi"],
    ["9 hex digits", ALIAS, "https://40f313de0.manual.buildanagent.fyi"],
    ["uppercase hex", ALIAS, "https://40F313DE.manual.buildanagent.fyi"],
    ["a letter past f", ALIAS, "https://40f313dg.manual.buildanagent.fyi"],
    ["an extra label", ALIAS, "https://x.40f313de.manual.buildanagent.fyi"],
    ["an extra label after the id", ALIAS, "https://40f313de.x.manual.buildanagent.fyi"],
    ["a quote", ALIAS, 'https://40f3"3de.manual.buildanagent.fyi'],
    ["a space", ALIAS, "https://40f3 3de.manual.buildanagent.fyi"],
    ["markdown", ALIAS, "https://[x](https://evil.example).manual.buildanagent.fyi"],
    ["a newline in the commit URL", ALIAS, `${VERSION}\n- [click](https://evil.example)`],
    ["a very long label", ALIAS, `https://${"a".repeat(5000)}.manual.buildanagent.fyi`],
    ["the alias as the commit URL", ALIAS, ALIAS],
  ];
  const NO_PREVIEW = /::warning::Wrangler reported no preview URL on manual\.buildanagent\.fyi for pr-7/;
  const NO_COMMIT_URL =
    /::warning::Wrangler reported pr-7's preview URL but no commit URL of the form https:\/\/<8 lowercase hex>\.manual\.buildanagent\.fyi\. It listed \d+ deployment URL\(s\), all rejected\. Cloudflare may have changed the deployment id's form/;
  for (const [name, alias, version] of hostile) {
    test(`refuses ${name}, so no URL file and no comment`, () => {
      const result = recordWith([entry([alias], [version])]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.urls, null);
      assert.equal(result.outputs.found, "false");
      // A good alias with a bad commit URL gets the warning that the id's form changed; a bad alias gets the other.
      assert.match(result.stdout, alias === ALIAS ? NO_COMMIT_URL : NO_PREVIEW);
      assert.doesNotMatch(result.stdout, alias === ALIAS ? NO_PREVIEW : NO_COMMIT_URL);
    });
  }

  test("the alias with a commit URL of another form warns that the id's form changed and never prints that URL", () => {
    const other = "https://1a2b3c4d-pr-7.manual.buildanagent.fyi";
    const result = recordWith([entry([ALIAS], [other, "https://1a2b3c4d-buildanagent-manual.example.workers.dev"])]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.urls, null);
    assert.equal(result.outputs.found, "false");
    assert.match(result.stdout, NO_COMMIT_URL);
    assert.match(result.stdout, /It listed 2 deployment URL\(s\)/);
    assert.doesNotMatch(result.stdout, NO_PREVIEW);
    assert.doesNotMatch(result.stdout, /1a2b3c4d/);
  });

  test("the alias with no commit URL at all warns that the id's form changed", () => {
    const result = recordWith([entry([ALIAS], [])]);
    assert.equal(result.urls, null);
    assert.equal(result.outputs.found, "false");
    assert.match(result.stdout, NO_COMMIT_URL);
    assert.match(result.stdout, /It listed 0 deployment URL\(s\)/);
  });

  test("neither the alias nor the commit URL keeps the no-preview warning alone", () => {
    const result = recordWith([entry(["https://pr-7-buildanagent-manual.example.workers.dev"], ["https://x.example"])]);
    assert.equal(result.urls, null);
    assert.equal(result.outputs.found, "false");
    assert.match(result.stdout, NO_PREVIEW);
    assert.doesNotMatch(result.stdout, NO_COMMIT_URL);
  });

  test("a newline inside a URL never splits it into two accepted lines", () => {
    // jq would print the string on two lines, the first of them a perfect alias; the character check drops it whole.
    const result = recordWith([entry([`${ALIAS}\n${ALIAS}`], [VERSION])]);
    assert.equal(result.urls, null);
  });

  test("no output file, no preview entry or no URLs records nothing", () => {
    for (const lines of [null, [], [{ type: "deploy", targets: [ALIAS] }], [entry([], [])], [entry(null, null)]]) {
      const result = recordWith(lines);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.urls, null);
    }
  });

  test("refuses a pull request number that is not one", () => {
    assert.equal(recordWith([entry([ALIAS], [VERSION])], "7; true").status, 1);
  });
});

describe("the comment script", () => {
  const script = jobs.comment.steps[1].run;
  const SHA = "c".repeat(40);
  const REPO = "owner/repo";
  const ALIAS = "https://pr-7.manual.buildanagent.fyi";
  // The form Wrangler 4.160.1 printed for PR #89 (run 44588564990): an 8-hex-digit deployment id, no -pr-<n>.
  const VERSION = "https://40f313de.manual.buildanagent.fyi";
  const bot = { login: "github-actions[bot]", type: "Bot" };
  const BODY = [
    "<!-- book-preview -->",
    "**Book preview** of ccccccc",
    "",
    `- Pull request preview, which follows its newest commit: ${ALIAS}`,
    `- This commit only: ${VERSION}`,
  ].join("\n");
  const DELETED_BODY = [
    "<!-- book-preview -->",
    `**Book preview deleted.** The pull request closed, so ${ALIAS} no longer serves it.`,
  ].join("\n");

  // A stand-in for the `gh api` calls the script makes. It keeps the pull request and its comments in a state file,
  // answers reads through jq, applies POST and PATCH to the state, and fails on any flag the script should not use.
  function fakeGh(state) {
    const dir = mkdtempSync(join(work, "gh-comment-"));
    mkdirSync(join(dir, "bin"));
    const stateFile = join(dir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ nextId: 100, fail: false, ...state }));
    const gh = join(dir, "bin", "gh");
    writeFileSync(
      gh,
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
if (state.fail) { console.error("HTTP 502"); process.exit(1); }
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
    chmodSync(gh, 0o755);
    const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
    const calls = () => {
      try {
        return readFileSync(`${stateFile}.calls`, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      } catch {
        return [];
      }
    };
    return { PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, read, calls, dir };
  }

  function signal(dir, text) {
    const file = join(dir, "signal.txt");
    if (text !== null) writeFileSync(file, text);
    return file;
  }

  const open = { state: "open", head: { sha: SHA } };
  const run = (gh, { mode = "preview", signalText = `${ALIAS}\n${VERSION}\n`, ...env } = {}) =>
    runStep(script, {
      PATH: gh.PATH,
      GH_TOKEN: "test",
      REPO,
      NUMBER: "7",
      HEAD_SHA: SHA,
      MODE: mode,
      SIGNAL: signal(gh.dir, signalText),
      ...env,
    });
  const writes = (gh) => gh.calls().filter((call) => call.method !== "GET");

  test("creates one comment holding only the marker, the short SHA and the two URLs", () => {
    const gh = fakeGh({ pull: open, comments: [] });
    const result = run(gh);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(gh.read().comments, [{ id: 100, user: bot, body: BODY }]);
    assert.deepEqual(writes(gh), [
      { method: "POST", path: "repos/owner/repo/issues/7/comments", fields: { body: BODY } },
    ]);
  });

  test("updates its own comment on the next preview instead of adding a second", () => {
    const gh = fakeGh({ pull: open, comments: [] });
    run(gh);
    const NEXT = "d".repeat(40);
    // The next commit's preview: the pull request's head moves on, and so does the comment.
    const state = gh.read();
    state.pull = { state: "open", head: { sha: NEXT } };
    writeFileSync(join(gh.dir, "state.json"), JSON.stringify(state));
    const next = "https://9f8e7d6c.manual.buildanagent.fyi";
    const result = run(gh, { HEAD_SHA: NEXT, signalText: `${ALIAS}\n${next}\n` });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const { comments } = gh.read();
    assert.equal(comments.length, 1);
    assert.match(comments[0].body, /of ddddddd\n/);
    assert.match(comments[0].body, /This commit only: https:\/\/9f8e7d6c\.manual\./);
    assert.equal(writes(gh).at(-1).method, "PATCH");
    assert.equal(writes(gh).at(-1).path, "repos/owner/repo/issues/comments/100");
  });

  test("never edits a person's comment, or another bot comment, that carries the marker", () => {
    const person = { id: 5, user: { login: "someone", type: "User" }, body: "<!-- book-preview -->\nmine" };
    const lookalike = { id: 6, user: { login: "github-actions", type: "User" }, body: "<!-- book-preview -->\nx" };
    const quoting = { id: 7, user: bot, body: "Another workflow's comment\n<!-- book-preview -->" };
    const gh = fakeGh({ pull: open, comments: [person, lookalike, quoting] });
    run(gh);
    const { comments } = gh.read();
    assert.deepEqual(comments.slice(0, 3), [person, lookalike, quoting]);
    assert.deepEqual(comments[3], { id: 100, user: bot, body: BODY });
  });

  test("posts nothing for a closed pull request or one whose head has moved on", () => {
    for (const pull of [
      { state: "closed", head: { sha: SHA } },
      { state: "open", head: { sha: "d".repeat(40) } },
    ]) {
      const gh = fakeGh({ pull, comments: [] });
      const result = run(gh);
      assert.equal(result.status, 0);
      assert.deepEqual(writes(gh), []);
      assert.match(result.stdout, /closed or has a newer commit/);
    }
  });

  test("posts nothing when the preview handed on no URLs, so a failed preview leaves no stale URL", () => {
    const gh = fakeGh({ pull: open, comments: [{ id: 3, user: bot, body: BODY }] });
    const result = run(gh, { signalText: null });
    assert.equal(result.status, 0);
    assert.deepEqual(gh.calls(), []);
    assert.match(result.stdout, /no new preview/);
  });

  for (const [name, text] of [
    ["another alias", `https://pr-8.manual.buildanagent.fyi\n${VERSION}\n`],
    ["another host", `${ALIAS}\nhttps://40f313de.evil.example\n`],
    ["a third line", `${ALIAS}\n${VERSION}\n- [click](https://evil.example)\n`],
    ["a quote", `${ALIAS}\nhttps://40f3"3de.manual.buildanagent.fyi\n`],
    ["one line", `${ALIAS}\n`],
    ["a long file", `${ALIAS}\nhttps://${"a".repeat(300)}.manual.buildanagent.fyi\n`],
    ["production as the commit URL", `${ALIAS}\nhttps://manual.buildanagent.fyi\n`],
    ["the alias as the commit URL", `${ALIAS}\n${ALIAS}\n`],
    ["the docs' <id>-pr-<n> form", `${ALIAS}\nhttps://1a2b3c4d-pr-7.manual.buildanagent.fyi\n`],
    ["7 hex digits", `${ALIAS}\nhttps://40f313d.manual.buildanagent.fyi\n`],
    ["9 hex digits", `${ALIAS}\nhttps://40f313de0.manual.buildanagent.fyi\n`],
    ["uppercase hex", `${ALIAS}\nhttps://40F313DE.manual.buildanagent.fyi\n`],
    ["an extra label", `${ALIAS}\nhttps://x.40f313de.manual.buildanagent.fyi\n`],
    ["a commit URL on a sibling site", `${ALIAS}\nhttps://40f313de.buildanagent.fyi\n`],
  ]) {
    test(`re-checks the handed-on file and refuses ${name}, warning without failing`, () => {
      const gh = fakeGh({ pull: open, comments: [] });
      const result = run(gh, { signalText: text });
      assert.equal(result.status, 0);
      assert.deepEqual(gh.calls(), []);
      assert.match(result.stdout, /^::warning::No preview comment on pull request #7: /m);
    });
  }

  test("an API failure warns and exits 0, so the deploy never fails on a comment", () => {
    const gh = fakeGh({ pull: open, comments: [], fail: true });
    const result = run(gh);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /::warning::No preview comment on pull request #7: the pull request could not be read/);
  });

  test("refuses a number or SHA that is not one before any API call", () => {
    for (const env of [{ NUMBER: "7 --method DELETE" }, { HEAD_SHA: "main" }]) {
      const gh = fakeGh({ pull: open, comments: [] });
      const result = run(gh, env);
      assert.equal(result.status, 0);
      assert.deepEqual(gh.calls(), []);
      assert.match(result.stdout, /::warning::/);
    }
  });

  test("after a deletion, edits the same comment to say the preview is gone", () => {
    const gh = fakeGh({ pull: open, comments: [] });
    run(gh);
    const result = run(gh, { mode: "deleted", signalText: "deleted\n" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(gh.read().comments, [{ id: 100, user: bot, body: DELETED_BODY }]);
  });

  test("after a deletion, creates no comment where none was, and edits none when the deletion failed", () => {
    const none = fakeGh({ pull: open, comments: [] });
    assert.equal(run(none, { mode: "deleted", signalText: "deleted\n" }).status, 0);
    assert.deepEqual(writes(none), []);
    const failed = fakeGh({ pull: open, comments: [{ id: 3, user: bot, body: BODY }] });
    const result = run(failed, { mode: "deleted", signalText: null });
    assert.equal(result.status, 0);
    assert.deepEqual(failed.calls(), []);
    assert.match(result.stdout, /was not deleted/);
  });
});
