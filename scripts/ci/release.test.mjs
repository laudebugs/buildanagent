// Offline checks for the release workflow: the shape of .github/workflows/release.yml, which must never read an npm
// token and must publish only from a push to main, and the decisions scripts/ci/release-plan.mjs makes. The plan
// tests stub the registry, so nothing here touches the network. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  changelogSection,
  formatOutputs,
  hasGitHubRelease,
  isPublished,
  planRelease,
  releaseNotes,
} from "./release-plan.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowText = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const workflow = parse(workflowText);
const { jobs } = workflow;

describe("release.yml", () => {
  test("no job reads an npm token or any secret", () => {
    assert.doesNotMatch(workflowText, /secrets\./);
    assert.doesNotMatch(workflowText, /_authToken/);
    const envKeys = (env) => Object.keys(env ?? {});
    for (const [name, job] of Object.entries(jobs)) {
      const keys = [...envKeys(workflow.env), ...envKeys(job.env), ...(job.steps ?? []).flatMap((s) => envKeys(s.env))];
      // GH_TOKEN is the run's own GITHUB_TOKEN, for gh; any other token or auth variable could reach npm.
      for (const key of keys) assert.ok(key === "GH_TOKEN" || !/TOKEN|AUTH/i.test(key), `${name} sets ${key}`);
      for (const step of job.steps ?? []) {
        assert.equal(
          step.with?.["registry-url"],
          undefined,
          `${name}: setup-node's registry-url writes a token .npmrc`,
        );
      }
    }
  });

  test("job-level env reads no context GitHub rejects there", () => {
    // GitHub refuses the whole workflow when a job's `env:` names the `runner` context, which only steps can read.
    for (const [name, job] of Object.entries(jobs)) {
      for (const value of Object.values(job.env ?? {})) assert.doesNotMatch(String(value), /runner\./, name);
    }
  });

  test("runs on pushes to main and on workflow_dispatch only", () => {
    assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "workflow_dispatch"]);
    assert.deepEqual(workflow.on.push.branches, ["main"]);
    assert.deepEqual(workflow.permissions, { contents: "read" });
  });

  test("the publish job uses trusted publishing on a GitHub-hosted runner in the release environment", () => {
    const { publish } = jobs;
    assert.match(publish["runs-on"], /^ubuntu-/);
    assert.equal(publish.environment, "release");
    assert.deepEqual(publish.permissions, { contents: "write", "id-token": "write" });
    assert.match(publish.if, /github\.event_name == 'push'/);
    assert.match(publish.if, /github\.ref == 'refs\/heads\/main'/);
    const runs = publish.steps.map((step) => step.run ?? "").join("\n");
    assert.match(runs, /npm install --global npm@\d+\.\d+\.\d+\n/, "npm is installed at an exact version");
    const [, npmVersion] = runs.match(/npm@(\d+\.\d+\.\d+)/);
    const [major, minor, patch] = npmVersion.split(".").map(Number);
    assert.ok(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))), "npm 11.5.1 or later");
    assert.match(runs, /test "\$\(npm --version\)" = "11\.21\.2"/);
    assert.ok(!publish.steps.some((step) => step.uses?.startsWith("actions/checkout")), "publish checks nothing out");
    assert.doesNotMatch(runs, /pnpm/, "publish runs no pnpm");
    const installs = runs.match(/\bnpm +(i|ci|install|add|isntall)\b.*$/gm) ?? [];
    assert.deepEqual(installs, ["npm install --global npm@11.21.2"], "publish installs nothing but npm");
  });

  test("the token guard prints variable names, never values", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Check the toolchain and that no npm token is present");
    assert.match(step.run, /env \| cut -d= -f1 \| grep /);
  });

  test("the tag step branches on gh's exit status and peels annotated tags", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Tag the release and create its GitHub release");
    assert.doesNotMatch(step.run, /\|\| true/, "a failed lookup must not read as an answer");
    assert.match(step.run, /if ref=\$\(gh api "repos\/\$REPO\/git\/ref\/tags\/\$TAG"/);
    assert.match(step.run, /elif ! grep -q "HTTP 404"/);
    assert.match(step.run, /gh api "repos\/\$REPO\/git\/tags\/\$existing" --jq \.object\.sha/);
  });

  test("the tarballs outlive the release environment's 30-day approval wait", () => {
    const upload = jobs.pack.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"));
    assert.ok(upload.with["retention-days"] >= 30);
  });

  test("the publish job publishes packed tarballs, gateway first", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Publish each tarball, gateway first");
    assert.match(step.run, /for pkg in gateway sdk; do/);
    assert.match(
      step.run,
      /npm publish "\$RELEASE_DIR\/buildanagent-\$pkg-\$VERSION\.tgz" --access public --provenance/,
    );
    const [first] = jobs.publish.steps;
    assert.match(first.run, /^echo "registry=https:\/\/registry\.npmjs\.org\/" > "\$RUNNER_TEMP\/npmrc"$/m);
    assert.match(first.run, /^ {2}echo "NPM_CONFIG_USERCONFIG=\$RUNNER_TEMP\/npmrc"$/m);
  });

  test("only the publish job can mint an OIDC token, and only the docs job can start workflows", () => {
    for (const [name, job] of Object.entries(jobs)) {
      const permissions = job.permissions ?? workflow.permissions;
      if (name !== "publish") assert.equal(permissions["id-token"], undefined, name);
      if (name !== "docs") assert.equal(permissions.actions, undefined, name);
    }
    assert.deepEqual(jobs.docs.permissions, { actions: "write" });
  });

  test('the "Version packages" pull request stays off until L4b', () => {
    assert.match(jobs["version-pr"].if, /^false && /);
  });

  test("the docs deploy is skipped while docs-deploy.yml is missing", () => {
    assert.equal(jobs.docs.if, "needs.plan.outputs.docs_deploy == 'true'");
    assert.match(jobs.docs.steps[0].run, /gh workflow run docs-deploy\.yml .*-f tag="\$TAG"/);
  });

  test("a workflow_dispatch runs only the plan and the pack (a dry run)", () => {
    assert.match(jobs.pack.if, /github\.event_name == 'workflow_dispatch'/);
    assert.equal(jobs.pack.permissions, undefined, "pack keeps the read-only default");
    for (const name of ["version-pr", "publish"]) assert.match(jobs[name].if, /github\.event_name == 'push'/, name);
    // The docs job needs publish, so it is skipped whenever publish is.
    assert.ok(jobs.docs.needs.includes("publish"));
  });
});

describe("release-plan.mjs", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fixture({ version = "0.1.0", private: isPrivate = false, changesets = [], docsDeploy = false } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "release-plan-"));
    dirs.push(dir);
    for (const pkg of ["gateway", "sdk"]) {
      mkdirSync(path.join(dir, "packages", pkg), { recursive: true });
      const manifest = { name: `@buildanagent/${pkg}`, version, ...(isPrivate ? { private: true } : {}) };
      writeFileSync(path.join(dir, "packages", pkg, "package.json"), JSON.stringify(manifest));
      writeFileSync(
        path.join(dir, "packages", pkg, "CHANGELOG.md"),
        `# @buildanagent/${pkg}\n\n## ${version}\n\n### Minor Changes\n\n- ${pkg} change\n\n## 0.0.9\n\n- older\n`,
      );
    }
    mkdirSync(path.join(dir, ".changeset"));
    writeFileSync(path.join(dir, ".changeset", "README.md"), "# Changesets\n");
    for (const name of changesets) writeFileSync(path.join(dir, ".changeset", name), "---\n---\n");
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    if (docsDeploy) writeFileSync(path.join(dir, ".github", "workflows", "docs-deploy.yml"), "name: docs-deploy\n");
    writeFileSync(path.join(dir, ".nvmrc"), "22\n");
    return dir;
  }

  const repo = "laudebugs/buildanagent";

  // A registry and GitHub stub: `published` lists the package names npm holds at any version, `releases` the tags
  // GitHub has a release for, and `status` (or `githubStatus`) overrides every registry (or GitHub) answer.
  function registry(published = [], status, { releases = [], githubStatus } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (url.startsWith("https://api.github.com/")) {
        calls.auth = init?.headers?.authorization;
        if (githubStatus) return { status: githubStatus };
        return { status: releases.some((tag) => url.endsWith(`/releases/tags/${tag}`)) ? 200 : 404 };
      }
      if (status) return { status };
      return { status: published.some((name) => url.includes(name.replace("/", "%2f"))) ? 200 : 404 };
    };
    return { fetchImpl, calls };
  }

  test("skips private packages without asking the registry", async () => {
    const { fetchImpl, calls } = registry();
    const plan = await planRelease({ root: fixture({ private: true }), fetchImpl });
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /"private": true/);
    assert.equal(calls.length, 0);
  });

  test("never publishes 0.0.0, so dropping private alone publishes nothing", async () => {
    const plan = await planRelease({ root: fixture({ version: "0.0.0" }), fetchImpl: registry().fetchImpl });
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /0\.0\.0/);
  });

  test("waits for the Version packages pull request while changesets are pending", async () => {
    const plan = await planRelease({
      root: fixture({ changesets: ["brave-cats.md"] }),
      fetchImpl: registry().fetchImpl,
    });
    assert.equal(plan.publish, false);
    assert.equal(plan.pending, true);
  });

  test("publishes what npm lacks, in order, and nothing once npm holds both", async () => {
    const root = fixture();
    const none = await planRelease({ root, fetchImpl: registry().fetchImpl });
    assert.equal(none.publish, true);
    assert.deepEqual(none.toPublish, ["@buildanagent/gateway", "@buildanagent/sdk"]);
    const partial = await planRelease({ root, fetchImpl: registry(["@buildanagent/gateway"]).fetchImpl });
    assert.deepEqual(partial.toPublish, ["@buildanagent/sdk"]);
    const both = await planRelease({
      root,
      repo,
      fetchImpl: registry(["@buildanagent/gateway", "@buildanagent/sdk"], undefined, { releases: ["v0.1.0"] })
        .fetchImpl,
    });
    assert.equal(both.publish, false);
    assert.match(both.reason, /release v0\.1\.0 exists/);
  });

  test("still tags the release when npm holds both packages but the GitHub release is missing", async () => {
    const { fetchImpl, calls } = registry(["@buildanagent/gateway", "@buildanagent/sdk"]);
    const plan = await planRelease({ root: fixture(), repo, token: "t", fetchImpl });
    assert.equal(plan.publish, true);
    assert.deepEqual(plan.toPublish, []);
    assert.match(plan.reason, /v0\.1\.0 has no release/);
    assert.ok(calls.includes("https://api.github.com/repos/laudebugs/buildanagent/releases/tags/v0.1.0"));
    assert.equal(calls.auth, "Bearer t");
  });

  test("fails on a GitHub error, or without a repository, instead of guessing whether the release exists", async () => {
    const published = ["@buildanagent/gateway", "@buildanagent/sdk"];
    await assert.rejects(
      planRelease({
        root: fixture(),
        repo,
        fetchImpl: registry(published, undefined, { githubStatus: 502 }).fetchImpl,
      }),
      /answered 502/,
    );
    await assert.rejects(
      hasGitHubRelease(repo, "v0.1.0", { fetchImpl: registry([], undefined, { githubStatus: 403 }).fetchImpl }),
      /answered 403/,
    );
    await assert.rejects(
      planRelease({ root: fixture(), fetchImpl: registry(published).fetchImpl }),
      /GITHUB_REPOSITORY/,
    );
  });

  test("fails on a registry error instead of reading it as unpublished", async () => {
    await assert.rejects(planRelease({ root: fixture(), fetchImpl: registry([], 503).fetchImpl }), /answered 503/);
    await assert.rejects(isPublished("@buildanagent/sdk", "0.1.0", registry([], 429).fetchImpl), /answered 429/);
  });

  test("refuses prereleases and mismatched versions", async () => {
    await assert.rejects(
      planRelease({ root: fixture({ version: "0.2.0-beta.0" }), fetchImpl: registry().fetchImpl }),
      /not a plain x\.y\.z version/,
    );
    const root = fixture();
    writeFileSync(
      path.join(root, "packages", "sdk", "package.json"),
      JSON.stringify({ name: "@buildanagent/sdk", version: "0.2.0" }),
    );
    await assert.rejects(planRelease({ root, fetchImpl: registry().fetchImpl }), /share one version/);
  });

  test("reports whether docs-deploy.yml exists, and formats the outputs", async () => {
    const plan = await planRelease({ root: fixture({ docsDeploy: true }), fetchImpl: registry().fetchImpl });
    assert.equal(plan.docsDeploy, true);
    const outputs = formatOutputs(plan);
    assert.match(outputs, /^version=0\.1\.0$/m);
    assert.match(outputs, /^tag=v0\.1\.0$/m);
    assert.match(outputs, /^publish=true$/m);
    assert.match(outputs, /^docs_deploy=true$/m);
    assert.match(outputs, /^node=22$/m);
  });

  test("builds the release notes from each changelog's section", () => {
    assert.equal(changelogSection("## 1.0.0\n\n- a\n\n## 0.9.0\n- b\n", "1.0.0"), "- a");
    assert.equal(changelogSection("## 1.0.0\n- a\n", "2.0.0"), undefined);
    const notes = releaseNotes({ root: fixture(), version: "0.1.0" });
    assert.match(
      notes,
      /^## @buildanagent\/gateway\n\n### Minor Changes\n\n- gateway change\n\n## @buildanagent\/sdk\n/,
    );
    assert.doesNotMatch(notes, /older/);
    assert.throws(() => releaseNotes({ root: fixture(), version: "9.9.9" }), /no "## 9\.9\.9" section/);
  });
});
