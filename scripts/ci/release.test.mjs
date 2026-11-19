// Offline checks for the release workflow: the shape of .github/workflows/release.yml, which must never read an npm
// token, must version and publish only from a push to main and must keep prereleases off `latest`, and the decisions
// scripts/ci/release-plan.mjs makes, including the plan this checkout gives once it is on main. The plan
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
  needsVersion,
  planRelease,
  readPreState,
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
    assert.match(step.run, /if \[ "\$PRERELEASE" = "true" \]; then flags\+=\(--prerelease\); fi/);
    assert.match(step.run, /--target "\$SHA"/, "the release tags the commit that was packed");
    assert.doesNotMatch(step.run, /GITHUB_SHA/);
  });

  test("the publish job refuses a prerelease under latest and a stable release under anything else", () => {
    const step = jobs.publish.steps.find((s) => s.name === "Check the toolchain and that no npm token is present");
    assert.match(step.run, /\[ "\$DIST_TAG" != "latest" \]/);
    assert.match(step.run, /ok=\$\(\[ "\$DIST_TAG" = "latest" \]/);
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
      /npm publish "\$RELEASE_DIR\/buildanagent-\$pkg-\$VERSION\.tgz" --tag "\$DIST_TAG" --access public --provenance/,
    );
    assert.equal(jobs.publish.env.DIST_TAG, `\${{ needs.pack.outputs.dist_tag }}`);
    const [first] = jobs.publish.steps;
    assert.match(first.run, /^echo "registry=https:\/\/registry\.npmjs\.org\/" > "\$RUNNER_TEMP\/npmrc"$/m);
    assert.match(first.run, /^ {2}echo "NPM_CONFIG_USERCONFIG=\$RUNNER_TEMP\/npmrc"$/m);
  });

  test("only the publish job can mint an OIDC token, only it and the version job can write, and only docs dispatches", () => {
    for (const [name, job] of Object.entries(jobs)) {
      const permissions = job.permissions ?? workflow.permissions;
      if (name !== "publish") assert.equal(permissions["id-token"], undefined, name);
      if (name !== "docs") assert.equal(permissions.actions, undefined, name);
      if (name !== "publish" && name !== "version") assert.notEqual(permissions.contents, "write", name);
    }
    assert.deepEqual(jobs.docs.permissions, { actions: "write" });
    assert.deepEqual(jobs.version.permissions, { contents: "write" });
  });

  test("there is no Version packages pull request: the version job pushes to main", () => {
    assert.equal(jobs["version-pr"], undefined);
    const { version } = jobs;
    assert.match(version.if, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(version.if, /needs\.plan\.outputs\.needs_version == 'true'/);
    assert.match(
      version.if,
      /!startsWith\(github\.event\.head_commit\.message, 'chore\(release\): version packages'\)/,
    );
    const checkout = version.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    assert.deepEqual(checkout.with, { ref: "main", "fetch-depth": 0, "persist-credentials": false });
    const step = version.steps.find((s) => s.id === "push");
    // It versions the newest main, only when something is still pending, and starts no other workflow run.
    assert.match(step.run, /git reset --quiet --hard origin\/main/);
    assert.match(step.run, /node scripts\/ci\/release-plan\.mjs needs-version/);
    assert.match(step.run, /git commit --quiet -m "chore\(release\): version packages to \$version \[skip ci\]"/);
    assert.match(step.run, /git push --quiet "\$remote" HEAD:main/);
    assert.match(step.run, /::error::main's branch protection refused the version commit/);
    assert.match(version.steps.at(-1).run, /node scripts\/ci\/release-plan\.mjs plan \| tee -a "\$GITHUB_OUTPUT"/);
  });

  test("releases run one at a time and are never cancelled", () => {
    assert.deepEqual(workflow.concurrency, { group: "release", "cancel-in-progress": false });
  });

  test("pack releases the version job's commit and plan when it ran, and the run's own otherwise", () => {
    const { pack } = jobs;
    assert.deepEqual(pack.needs, ["plan", "version"]);
    assert.equal(pack.outputs.sha, `\${{ needs.version.outputs.sha || github.sha }}`);
    for (const key of ["version", "tag", "publish", "dist_tag", "prerelease", "docs_deploy", "node"]) {
      assert.equal(pack.outputs[key], `\${{ needs.version.outputs.${key} || needs.plan.outputs.${key} }}`, key);
      assert.ok(jobs.version.outputs[key], `the version job lacks the ${key} output`);
      assert.ok(jobs.plan.outputs[key], `the plan job lacks the ${key} output`);
    }
    const checkout = pack.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    assert.equal(checkout.with.ref, pack.outputs.sha);
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
    assert.equal(jobs.pack.permissions, undefined, "pack keeps the read-only default");
    for (const name of ["version", "publish"]) assert.match(jobs[name].if, /github\.event_name == 'push'/, name);
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

  // The 0.0.0 rule against the checkout. It skips once the "Version packages" pull request moves the packages off
  // 0.0.0, when the rule no longer applies.
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
    assert.ok(releaseNotes({ root, version: realVersion }).includes("First public release"));
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
