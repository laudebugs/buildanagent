// Offline checks for the release workflow: the shape of .github/workflows/release.yml, which must never read an npm
// token, must version and publish only from a push to main and must keep prereleases off `latest`, and the decisions
// scripts/ci/release-plan.mjs makes, including the plan this checkout gives once it is on main. The plan
// tests stub the registry, so nothing here touches the network. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // Every write to either file, so a token line added to one of them fails here.
    const writes = first.run.split("\n").filter((line) => line.includes(`"${user}"`) || line.includes(`"${global}"`));
    assert.deepEqual(writes, [`echo "registry=https://registry.npmjs.org/" > "${user}"`, `: > "${global}"`]);
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

  test("the version job is switched off, so a merge publishes only a version already on main", () => {
    // It runs third-party code with a token that can push to main; a follow-up replaces it with an auto-merged
    // "Version packages" pull request. Pack and publish must still run while it is skipped.
    assert.match(jobs.version.if, /^false &&\s/);
    assert.match(jobs.pack.if, /needs\.version\.result == 'skipped'/);
    assert.match(jobs.pack.if, /needs\.version\.outputs\.publish \|\| needs\.plan\.outputs\.publish/);
  });

  test("there is no Version packages pull request yet: the version job, when on, pushes to main", () => {
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
    assert.match(step.run, /needs=\$\(node scripts\/ci\/release-plan\.mjs needs-version\)\n/);
    assert.match(step.run, /^ *env -u GH_TOKEN pnpm changeset version$/m, "Changesets runs without the push token");
    assert.doesNotMatch(step.run, /^ *pnpm changeset version$/m);
    assert.match(step.run, /git commit --quiet -m "chore\(release\): version packages to \$version \[skip ci\]"/);
    assert.match(step.run, /git push --quiet "\$remote" HEAD:main/);
    assert.match(step.run, /::error::main's branch protection refused the version commit/);
    assert.match(version.steps.at(-1).run, /node scripts\/ci\/release-plan\.mjs plan \| tee -a "\$GITHUB_OUTPUT"/);
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

  // A stand-in for `pnpm changeset version` in pre mode: it fails when the push token reached it, moves every pending
  // changeset into .changeset/pre/, and bumps both packages to the next prerelease when one of them names a package.
  // With RACE_CLONE set, its first call pushes another commit to main, as a merge landing mid-job would.
  const FAKE_PNPM = `#!/usr/bin/env node
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
if (process.env.GH_TOKEN) { console.error("GH_TOKEN reached pnpm"); process.exit(3); }
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
}
const race = process.env.RACE_CLONE;
if (race && !fs.existsSync(race + "/.raced")) {
  fs.writeFileSync(race + "/.raced", "");
  execFileSync("git", ["-C", race, "commit", "-q", "--allow-empty", "-m", "docs: a merge that lands meanwhile"]);
  execFileSync("git", ["-C", race, "push", "-q", "origin", "HEAD:main"]);
}
`;

  // A repository whose main holds both packages at 0.1.0-alpha.0 in alpha pre mode, plus `changesets`, pushed to a
  // bare remote that the version step's token URL is rewritten to.
  function setup({ changesets = {}, pre = { mode: "pre", tag: "alpha" } } = {}) {
    const dir = temp();
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    executable(path.join(bin, "pnpm"), FAKE_PNPM);
    writeFileSync(
      path.join(dir, "gitconfig"),
      `[user]\n\tname = test\n\temail = test@example.invalid\n[url "${remote}"]\n\tinsteadOf = https://x-access-token:secret@github.com/o/r.git\n`,
    );
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
    }
    write(".changeset/README.md", "# Changesets\n");
    write(".changeset/pre.json", JSON.stringify(pre));
    for (const [name, text] of Object.entries(changesets)) write(`.changeset/${name}`, text);
    mkdirSync(path.join(work, "scripts", "ci"), { recursive: true });
    copyFileSync(path.join(root, "scripts/ci/release-plan.mjs"), path.join(work, "scripts/ci/release-plan.mjs"));
    git(work, "add", "-A");
    git(work, "commit", "-qm", "feat: a change with a changeset");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "-q", "origin", "main");
    return { dir, remote, work, env, git };
  }

  function runVersionStep({ work, dir, env }, extraEnv = {}) {
    const script = jobs.version.steps.find((s) => s.id === "push").run;
    const output = path.join(dir, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", script], {
      cwd: work,
      env: { ...env, GH_TOKEN: "secret", REPO: "o/r", RUNNER_TEMP: dir, GITHUB_OUTPUT: output, ...extraEnv },
      encoding: "utf8",
    });
    return { ...result, output: readFileSync(output, "utf8") };
  }

  const changeset = '---\n"@buildanagent/gateway": patch\n---\n\nFix a thing.\n';

  test("the version step pushes the next prerelease to main without handing pnpm the token", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const run = runVersionStep(repo);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const head = repo.git(repo.remote, "log", "-1", "--format=%s%n%H", "main").trim().split("\n");
    assert.equal(head[0], "chore(release): version packages to 0.1.0-alpha.1 [skip ci]");
    assert.equal(run.output, `sha=${head[1]}\n`);
    const manifest = repo.git(repo.remote, "show", "main:packages/sdk/package.json");
    assert.equal(JSON.parse(manifest).version, "0.1.0-alpha.1");
  });

  test("the version step starts again from the newest main when a merge lands while it versions", () => {
    const repo = setup({ changesets: { "brave-cats.md": changeset } });
    const race = path.join(repo.dir, "race");
    repo.git(repo.dir, "clone", "-q", repo.remote, race);
    const run = runVersionStep(repo, { RACE_CLONE: race });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /main moved while this job versioned it/);
    const log = repo.git(repo.remote, "log", "--format=%s", "main").trim().split("\n");
    assert.deepEqual(log.slice(0, 2), [
      "chore(release): version packages to 0.1.0-alpha.1 [skip ci]",
      "docs: a merge that lands meanwhile",
    ]);
  });

  test("the version step names no version for empty changesets, which bump nothing", () => {
    const repo = setup({ changesets: { "quiet-dogs.md": "---\n---\n" } });
    const run = runVersionStep(repo);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const subject = repo.git(repo.remote, "log", "-1", "--format=%s", "main").trim();
    assert.equal(subject, "chore(release): consume changesets that bump no package [skip ci]");
  });

  test("the version step fails, instead of reporting nothing to do, when the plan script crashes", () => {
    // With no changeset pending, needs-version reads pre.json, and this one makes it throw.
    const repo = setup({ pre: { mode: "bogus", tag: "alpha" } });
    const run = runVersionStep(repo);
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /Nothing to version/);
    assert.match(run.stderr, /has mode bogus/);
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
