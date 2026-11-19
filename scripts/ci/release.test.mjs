// Offline checks for the release workflow: the shape of .github/workflows/release.yml, which must never read an npm
// token, must version and publish only from a push to main, must keep RELEASE_PR_TOKEN in one step of a job that runs
// no third-party code, and must keep prereleases off `latest`, and the decisions
// scripts/ci/release-plan.mjs makes, including the plan this checkout gives once it is on main. The plan
// tests stub the registry, so nothing here touches the network. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  changelogSection,
  compareVersions,
  formatOutputs,
  hasGitHubRelease,
  isPublished,
  needsVersion,
  pendingChangesets,
  planRelease,
  preModeMismatch,
  readPreState,
  releaseNotes,
} from "./release-plan.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowText = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const workflow = parse(workflowText);
const { jobs } = workflow;

describe("release.yml", () => {
  test("no job reads an npm token, and only the version-pr job's push step reads a secret", () => {
    // The one secret is RELEASE_PR_TOKEN, which the step that pushes the version branch and enables auto-merge needs.
    const secrets = workflowText.match(/secrets\.[A-Za-z_]+/g) ?? [];
    assert.deepEqual(secrets, ["secrets.RELEASE_PR_TOKEN"]);
    assert.doesNotMatch(workflowText, /_authToken/);
    const readers = [];
    for (const [name, job] of Object.entries(jobs)) {
      if (JSON.stringify({ ...job, steps: undefined }).includes("secrets.")) readers.push(`${name} (job)`);
      for (const step of job.steps ?? []) if (JSON.stringify(step).includes("secrets.")) readers.push(name);
    }
    assert.deepEqual(readers, ["version-pr"]);
    const pushStep = jobs["version-pr"].steps.at(-1);
    assert.equal(pushStep.env.GH_TOKEN, `\${{ secrets.RELEASE_PR_TOKEN }}`);
    const envKeys = (env) => Object.keys(env ?? {});
    for (const [name, job] of Object.entries(jobs)) {
      const keys = [...envKeys(workflow.env), ...envKeys(job.env), ...(job.steps ?? []).flatMap((s) => envKeys(s.env))];
      // GH_TOKEN is the run's own GITHUB_TOKEN, or RELEASE_PR_TOKEN in the push step, for gh; any other token or auth
      // variable could reach npm.
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
    assert.deepEqual(workflow.permissions, {});
  });

  test("no run step expands an expression, so no event field can be injected into a script", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps ?? [])
        assert.doesNotMatch(step.run ?? "", /\$\{\{/, `${name}: ${step.name ?? step.run}`);
    }
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
    assert.match(step.run, /if \[ "\$PRERELEASE" = "true" \]; then flags\+=\(--prerelease\); fi/);
    assert.match(step.run, /--target "\$SHA"/, "the release tags the commit that was packed");
    assert.doesNotMatch(step.run, /GITHUB_SHA/);
  });

  test("the publish job refuses a prerelease under latest and a stable release under anything else", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Check the toolchain and that no npm token is present");
    assert.match(step.run, /\[ "\$DIST_TAG" != "latest" \]/);
    assert.match(step.run, /ok=\$\(\[ "\$DIST_TAG" = "latest" \]/);
  });

  test("the tarballs stay downloadable for 30 days, so a failed publish job can be re-run", () => {
    const upload = jobs.pack.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"));
    assert.ok(upload.with["retention-days"] >= 30);
  });

  test("the publish job publishes packed tarballs, gateway first", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Publish each tarball, gateway first");
    assert.match(step.run, /for pkg in gateway sdk; do/);
    assert.match(
      step.run,
      /npm publish "\$RELEASE_DIR\/buildanagent-\$pkg-\$VERSION\.tgz" --tag "\$DIST_TAG" --access public --provenance/,
    );
    assert.equal(jobs.publish.env.DIST_TAG, `\${{ needs.pack.outputs.dist_tag }}`);
    const [first] = jobs.publish.steps;
    assert.match(first.run, /^echo "registry=https:\/\/registry\.npmjs\.org\/" > "\$RUNNER_TEMP\/npmrc"$/m);
    assert.match(first.run, /^ {2}echo "NPM_CONFIG_USERCONFIG=\$RUNNER_TEMP\/npmrc"$/m);
  });

  test("the publish job gives npm separate user and global configs, and writes only the registry to them", () => {
    // npm exits with "double-loading config" when both settings name one file, which broke the first publish.
    const [first] = jobs.publish.steps;
    const user = first.run.match(/NPM_CONFIG_USERCONFIG=(\S+)"/)?.[1];
    const global = first.run.match(/NPM_CONFIG_GLOBALCONFIG=(\S+)"/)?.[1];
    assert.ok(user && global, "both config paths are set");
    assert.notEqual(user, global);
    // Collects every line that writes to either file, so a token written to one of them fails the test.
    const writes = first.run.split("\n").filter((line) => line.includes(`"${user}"`) || line.includes(`"${global}"`));
    assert.deepEqual(writes, [`echo "registry=https://registry.npmjs.org/" > "${user}"`, `: > "${global}"`]);
  });

  test("each job names its permissions, only publish can mint an OIDC token or write, and only docs dispatches", () => {
    for (const [name, job] of Object.entries(jobs)) {
      assert.ok(job.permissions, `${name} relies on the workflow's empty default`);
      if (name !== "publish") assert.equal(job.permissions["id-token"], undefined, name);
      if (name !== "docs") assert.equal(job.permissions.actions, undefined, name);
      if (name !== "publish") assert.notEqual(job.permissions.contents, "write", name);
      if (name !== "publish") assert.equal(job.permissions["pull-requests"], undefined, name);
    }
    assert.deepEqual(jobs.docs.permissions, { actions: "write" });
    for (const name of ["plan", "version", "version-pr", "pack"]) {
      assert.deepEqual(jobs[name].permissions, { contents: "read" }, name);
    }
  });

  test("the version job runs Changesets on the newest main with a read-only token and pushes nothing", () => {
    const { version } = jobs;
    assert.equal(version.needs, "plan");
    assert.match(version.if, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(version.if, /needs\.plan\.outputs\.needs_version == 'true'/);
    assert.deepEqual(version.permissions, { contents: "read" });
    const checkout = version.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    assert.deepEqual(checkout.with, { ref: "main", "fetch-depth": 0, "persist-credentials": false });
    for (const step of version.steps) {
      assert.equal(step.env, undefined, `${step.name ?? step.uses} sets env in a job that runs Changesets`);
      assert.doesNotMatch(JSON.stringify(step), /token/i, `${step.name ?? step.uses} names a token`);
    }
    const runs = version.steps.map((s) => s.run ?? "").join("\n");
    assert.match(runs, /^ *pnpm changeset version$/m);
    assert.doesNotMatch(runs, /git push|gh /, "the version job pushes nothing and calls no GitHub API");
    assert.match(runs, /git diff --cached --binary --no-renames > "\$RUNNER_TEMP\/version\/version\.patch"/);
    const upload = version.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"));
    assert.equal(upload.with.name, "version-commit");
    // Changesets could append its own `base=` to its step's output file, so the base comes from a step that runs first.
    assert.equal(version.outputs.base, `\${{ steps.base.outputs.base }}`);
    const baseIndex = version.steps.findIndex((s) => s.id === "base");
    const firstThirdParty = version.steps.findIndex((s) => /pnpm/.test(`${s.uses ?? ""} ${s.run ?? ""}`));
    assert.ok(baseIndex >= 0 && baseIndex < firstThirdParty, "the base is recorded before pnpm is set up");
    assert.equal(version.steps[baseIndex].run, 'echo "base=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"');
    assert.doesNotMatch(version.steps.find((s) => s.id === "version").run, /base=/);
  });

  test("the version-pr job runs no third-party code, and only its last step holds RELEASE_PR_TOKEN", () => {
    const job = jobs["version-pr"];
    assert.equal(job.needs, "version");
    assert.equal(job.if, "needs.version.outputs.changed == 'true'");
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(job.env.GH_TOKEN, undefined);
    const text = JSON.stringify(job);
    assert.doesNotMatch(text, /\bpnpm\b|\bnpx\b|node_modules|\bnpm\b|\byarn\b|corepack/);
    // Only GitHub's own actions, and none that sets up a package manager or runs code from the checkout.
    const uses = job.steps.filter((s) => s.uses).map((s) => s.uses.replace(/@.*/, ""));
    assert.deepEqual(uses, ["actions/checkout", "actions/download-artifact"]);
    const checkout = job.steps[0];
    // main's history, so the step can check that the version job's base is on main before it checks it out.
    assert.deepEqual(checkout.with, { ref: "main", "fetch-depth": 0, "persist-credentials": false });
    const [, , commit, push] = job.steps;
    assert.equal(commit.env, undefined, "the step that runs node holds no token");
    // The patch goes into the index alone, so node runs the base's scripts, never ones the patch rewrote.
    assert.match(commit.run, /git apply --cached --binary/);
    assert.doesNotMatch(commit.run, /--index/);
    assert.match(commit.run, /^ *node scripts\/ci\/version-pr\.mjs prepare "\$BASE" HEAD "\$RUNNER_TEMP\/pr"$/m);
    // The token step runs node only on version-commit.mjs, from the base's working tree, after the check passed.
    const nodeCalls = job.steps.flatMap((s) => (s.run ?? "").match(/\bnode\b.*$/gm) ?? []);
    assert.deepEqual(nodeCalls, [
      'node scripts/ci/version-pr.mjs prepare "$BASE" HEAD "$RUNNER_TEMP/pr"',
      'node scripts/ci/version-commit.mjs "$BASE" HEAD "$BRANCH"',
    ]);
    assert.equal(push.env.BRANCH, "changeset-release/main");
    // git pushes nothing: the commit is made through the API, so that GitHub signs it.
    assert.doesNotMatch(push.run, /git push|x-access-token/);
    assert.ok(
      push.run.indexOf("version-commit.mjs") < push.run.indexOf("gh pr list"),
      "the branch holds the verified commit before the pull request is opened or updated",
    );
    assert.match(push.run, /gh pr merge "\$number" --repo "\$REPO" --auto --squash/);
    assert.ok(
      push.run.indexOf('gh api "repos/$REPO/branches/main"') < push.run.indexOf("gh pr merge"),
      "the step checks that main requires the checks status before it turns on auto-merge",
    );
  });

  test("version-pr.mjs and version-commit.mjs import nothing but node: modules and the scripts beside them", () => {
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
    visit("version-pr.mjs");
    visit("version-commit.mjs");
    assert.deepEqual([...seen].sort(), [
      "changeset-gate.mjs",
      "release-plan.mjs",
      "version-commit.mjs",
      "version-pr.mjs",
    ]);
  });

  test("releases run one at a time and are never cancelled, and a dry run waits apart from them", () => {
    assert.deepEqual(workflow.concurrency, { group: `release-\${{ github.event_name }}`, "cancel-in-progress": false });
  });

  test("the publish job publishes only the version main holds, before any upload", () => {
    const names = jobs.publish.steps.map((s) => s.name);
    const guard = names.indexOf("Refuse a version main has moved past");
    assert.ok(guard !== -1, "the publish job has no main-version guard");
    assert.ok(guard < names.indexOf("Publish each tarball, gateway first"));
  });

  test("pack releases the run's own commit with the plan's outputs, and only when the plan publishes", () => {
    const { pack } = jobs;
    assert.equal(pack.needs, "plan");
    assert.equal(pack.outputs.sha, `\${{ github.sha }}`);
    for (const key of ["version", "tag", "publish", "dist_tag", "prerelease", "docs_deploy", "node"]) {
      assert.equal(pack.outputs[key], `\${{ needs.plan.outputs.${key} }}`, key);
      assert.ok(jobs.plan.outputs[key], `the plan job lacks the ${key} output`);
    }
    assert.match(pack.if, /needs\.plan\.outputs\.publish == 'true'/);
    const checkout = pack.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    assert.equal(checkout.with.ref, undefined, "pack checks out the run's own commit");
    // A job that needs a skipped job is skipped too, unless its `if:` starts from !cancelled().
    for (const name of ["pack", "publish", "docs"]) assert.match(jobs[name].if, /^\$\{\{ !cancelled\(\) && /, name);
  });

  test("the docs deploy is skipped for a prerelease and while docs-deploy.yml is missing", () => {
    assert.match(jobs.docs.if, /needs\.pack\.outputs\.docs_deploy == 'true'/);
    assert.match(jobs.docs.if, /needs\.pack\.outputs\.prerelease == 'false'/);
    assert.match(jobs.docs.if, /needs\.publish\.result == 'success'/);
    assert.match(jobs.docs.steps[0].run, /gh workflow run docs-deploy\.yml .*-f tag="\$TAG"/);
  });

  test("a workflow_dispatch runs only the plan and the pack (a dry run)", () => {
    assert.match(jobs.pack.if, /github\.event_name == 'workflow_dispatch'/);
    assert.deepEqual(jobs.pack.permissions, { contents: "read" }, "pack can't write");
    for (const name of ["version", "publish"]) assert.match(jobs[name].if, /github\.event_name == 'push'/, name);
    // version-pr needs version, so it is skipped whenever version is.
    assert.equal(jobs["version-pr"].needs, "version");
    // The docs job needs publish, so it is skipped whenever publish is.
    assert.ok(jobs.docs.needs.includes("publish"));
  });
});

describe("release-plan.mjs", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fixture({ version = "0.1.0", private: isPrivate = false, changesets = [], docsDeploy = false, pre } = {}) {
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
    if (pre) {
      writeFileSync(path.join(dir, ".changeset", "pre.json"), JSON.stringify(pre));
      // Changesets 3 moves the changesets a prerelease consumed here; they are not pending.
      mkdirSync(path.join(dir, ".changeset", "pre"));
      writeFileSync(path.join(dir, ".changeset", "pre", "consumed.md"), "---\n---\n");
    }
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

  // These tests read this checkout's own package.json files. The first never skips: a `private` field that came back
  // would make every release plan skip with a green run, and a package without the guard would let `npm publish` in
  // its folder upload 0.0.0.
  const manifests = ["gateway", "sdk"].map((pkg) => ({
    pkg,
    manifest: JSON.parse(readFileSync(path.join(root, "packages", pkg, "package.json"), "utf8")),
  }));
  test("this checkout's packages are public and refuse a publish from their folder", () => {
    for (const { pkg, manifest } of manifests) {
      assert.equal(manifest.private, undefined, `packages/${pkg}/package.json has a private field`);
      assert.equal(
        manifest.scripts?.prepublishOnly,
        "node ../../scripts/refuse-local-publish.mjs",
        `packages/${pkg}/package.json lost the prepublishOnly guard`,
      );
    }
  });

  // The 0.0.0 rule against the checkout. It skips now that the packages are off 0.0.0, where the rule no longer
  // applies, and runs again only if a checkout goes back to 0.0.0.
  const realVersion = manifests[0].manifest.version;
  test("this checkout's public packages at 0.0.0 publish nothing and ask no registry", {
    skip: realVersion === "0.0.0" ? false : `the packages are at ${realVersion}`,
  }, async () => {
    const { fetchImpl, calls } = registry();
    const plan = await planRelease({ root, repo, fetchImpl });
    assert.equal(plan.publish, false);
    assert.equal(plan.version, "0.0.0");
    assert.match(plan.reason, /0\.0\.0, which is never released/);
    assert.equal(calls.length, 0);
  });

  // The plan this checkout gives once it is on main, before anything is published: npm holds only the placeholders, so
  // the merge publishes the checkout's version. In L4b that is 0.1.0-alpha.0 under `alpha`. It skips while the
  // checkout has changesets pending, because the version job then versions them before anything publishes.
  test("this checkout, on main, publishes its version under its dist-tag", {
    skip: needsVersion(root) ? "the checkout has changesets to version" : false,
  }, async () => {
    const { fetchImpl, calls } = registry();
    const plan = await planRelease({ root, repo, fetchImpl });
    const pre = readPreState(root);
    assert.equal(plan.publish, true, plan.reason);
    assert.equal(plan.version, realVersion);
    assert.equal(plan.tag, `v${realVersion}`);
    assert.deepEqual(plan.toPublish, ["@buildanagent/gateway", "@buildanagent/sdk"]);
    assert.equal(plan.distTag, pre?.mode === "pre" ? pre.tag : "latest");
    assert.equal(plan.prerelease, pre?.mode === "pre");
    assert.deepEqual(calls, [
      `https://registry.npmjs.org/@buildanagent%2fgateway/${realVersion}`,
      `https://registry.npmjs.org/@buildanagent%2fsdk/${realVersion}`,
    ]);
    // Every version's notes hold a section per package. Only 0.1.0-alpha.0's hold the first-release text: in pre mode,
    // a later prerelease's notes hold only the changesets it consumed.
    const notes = releaseNotes({ root, version: realVersion });
    for (const name of ["@buildanagent/gateway", "@buildanagent/sdk"]) {
      assert.match(notes, new RegExp(`^## ${name}\\n\\n\\S`, "m"), `the notes have no text for ${name}`);
    }
    if (realVersion === "0.1.0-alpha.0") assert.ok(notes.includes("First public release"));
  });

  test("waits for the version job while changesets are pending", async () => {
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

  const alpha = { mode: "pre", tag: "alpha" };

  test("in pre mode, publishes the prerelease under the pre tag and leaves the consumed changesets alone", async () => {
    const plan = await planRelease({
      root: fixture({ version: "0.1.0-alpha.3", pre: alpha }),
      fetchImpl: registry().fetchImpl,
    });
    assert.equal(plan.publish, true);
    assert.equal(plan.pending, false);
    assert.equal(plan.needsVersion, false);
    assert.equal(plan.distTag, "alpha");
    assert.equal(plan.prerelease, true);
    assert.equal(plan.tag, "v0.1.0-alpha.3");
    const outputs = formatOutputs(plan);
    assert.match(outputs, /^dist_tag=alpha$/m);
    assert.match(outputs, /^prerelease=true$/m);
    assert.match(outputs, /^needs_version=false$/m);
  });

  test("outside pre mode, publishes under latest", async () => {
    const plan = await planRelease({ root: fixture(), fetchImpl: registry().fetchImpl });
    assert.equal(plan.distTag, "latest");
    assert.equal(plan.prerelease, false);
  });

  test("refuses a stable version in pre mode, a prerelease outside it, and another pre tag", async () => {
    const { fetchImpl } = registry();
    await assert.rejects(planRelease({ root: fixture({ pre: alpha }), fetchImpl }), /isn't a alpha prerelease/);
    await assert.rejects(
      planRelease({ root: fixture({ version: "0.1.0-alpha.0" }), fetchImpl }),
      /not a plain x\.y\.z version, and \.changeset\/pre\.json isn't in pre mode/,
    );
    await assert.rejects(
      planRelease({ root: fixture({ version: "0.1.0-beta.0", pre: alpha }), fetchImpl }),
      /isn't a alpha prerelease/,
    );
  });

  test("refuses a pre.json whose tag can't be a prerelease dist-tag", () => {
    for (const tag of ["latest", "", "1.0.0", "Alpha"]) {
      assert.throws(() => readPreState(fixture({ pre: { mode: "pre", tag } })), /can't be an npm dist-tag/, tag);
    }
    assert.throws(() => readPreState(fixture({ pre: { mode: "beta", tag: "alpha" } })), /has mode beta/);
    assert.equal(readPreState(fixture()), undefined);
  });

  test("asks for a version while changesets are pending or pre mode is exiting, and publishes nothing then", async () => {
    const { fetchImpl, calls } = registry();
    const pending = await planRelease({
      root: fixture({ version: "0.1.0-alpha.0", pre: alpha, changesets: ["a.md"] }),
      fetchImpl,
    });
    assert.equal(pending.needsVersion, true);
    assert.equal(pending.publish, false);
    // pnpm changeset pre exit leaves the prerelease version until the next version run.
    const exiting = fixture({ version: "0.1.0-alpha.4", pre: { mode: "exit", tag: "alpha" } });
    assert.equal(needsVersion(exiting), true);
    const plan = await planRelease({ root: exiting, fetchImpl });
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /pre mode is exiting/);
    assert.equal(calls.length, 0);
    assert.equal(needsVersion(fixture({ version: "0.1.0-alpha.0", pre: alpha })), false);
  });

  test("counts only the changesets that changeset version would consume", () => {
    const dir = fixture({ pre: alpha });
    const write = (name, text) => writeFileSync(path.join(dir, ".changeset", name), text);
    write("brave-cats.md", '---\n"@buildanagent/gateway": patch\n---\n\nFix.\n');
    write("quiet-dogs.md", "---\n---\n");
    write("odd.md", "no frontmatter\n");
    // Changesets never reads these, or never consumes them, so counting them would hold every release back.
    write("AGENTS.md", "# Notes for agents\n");
    write("CLAUDE.md", "# Notes\n");
    write(".draft.md", "---\n---\n");
    write("manual.md", "---\n'@buildanagent/manual': patch\n---\n\nA private app.\n");
    // Changesets refuses a changeset that mixes a versioned and a skipped package, so it stays pending and fails loudly.
    write("mixed.md", '---\n"@buildanagent/sdk": patch\n"@buildanagent/verify-pi": patch\n---\n\nx\n');
    assert.deepEqual(pendingChangesets(dir).sort(), ["brave-cats.md", "mixed.md", "odd.md", "quiet-dogs.md"]);
  });

  test("says why a version doesn't fit the pre mode", () => {
    assert.equal(preModeMismatch("0.1.0-alpha.3", alpha), undefined);
    assert.equal(preModeMismatch("0.1.0", undefined), undefined);
    assert.equal(preModeMismatch("0.1.0", { mode: "exit", tag: "alpha" }), undefined);
    assert.match(preModeMismatch("0.1.0", alpha), /isn't a alpha prerelease/);
    assert.match(preModeMismatch("0.1.0-alpha.3", undefined), /not a plain x\.y\.z/);
  });

  test("refuses mismatched versions", async () => {
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

describe("compareVersions", () => {
  test("orders versions by semver precedence", () => {
    const ordered = [
      "0.0.0",
      "0.0.0-bootstrap.0",
      "0.1.0-alpha.0",
      "0.1.0-alpha.1",
      "0.1.0-alpha.9",
      "0.1.0-alpha.10",
      "0.1.0-beta.0",
      "0.1.0",
      "0.1.1",
      "0.10.0",
      "1.0.0",
    ].sort(compareVersions);
    assert.deepEqual(ordered, [
      "0.0.0-bootstrap.0",
      "0.0.0",
      "0.1.0-alpha.0",
      "0.1.0-alpha.1",
      "0.1.0-alpha.9",
      "0.1.0-alpha.10",
      "0.1.0-beta.0",
      "0.1.0",
      "0.1.1",
      "0.10.0",
      "1.0.0",
    ]);
    assert.equal(compareVersions("0.1.0-alpha.1", "0.1.0-alpha.1"), 0);
    assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0, "fewer identifiers come first");
    assert.ok(compareVersions("1.0.0-1", "1.0.0-alpha") < 0, "a numeric identifier comes before a word");
    assert.throws(() => compareVersions("v1.0.0", "1.0.0"), /not a semver version/);
  });
});

// These tests run the workflow's own shell scripts, taken from release.yml, in a temp folder. Git pushes to a local
// bare repository, and fake `pnpm` and `gh` commands stand in for the real ones, so nothing touches the network.
describe("release.yml's scripts, run for real", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "release-steps-"));
    dirs.push(dir);
    return dir;
  };
  const executable = (file, text) => {
    writeFileSync(file, text);
    chmodSync(file, 0o755);
  };

  // A stand-in for `pnpm changeset version` in pre mode: it fails when any token reached it, moves every pending
  // changeset into .changeset/pre/, and bumps both packages to the next prerelease, with a changelog section, when one
  // of them names a package. With EVIL set, it also edits a package's source, as a compromised dependency might, and
  // with EVIL=checker it also replaces the version-commit check with one that passes everything.
  const FAKE_PNPM = `#!/usr/bin/env node
const fs = require("node:fs");
if (Object.keys(process.env).some((key) => /TOKEN/.test(key))) { console.error("a token reached pnpm"); process.exit(3); }
if (process.argv.slice(2).join(" ") !== "changeset version") process.exit(2);
fs.mkdirSync(".changeset/pre", { recursive: true });
let bump = false;
for (const name of fs.readdirSync(".changeset")) {
  if (!name.endsWith(".md") || name === "README.md") continue;
  if (fs.readFileSync(".changeset/" + name, "utf8").includes('"@buildanagent/')) bump = true;
  fs.renameSync(".changeset/" + name, ".changeset/pre/" + name);
}
if (bump) for (const pkg of ["gateway", "sdk"]) {
  const file = "packages/" + pkg + "/package.json";
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.version = manifest.version.replace(/\\d+$/, (n) => String(Number(n) + 1));
  fs.writeFileSync(file, JSON.stringify(manifest) + "\\n");
  const log = "packages/" + pkg + "/CHANGELOG.md";
  fs.writeFileSync(log, "## " + manifest.version + "\\n\\n- a change\\n\\n" + fs.readFileSync(log, "utf8"));
}
if (process.env.EVIL) fs.writeFileSync("packages/gateway/src/index.js", "steal();\\n");
if (process.env.EVIL === "base") fs.appendFileSync(process.env.GITHUB_OUTPUT, "base=" + "f".repeat(40) + "\\n");
if (process.env.EVIL === "checker") {
  fs.writeFileSync("scripts/ci/version-pr.mjs", [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    "const dir = process.argv[5];",
    "mkdirSync(dir, { recursive: true });",
    'writeFileSync(dir + "/title", "chore(release): version packages");',
    'writeFileSync(dir + "/body.md", "");',
  ].join("\\n") + "\\n");
}
`;

  // A stand-in for gh that logs each call to $GH_LOG and answers as GitHub would: `pr list` prints $EXISTING_PR,
  // `pr create` prints the new pull request's URL, `pr view` prints $AUTO_MERGE, whether auto-merge is on, and the
  // branch lookup prints $REQUIRED_CHECKS, whether main requires the checks status (nothing when it requires none).
  // The git ref and commit endpoints and GraphQL's createCommitOnBranch act on the bare repository $FAKE_REMOTE. A
  // commit made through createCommitOnBranch is listed in $FAKE_REMOTE/signed and reads as verified, unless
  // $UNVERIFIED is set; a commit pushed with git reads as unsigned, as on GitHub.
  const FAKE_GH = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, args.join(" ") + "\\n");
if (process.env.GH_TOKEN !== "secret") { console.error("gh got no token"); process.exit(4); }
const remote = process.env.FAKE_REMOTE;
const git = (argv, opts = {}) => execFileSync("git", argv, { cwd: remote, encoding: "utf8", ...opts }).trim();
const sha = (ref) => { try { return git(["rev-parse", "--verify", "--quiet", ref + "^{commit}"]); } catch { return ""; } };
const signedFile = path.join(remote, "signed");
const signed = () => (fs.existsSync(signedFile) ? fs.readFileSync(signedFile, "utf8").split("\\n") : []);
const out = (value) => { console.log(JSON.stringify(value)); process.exit(0); };
const fail = (status, message) => { console.error("gh: " + message + " (HTTP " + status + ")"); process.exit(1); };
const pr = args[0] + " " + args[1];
if (pr === "pr list") { console.log(process.env.EXISTING_PR ?? ""); process.exit(0); }
if (pr === "pr create") { console.log("https://github.com/o/r/pull/42"); process.exit(0); }
if (pr === "pr view") { console.log(process.env.AUTO_MERGE || "false"); process.exit(0); }
if (args[0] !== "api") process.exit(0);
if (args[1] === "repos/o/r/branches/main") { console.log(process.env.REQUIRED_CHECKS ?? "true"); process.exit(0); }
const method = args[args.indexOf("--method") + 1];
const route = args[args.indexOf("--method") + 2];
const body = args.includes("--input") ? JSON.parse(fs.readFileSync(0, "utf8")) : undefined;
let match;
if (method === "GET" && (match = /^repos\\/o\\/r\\/git\\/ref\\/(heads\\/.+)$/.exec(route))) {
  const found = sha("refs/" + match[1]);
  if (!found) fail(404, "Not Found");
  out({ ref: "refs/" + match[1], object: { type: "commit", sha: found } });
}
if (method === "POST" && route === "repos/o/r/git/refs") {
  if (sha(body.ref)) fail(422, "Reference already exists");
  git(["update-ref", body.ref, body.sha]);
  out({ ref: body.ref, object: { sha: body.sha } });
}
if (method === "PATCH" && (match = /^repos\\/o\\/r\\/git\\/refs\\/(heads\\/.+)$/.exec(route))) {
  if (!sha("refs/" + match[1])) fail(422, "Reference does not exist");
  if (body.force !== true) fail(422, "Update is not a fast forward");
  git(["update-ref", "refs/" + match[1], body.sha]);
  out({ ref: "refs/" + match[1], object: { sha: body.sha } });
}
if (method === "DELETE" && (match = /^repos\\/o\\/r\\/git\\/refs\\/(heads\\/.+)$/.exec(route))) {
  if (!sha("refs/" + match[1])) fail(422, "Reference does not exist");
  git(["update-ref", "-d", "refs/" + match[1]]);
  process.exit(0);
}
if (method === "GET" && (match = /^repos\\/o\\/r\\/git\\/commits\\/([0-9a-f]{40})$/.exec(route))) {
  const [tree, ...parents] = git(["log", "-1", "--format=%T %P", match[1]]).split(" ").filter(Boolean);
  const verified = signed().includes(match[1]) && !process.env.UNVERIFIED;
  out({ sha: match[1], tree: { sha: tree }, parents: parents.map((p) => ({ sha: p })),
    verification: { verified, reason: verified ? "valid" : "unsigned" } });
}
if (method === "POST" && route === "graphql") {
  const input = body.variables.input;
  const ref = "refs/heads/" + input.branch.branchName;
  if (input.branch.repositoryNameWithOwner !== "o/r") fail(422, "wrong repository");
  if (sha(ref) !== input.expectedHeadOid) out({ errors: [{ message: "Expected branch to point to " + input.expectedHeadOid }] });
  const index = path.join(remote, "fake-index");
  // update-index wants a work tree; an empty one is enough, because nothing here reads or writes files.
  const work = fs.mkdtempSync(path.join(remote, "fake-work-"));
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_WORK_TREE: work };
  git(["read-tree", input.expectedHeadOid], { env });
  for (const { path: file } of input.fileChanges.deletions ?? []) git(["update-index", "--force-remove", file], { env });
  for (const { path: file, contents } of input.fileChanges.additions ?? []) {
    const blob = git(["hash-object", "-w", "--stdin"], { input: Buffer.from(contents, "base64") });
    git(["update-index", "--add", "--cacheinfo", "100644," + blob + "," + file], { env });
  }
  const tree = git(["write-tree"], { env });
  fs.rmSync(index);
  fs.rmSync(work, { recursive: true });
  const message = [input.message.headline, input.message.body].filter(Boolean).join("\\n\\n");
  const commit = git(["commit-tree", tree, "-p", input.expectedHeadOid, "-m", message], {
    env: { ...process.env, GIT_AUTHOR_NAME: "owner", GIT_AUTHOR_EMAIL: "owner@example.invalid",
      GIT_COMMITTER_NAME: "GitHub", GIT_COMMITTER_EMAIL: "noreply@github.com" },
  });
  git(["update-ref", ref, commit]);
  fs.appendFileSync(signedFile, commit + "\\n");
  out({ data: { createCommitOnBranch: { commit: { oid: commit } } } });
}
console.error("fake gh: unexpected call " + args.join(" "));
process.exit(5);
`;

  // A repository whose main holds both packages at 0.1.0-alpha.0 in alpha pre mode, plus `changesets`, pushed to a
  // bare remote that the fake gh treats as the repository on GitHub.
  function setup({ changesets = {}, pre = { mode: "pre", tag: "alpha" } } = {}) {
    const dir = temp();
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    executable(path.join(bin, "pnpm"), FAKE_PNPM);
    executable(path.join(bin, "gh"), FAKE_GH);
    writeFileSync(path.join(dir, "gitconfig"), "[user]\n\tname = test\n\temail = test@example.invalid\n");
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: dir,
      LANG: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
    };
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" });
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    };
    for (const pkg of ["gateway", "sdk"]) {
      write(
        `packages/${pkg}/package.json`,
        `${JSON.stringify({ name: `@buildanagent/${pkg}`, version: "0.1.0-alpha.0" })}\n`,
      );
      write(`packages/${pkg}/CHANGELOG.md`, `# @buildanagent/${pkg}\n\n## 0.1.0-alpha.0\n\n- first\n`);
      write(`packages/${pkg}/src/index.js`, "export {};\n");
    }
    write(".changeset/README.md", "# Changesets\n");
    write(".changeset/config.json", JSON.stringify({ changedFilePatterns: ["src/**", "package.json"] }));
    write(".changeset/pre.json", JSON.stringify(pre));
    for (const [name, text] of Object.entries(changesets)) write(`.changeset/${name}`, text);
    for (const script of ["release-plan.mjs", "changeset-gate.mjs", "version-pr.mjs", "version-commit.mjs"]) {
      write(`scripts/ci/${script}`, readFileSync(path.join(root, "scripts/ci", script), "utf8"));
    }
    git(work, "add", "-A");
    git(work, "commit", "-qm", "feat: a change with a changeset");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "-q", "origin", "main");
    return { dir, remote, work, env, git, write };
  }

  const outputs = (file) =>
    Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );

  // Runs the version job's base and version steps in `work`, which stands for its checkout of the newest main. Each
  // step gets its own output file, as on GitHub, and `outputs` are the job's, as its `outputs:` map names them.
  function runVersionStep({ work, dir, env }, extraEnv = {}) {
    const runner = path.join(dir, "runner");
    mkdirSync(runner, { recursive: true });
    const step = (id) => {
      const output = path.join(dir, `${id}-output`);
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-c", jobs.version.steps.find((s) => s.id === id).run], {
        cwd: work,
        env: { ...env, RUNNER_TEMP: runner, GITHUB_OUTPUT: output, ...extraEnv },
        encoding: "utf8",
      });
      return { ...result, outputs: outputs(output) };
    };
    const base = step("base");
    assert.equal(base.status, 0, base.stderr);
    const result = step("version");
    const job = Object.fromEntries(
      Object.entries(jobs.version.outputs).map(([name, expr]) => {
        const [, id, key] = /steps\.(\w+)\.outputs\.(\w+)/.exec(expr);
        return [name, (id === "base" ? base : result).outputs[key]];
      }),
    );
    return { ...result, outputs: Object.fromEntries(Object.entries(job).filter(([, v]) => v !== undefined)) };
  }

  // Runs the version-pr job's two steps in a fresh clone of main, as its checkout is, with the version job's patch
  // where download-artifact puts it. The push step runs only when the commit step passed.
  function runVersionPr(repo, base, extraEnv = {}) {
    const clone = path.join(repo.dir, `pr-${Math.random().toString(36).slice(2)}`);
    repo.git(repo.dir, "clone", "-q", "-b", "main", repo.remote, clone);
    const runner = path.join(repo.dir, "runner");
    rmSync(path.join(runner, "pr"), { recursive: true, force: true });
    const log = path.join(repo.dir, "gh-log");
    writeFileSync(log, "");
    const summary = path.join(repo.dir, "summary");
    const [, , commit, push] = jobs["version-pr"].steps;
    const env = { ...repo.env, BASE: base, RUNNER_TEMP: runner, GITHUB_STEP_SUMMARY: summary };
    const commitRun = spawnSync("bash", ["-e", "-c", commit.run], { cwd: clone, env, encoding: "utf8" });
    if (commitRun.status !== 0) return { commit: commitRun, gh: [] };
    const pushRun = spawnSync("bash", ["-e", "-c", push.run], {
      cwd: clone,
      env: { ...env, ...push.env, GH_TOKEN: "secret", REPO: "o/r", GH_LOG: log, FAKE_REMOTE: repo.remote, ...extraEnv },
      encoding: "utf8",
    });
    return { commit: commitRun, push: pushRun, gh: readFileSync(log, "utf8").split("\n").filter(Boolean) };
  }

  const changeset = '---\n"@buildanagent/gateway": patch\n---\n\nFix a thing.\n';
  const branch = "changeset-release/main";
  const staging = "changeset-release/staging";
  // The fake gh's log, split into GitHub API calls (method and route) and everything else.
  const apiCalls = (gh) => gh.filter((call) => call.startsWith("api --method ")).map((call) => call.slice(13));
  const prCalls = (gh) => gh.filter((call) => !call.startsWith("api --method "));
  const signedCommits = (repo) => {
    const file = path.join(repo.remote, "signed");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };

  test("a merged changeset opens a Version packages pull request with auto-merge, and main stays as it was", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    const version = runVersionStep(repo);
    assert.equal(version.status, 0, version.stderr + version.stdout);
    assert.deepEqual(version.outputs, { base: main, changed: "true" });
    const run = runVersionPr(repo, main);
    assert.equal(run.commit.status, 0, run.commit.stderr + run.commit.stdout);
    assert.equal(run.push.status, 0, run.push.stderr + run.push.stdout);
    assert.equal(repo.git(repo.remote, "rev-parse", "main").trim(), main, "main is never pushed");
    const [subject, parent] = repo.git(repo.remote, "log", "-1", "--format=%s%n%P", branch).trim().split("\n");
    assert.equal(subject, "chore(release): version packages to 0.1.0-alpha.1");
    assert.equal(parent, main);
    assert.equal(
      JSON.parse(repo.git(repo.remote, "show", `${branch}:packages/sdk/package.json`)).version,
      "0.1.0-alpha.1",
    );
    // The commit is made on the staging branch, checked, and only then put on the release branch.
    const created = repo.git(repo.remote, "rev-parse", branch).trim();
    assert.deepEqual(apiCalls(run.gh), [
      `GET repos/o/r/git/ref/heads/${branch}`,
      `GET repos/o/r/git/ref/heads/${staging}`,
      "POST repos/o/r/git/refs --input -",
      "POST graphql --input -",
      `GET repos/o/r/git/commits/${created}`,
      `GET repos/o/r/git/ref/heads/${branch}`,
      "POST repos/o/r/git/refs --input -",
      `DELETE repos/o/r/git/refs/heads/${staging}`,
    ]);
    assert.ok(signedCommits(repo).includes(created), "the branch holds the commit GitHub signed");
    assert.equal(spawnSync("git", ["rev-parse", "--verify", staging], { cwd: repo.remote }).status, 128);
    assert.deepEqual(prCalls(run.gh), [
      `pr list --repo o/r --head ${branch} --base main --state open --json number --jq .[0].number // empty`,
      `pr create --repo o/r --base main --head ${branch} --title chore(release): version packages to 0.1.0-alpha.1 --body-file ${path.join(repo.dir, "runner", "pr", "body.md")}`,
      `api repos/o/r/branches/main --jq ${jobs["version-pr"].steps[3].run.match(/--jq '([^']+)'\)\n *if \[ "\$required"/)[1]}`,
      "pr view 42 --repo o/r --json autoMergeRequest --jq .autoMergeRequest != null",
      "pr merge 42 --repo o/r --auto --squash",
    ]);
    const body = readFileSync(path.join(repo.dir, "runner", "pr", "body.md"), "utf8");
    assert.match(
      body,
      /publishes `@buildanagent\/gateway` and `@buildanagent\/sdk` 0\.1\.0-alpha\.1 to npm under the `alpha` dist-tag/,
    );
    assert.match(body, /- `brave-cats\.md` \("@buildanagent\/gateway": patch\): Fix a thing\./);
  });

  test("a later changeset updates the same pull request, and a rerun pushes nothing new", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    repo.write(".changeset/quiet-dogs.md", '---\n"@buildanagent/sdk": patch\n---\n\nAnother fix.\n');
    repo.git(repo.work, "add", "-A");
    repo.git(repo.work, "commit", "-qm", "fix: a second change");
    repo.git(repo.work, "push", "-q", "origin", "main");
    // The branch still holds the first changeset's version commit, on the older main.
    repo.git(repo.work, "push", "-q", "origin", `HEAD~1:refs/heads/${branch}`);
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo).status, 0);
    const open = { EXISTING_PR: "42", AUTO_MERGE: "true" };
    const first = runVersionPr(repo, main, open);
    assert.equal(first.push.status, 0, first.push.stderr);
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%P", branch).trim(), main);
    const files = repo.git(repo.remote, "show", "--name-only", "--format=", branch).split("\n").filter(Boolean);
    assert.ok(files.includes(".changeset/pre/quiet-dogs.md") && files.includes(".changeset/pre/brave-cats.md"));
    assert.ok(
      first.gh.some((call) => call.startsWith("pr edit 42 --repo o/r --title chore(release): version packages")),
    );
    assert.ok(!first.gh.some((call) => call.startsWith("pr create") || call.startsWith("pr merge")), first.gh);
    const again = runVersionPr(repo, main, open);
    assert.equal(again.push.status, 0, again.push.stderr);
    assert.match(again.push.stdout, /already holds this version commit/);
    assert.deepEqual(apiCalls(again.gh), [
      `GET repos/o/r/git/ref/heads/${branch}`,
      `GET repos/o/r/git/commits/${repo.git(repo.remote, "rev-parse", branch).trim()}`,
    ]);
  });

  // Pull request #70's case: its branch held the right version commit, pushed with git and so unsigned, and the
  // ruleset blocked the merge. The next run replaces it with the same tree on the same base, signed.
  test("replaces an unsigned version commit with a verified one, even when the tree is the same", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo).status, 0);
    const clone = path.join(repo.dir, "unsigned");
    repo.git(repo.dir, "clone", "-q", "-b", "main", repo.remote, clone);
    repo.git(clone, "apply", "--index", "--binary", path.join(repo.dir, "runner", "version", "version.patch"));
    repo.git(clone, "commit", "-qm", "chore(release): version packages to 0.1.0-alpha.1");
    repo.git(clone, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
    const unsigned = repo.git(repo.remote, "rev-parse", branch).trim();
    const run = runVersionPr(repo, main, { EXISTING_PR: "42", AUTO_MERGE: "true" });
    assert.equal(run.push.status, 0, run.push.stderr);
    const replaced = repo.git(repo.remote, "rev-parse", branch).trim();
    assert.notEqual(replaced, unsigned);
    assert.ok(signedCommits(repo).includes(replaced));
    assert.equal(
      repo.git(repo.remote, "rev-parse", `${replaced}^{tree}`).trim(),
      repo.git(repo.remote, "rev-parse", `${unsigned}^{tree}`).trim(),
    );
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%P", branch).trim(), main);
    assert.ok(apiCalls(run.gh).includes(`PATCH repos/o/r/git/refs/heads/${branch} --input -`), run.gh);
  });

  test("fails, and leaves the branch and the pull request alone, when GitHub doesn't verify the commit", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo).status, 0);
    const run = runVersionPr(repo, main, { UNVERIFIED: "1" });
    assert.equal(run.push.status, 1);
    assert.match(run.push.stderr, /GitHub didn't verify the signature of [0-9a-f]{40} \(reason: unsigned\)/);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", branch], { cwd: repo.remote }).status, 128);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", staging], { cwd: repo.remote }).status, 128);
    assert.deepEqual(prCalls(run.gh), [], "no pull request is opened or changed");
  });

  test("turns auto-merge back on when someone turned it off", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    runVersionStep(repo);
    const run = runVersionPr(repo, main, { EXISTING_PR: "42", AUTO_MERGE: "false" });
    assert.equal(run.push.status, 0, run.push.stderr);
    assert.equal(run.gh.at(-1), "pr merge 42 --repo o/r --auto --squash");
  });

  test("refuses a version commit that changes more than versions, and pushes nothing", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo, { EVIL: "1" }).status, 0);
    const run = runVersionPr(repo, main);
    assert.notEqual(run.commit.status, 0);
    assert.match(run.commit.stderr, /M packages\/gateway\/src\/index\.js: a version commit doesn't change this file/);
    assert.equal(run.push, undefined);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", branch], { cwd: repo.remote }).status, 128);
  });

  test("refuses a patch that rewrites the check itself, because node runs the base's scripts", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo, { EVIL: "checker" }).status, 0);
    const run = runVersionPr(repo, main);
    assert.notEqual(run.commit.status, 0, run.commit.stdout);
    assert.match(run.commit.stderr, /M scripts\/ci\/version-pr\.mjs: a version commit doesn't change this file/);
    assert.equal(run.push, undefined);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", branch], { cwd: repo.remote }).status, 128);
  });

  test("Changesets can't change the job's base by writing to its step's output", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    const version = runVersionStep(repo, { EVIL: "base" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.outputs.base, main);
  });

  test("refuses a base that isn't a commit on main, and pushes nothing", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    assert.equal(runVersionStep(repo).status, 0);
    // A commit GitHub serves but main doesn't hold, such as a fork's pull request head.
    repo.write("packages/gateway/src/index.js", "steal();\n");
    repo.git(repo.work, "commit", "-qam", "elsewhere");
    repo.git(repo.work, "push", "-q", "origin", "HEAD:refs/pull/1/head");
    const elsewhere = repo.git(repo.work, "rev-parse", "HEAD").trim();
    for (const base of [elsewhere, "main", "--help"]) {
      const run = runVersionPr(repo, base);
      assert.notEqual(run.commit.status, 0, base);
      assert.match(run.commit.stdout, /The version job's base, '.*', isn't a commit on main/, base);
      assert.equal(run.push, undefined, base);
    }
  });

  test("leaves auto-merge off and fails when main doesn't require the checks status", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    runVersionStep(repo);
    for (const required of ["", "false"]) {
      const run = runVersionPr(repo, main, { REQUIRED_CHECKS: required });
      assert.equal(run.push.status, 1, JSON.stringify(required));
      assert.match(run.push.stdout, /main doesn't require the checks status/);
      assert.ok(!run.gh.some((call) => call.startsWith("pr merge")), run.gh);
    }
  });

  test("empty changesets get a pull request that names no version", () => {
    const repo = setup({ changesets: { "quiet-dogs.md": "---\n---\n" } });
    const main = repo.git(repo.remote, "rev-parse", "main").trim();
    assert.equal(runVersionStep(repo).status, 0);
    const run = runVersionPr(repo, main);
    assert.equal(run.push.status, 0, run.push.stderr + run.commit.stderr);
    const subject = repo.git(repo.remote, "log", "-1", "--format=%s", branch).trim();
    assert.equal(subject, "chore(release): consume changesets that bump no package");
  });

  test("a run with nothing for Changesets to change uploads no patch", () => {
    const repo = setup();
    const version = runVersionStep(repo);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.outputs.changed, "false");
    assert.match(version.stdout, /changed nothing/);
  });

  // The publish job's guard against a re-run of an older run, with a fake `gh` that answers main's package.json.
  function runGuard({ mainVersion, version }) {
    const dir = temp();
    executable(
      path.join(dir, "gh"),
      `#!/bin/sh\nprintf '{"name":"@buildanagent/gateway","version":"%s"}\\n' "$MAIN_VERSION"\n`,
    );
    const script = jobs.publish.steps.find((s) => s.name === "Refuse a version main has moved past").run;
    return spawnSync("bash", ["-e", "-c", script], {
      cwd: dir,
      env: {
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        HOME: dir,
        MAIN_VERSION: mainVersion,
        VERSION: version,
        GH_TOKEN: "t",
        REPO: "o/r",
      },
      encoding: "utf8",
    });
  }

  test("the publish job publishes the version main holds and refuses one main has moved past", () => {
    assert.equal(runGuard({ mainVersion: "0.1.0-alpha.1", version: "0.1.0-alpha.1" }).status, 0);
    const stale = runGuard({ mainVersion: "0.1.0-alpha.2", version: "0.1.0-alpha.1" });
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /main is at 0\.1\.0-alpha\.2, so this run won't publish 0\.1\.0-alpha\.1/);
  });
});
