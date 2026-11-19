// Offline checks for scripts/ci/version-commit.mjs, which makes the Version packages commit through GitHub's API so
// that GitHub signs it. Every GitHub call goes to a scripted stand-in for gh, so nothing here touches the network.
// release.test.mjs runs the same script inside the workflow's step against a local bare repository. Run with
// `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  apiCall,
  commitMessage,
  commitProblem,
  fileChanges,
  localCommit,
  publishVersionCommit,
  STAGING_BRANCH,
} from "./version-commit.mjs";

const BASE = "b".repeat(40);
const TREE = "7".repeat(40);
const NEW = "c".repeat(40);
const OLD = "d".repeat(40);
const repo = "o/r";
const branch = "changeset-release/main";

// A stand-in for gh: `routes` maps "METHOD path" to a response, `{ status, stdout, stderr }` or a function of the
// request body. Every call is recorded as `{ key, body }`.
function fakeGh(routes) {
  const calls = [];
  const run = (args, input) => {
    assert.equal(args[0], "api");
    assert.equal(args[1], "--method");
    const key = `${args[2]} ${args[3]}`;
    const body = input === undefined ? undefined : JSON.parse(input);
    if (input !== undefined) assert.deepEqual(args.slice(4), ["--input", "-"]);
    calls.push({ key, body });
    const route = routes[key];
    assert.ok(route, `unexpected call ${key}`);
    const answer = typeof route === "function" ? route(body) : route;
    return { status: 0, stdout: "", stderr: "", ...answer };
  };
  return { run, calls, keys: () => calls.map((call) => call.key) };
}
const json = (value) => ({ stdout: JSON.stringify(value) });
const notFound = { status: 1, stdout: '{"message":"Not Found"}', stderr: "gh: Not Found (HTTP 404)" };
// What gh prints for a DELETE of a ref that is already gone: GitHub answers 422, not 404.
const refGone = {
  status: 1,
  stdout: '{"message":"Reference does not exist"}',
  stderr: "gh: Reference does not exist (HTTP 422)",
};
// gh 2.89.0 exits 1 when a GraphQL response holds errors, with the response on stdout and each message on stderr.
const graphqlError = (message) => ({
  status: 1,
  stdout: JSON.stringify({ errors: [{ message }] }),
  stderr: `gh: ${message}`,
});
const commit = (sha, { verified = true, tree = TREE, parents = [BASE], reason } = {}) =>
  json({
    sha,
    tree: { sha: tree },
    parents: parents.map((p) => ({ sha: p })),
    verification: { verified, reason: reason ?? (verified ? "valid" : "unsigned") },
  });
const local = {
  base: BASE,
  tree: TREE,
  message: { headline: "chore(release): version packages to 0.1.0-alpha.2" },
  fileChanges: { additions: [{ path: "packages/sdk/package.json", contents: "e30K" }], deletions: [] },
};
// The routes a run takes when the release branch doesn't exist, GitHub signs the commit and nothing fails.
const fresh = (overrides = {}) => ({
  [`GET repos/${repo}/git/ref/heads/${branch}`]: notFound,
  [`GET repos/${repo}/git/ref/heads/${STAGING_BRANCH}`]: notFound,
  [`POST repos/${repo}/git/refs`]: (body) => json({ ref: body.ref, object: { sha: body.sha } }),
  "POST graphql": json({ data: { createCommitOnBranch: { commit: { oid: NEW } } } }),
  [`GET repos/${repo}/git/commits/${NEW}`]: commit(NEW),
  [`DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`]: {},
  ...overrides,
});

describe("fileChanges", () => {
  const blobs = { a1: "added\n", m1: '{"version":"0.1.0-alpha.2"}\n', p1: "moved\n", z1: Buffer.from([0, 255, 10]) };
  const readBlob = (sha) => Buffer.from(blobs[sha]);
  const entry = (status, file, dstBlob = "0".repeat(40)) => ({ status, path: file, dstBlob });

  test("adds and edits carry their full contents in base64, and deletions carry only the path", () => {
    const changes = fileChanges(
      [entry("A", "a.md", "a1"), entry("M", "packages/sdk/package.json", "m1"), entry("D", ".changeset/x.md")],
      readBlob,
    );
    assert.deepEqual(changes, {
      additions: [
        { path: "a.md", contents: Buffer.from("added\n").toString("base64") },
        { path: "packages/sdk/package.json", contents: Buffer.from(blobs.m1).toString("base64") },
      ],
      deletions: [{ path: ".changeset/x.md" }],
    });
  });

  test("a changeset moved into .changeset/pre/ is a deletion of the old path and an addition of the new one", () => {
    const changes = fileChanges([entry("D", ".changeset/x.md"), entry("A", ".changeset/pre/x.md", "p1")], readBlob);
    assert.deepEqual(changes.deletions, [{ path: ".changeset/x.md" }]);
    assert.deepEqual(changes.additions, [{ path: ".changeset/pre/x.md", contents: "bW92ZWQK" }]);
  });

  test("keeps bytes exactly, and refuses statuses the API can't express", () => {
    const [added] = fileChanges([entry("A", "bin", "z1")], readBlob).additions;
    assert.deepEqual(Buffer.from(added.contents, "base64"), blobs.z1);
    for (const status of ["R", "C", "T"]) {
      assert.throws(() => fileChanges([entry(status, "f")], readBlob), /only additions, edits and deletions/);
    }
  });
});

describe("commitMessage", () => {
  test("splits the headline from the body and drops an empty body", () => {
    assert.deepEqual(commitMessage("chore(release): version packages\n"), {
      headline: "chore(release): version packages",
    });
    assert.deepEqual(commitMessage("title\n\nmore\nlines\n"), { headline: "title", body: "more\nlines" });
  });
});

describe("commitProblem", () => {
  const parse = (answer) => JSON.parse(answer.stdout);
  test("accepts only a verified commit of the checked tree whose one parent is the base", () => {
    assert.equal(commitProblem(parse(commit(NEW)), local), "");
    assert.match(
      commitProblem(parse(commit(NEW, { verified: false, reason: "unsigned" })), local),
      /didn't verify the signature of c{40} \(reason: unsigned\)/,
    );
    assert.match(commitProblem(parse(commit(NEW, { tree: "9".repeat(40) })), local), /not the checked 7{40}/);
    assert.match(commitProblem(parse(commit(NEW, { parents: [OLD] })), local), /parents are d{40}, not b{40}/);
    assert.match(commitProblem(parse(commit(NEW, { parents: [BASE, OLD] })), local), /parents are/);
  });
});

describe("apiCall", () => {
  test("sends a body on stdin, reads a 404 as missing only when asked, and throws on other errors", () => {
    const gh = fakeGh({ "GET a": notFound, "POST b": (body) => json({ echo: body }), "GET c": { status: 1 } });
    assert.equal(apiCall(gh.run, { path: "a", missingOk: true }), undefined);
    assert.throws(() => apiCall(gh.run, { path: "a" }), /GET a failed: gh: Not Found \(HTTP 404\)/);
    assert.deepEqual(apiCall(gh.run, { method: "POST", path: "b", body: { x: 1 } }), { echo: { x: 1 } });
    assert.throws(() => apiCall(gh.run, { path: "c", missingOk: true }), /GET c failed/);
  });

  test("reads a 422 for a ref that is already gone as missing only when asked", () => {
    const gh = fakeGh({ "DELETE r": refGone });
    assert.equal(apiCall(gh.run, { method: "DELETE", path: "r", missingOk: true }), undefined);
    assert.throws(() => apiCall(gh.run, { method: "DELETE", path: "r" }), /Reference does not exist \(HTTP 422\)/);
  });

  test("names the cause when gh couldn't run or was killed", () => {
    const missing = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawnSync gh ENOENT") });
    assert.throws(() => apiCall(missing, { path: "a" }), /GET a failed: gh didn't run: spawnSync gh ENOENT/);
    const killed = () => ({ status: null, stdout: "", stderr: "", signal: "SIGTERM" });
    assert.throws(() => apiCall(killed, { path: "a" }), /GET a failed: gh didn't run: killed by SIGTERM/);
  });
});

describe("publishVersionCommit", () => {
  test("makes the commit on a staging branch at the base, checks it, then creates the release branch at it", () => {
    const gh = fakeGh(fresh());
    assert.deepEqual(publishVersionCommit({ run: gh.run, repo, branch, local }), { sha: NEW, created: true });
    assert.deepEqual(gh.keys(), [
      `GET repos/${repo}/git/ref/heads/${branch}`,
      `GET repos/${repo}/git/ref/heads/${STAGING_BRANCH}`,
      `POST repos/${repo}/git/refs`,
      "POST graphql",
      `GET repos/${repo}/git/commits/${NEW}`,
      `GET repos/${repo}/git/ref/heads/${branch}`,
      `POST repos/${repo}/git/refs`,
      `DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`,
    ]);
    assert.deepEqual(gh.calls[2].body, { ref: `refs/heads/${STAGING_BRANCH}`, sha: BASE });
    const { input } = gh.calls[3].body.variables;
    assert.match(gh.calls[3].body.query, /createCommitOnBranch\(input: \$input\)/);
    // No author or committer: GitHub signs only a commit whose authorship it sets itself.
    assert.deepEqual(Object.keys(input).sort(), ["branch", "expectedHeadOid", "fileChanges", "message"]);
    assert.deepEqual(input.branch, { repositoryNameWithOwner: repo, branchName: STAGING_BRANCH });
    assert.equal(input.expectedHeadOid, BASE);
    assert.deepEqual(input.message, local.message);
    assert.deepEqual(input.fileChanges, local.fileChanges);
    assert.deepEqual(gh.calls[6].body, { ref: `refs/heads/${branch}`, sha: NEW });
  });

  test("force-updates an existing release branch and moves a leftover staging branch back to the base", () => {
    const gh = fakeGh(
      fresh({
        [`GET repos/${repo}/git/ref/heads/${branch}`]: json({ object: { sha: OLD } }),
        [`GET repos/${repo}/git/commits/${OLD}`]: commit(OLD, { parents: ["e".repeat(40)] }),
        [`GET repos/${repo}/git/ref/heads/${STAGING_BRANCH}`]: json({ object: { sha: OLD } }),
        [`PATCH repos/${repo}/git/refs/heads/${STAGING_BRANCH}`]: {},
        [`PATCH repos/${repo}/git/refs/heads/${branch}`]: {},
      }),
    );
    publishVersionCommit({ run: gh.run, repo, branch, local });
    const patches = gh.calls.filter((call) => call.key.startsWith("PATCH"));
    assert.deepEqual(
      patches.map((call) => [call.key, call.body]),
      [
        [`PATCH repos/${repo}/git/refs/heads/${STAGING_BRANCH}`, { sha: BASE, force: true }],
        [`PATCH repos/${repo}/git/refs/heads/${branch}`, { sha: NEW, force: true }],
      ],
    );
  });

  test("changes nothing when the branch already holds the verified commit of this tree on this base", () => {
    const gh = fakeGh({
      [`GET repos/${repo}/git/ref/heads/${branch}`]: json({ object: { sha: OLD } }),
      [`GET repos/${repo}/git/commits/${OLD}`]: commit(OLD),
    });
    const lines = [];
    const result = publishVersionCommit({ run: gh.run, repo, branch, local, log: (line) => lines.push(line) });
    assert.deepEqual(result, { sha: OLD, created: false });
    assert.equal(gh.calls.length, 2);
    assert.match(lines[0], /already holds this version commit, verified/);
  });

  test("replaces an unsigned commit even when its tree and base match, as on pull request #70", () => {
    const gh = fakeGh(
      fresh({
        [`GET repos/${repo}/git/ref/heads/${branch}`]: json({ object: { sha: OLD } }),
        [`GET repos/${repo}/git/commits/${OLD}`]: commit(OLD, { verified: false }),
        [`PATCH repos/${repo}/git/refs/heads/${branch}`]: {},
      }),
    );
    assert.deepEqual(publishVersionCommit({ run: gh.run, repo, branch, local }), { sha: NEW, created: true });
  });

  for (const [name, answer, message] of [
    ["isn't verified", commit(NEW, { verified: false, reason: "unsigned" }), /didn't verify the signature/],
    ["holds another tree", commit(NEW, { tree: "9".repeat(40) }), /not the checked/],
    ["has another parent", commit(NEW, { parents: [OLD] }), /parents are/],
  ]) {
    test(`fails, leaving the release branch alone and deleting the staging branch, when the new commit ${name}`, () => {
      const gh = fakeGh(fresh({ [`GET repos/${repo}/git/commits/${NEW}`]: answer }));
      assert.throws(() => publishVersionCommit({ run: gh.run, repo, branch, local }), message);
      assert.equal(gh.keys().filter((key) => key === `POST repos/${repo}/git/refs`).length, 1, "only staging");
      assert.equal(gh.keys().at(-1), `DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`);
    });
  }

  test("fails, leaving the release branch alone, when the mutation returns errors and gh exits 1", () => {
    const gh = fakeGh(fresh({ "POST graphql": graphqlError("Expected branch to point to x") }));
    assert.throws(
      () => publishVersionCommit({ run: gh.run, repo, branch, local }),
      /POST graphql failed: gh: Expected branch to point to x/,
    );
    assert.ok(!gh.keys().some((key) => key.includes(`refs/heads/${branch}`) && !key.startsWith("GET")));
    assert.equal(gh.keys().at(-1), `DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`);
  });

  test("fails when the mutation succeeds but names no commit", () => {
    const gh = fakeGh(fresh({ "POST graphql": json({ data: { createCommitOnBranch: null } }) }));
    assert.throws(() => publishVersionCommit({ run: gh.run, repo, branch, local }), /returned no commit/);
  });

  test("deletes the staging branch, without a warning, when creating it fails after GitHub made it", () => {
    const gh = fakeGh(
      fresh({
        [`POST repos/${repo}/git/refs`]: { status: 1, stderr: "gh: Server Error (HTTP 502)" },
        [`DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`]: {},
      }),
    );
    assert.throws(() => publishVersionCommit({ run: gh.run, repo, branch, local }), /HTTP 502/);
    assert.equal(gh.keys().at(-1), `DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`);
  });

  test("doesn't warn when the staging branch to delete is already gone", (t) => {
    const warn = t.mock.method(console, "error", () => {});
    const gh = fakeGh(
      fresh({
        [`POST repos/${repo}/git/refs`]: { status: 1, stderr: "gh: Server Error (HTTP 502)" },
        [`DELETE repos/${repo}/git/refs/heads/${STAGING_BRANCH}`]: refGone,
      }),
    );
    assert.throws(() => publishVersionCommit({ run: gh.run, repo, branch, local }), /HTTP 502/);
    assert.equal(warn.mock.callCount(), 0);
  });
});

describe("localCommit", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  // A repository with a base commit and a version commit on it that bumps a package and moves a changeset.
  function versioned() {
    const dir = mkdtempSync(path.join(tmpdir(), "version-commit-"));
    dirs.push(dir);
    const env = { PATH: process.env.PATH, HOME: dir, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1" };
    const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    write("packages/sdk/package.json", '{"version":"0.1.0-alpha.1"}\n');
    write(".changeset/brave-cats.md", "---\n---\n");
    write(".changeset/old.md", "gone\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    write("packages/sdk/package.json", '{"version":"0.1.0-alpha.2"}\n');
    mkdirSync(path.join(dir, ".changeset/pre"));
    git("mv", ".changeset/brave-cats.md", ".changeset/pre/brave-cats.md");
    git("rm", "-q", ".changeset/old.md");
    git("add", "-A");
    git("commit", "-qm", "chore(release): version packages to 0.1.0-alpha.2");
    return { dir, git };
  }

  test("expresses the change as additions and deletions, with the tree and headline of the checked commit", () => {
    const { dir, git } = versioned();
    const result = localCommit(dir, "HEAD~1", "HEAD");
    assert.equal(result.base, git("rev-parse", "HEAD~1"));
    assert.equal(result.tree, git("rev-parse", "HEAD^{tree}"));
    assert.deepEqual(result.message, { headline: "chore(release): version packages to 0.1.0-alpha.2" });
    assert.deepEqual(result.fileChanges.deletions.map((d) => d.path).sort(), [
      ".changeset/brave-cats.md",
      ".changeset/old.md",
    ]);
    assert.deepEqual(
      result.fileChanges.additions.map((a) => [a.path, Buffer.from(a.contents, "base64").toString()]),
      [
        [".changeset/pre/brave-cats.md", "---\n---\n"],
        ["packages/sdk/package.json", '{"version":"0.1.0-alpha.2"}\n'],
      ],
    );
  });

  test("refuses a head whose parent isn't the base", () => {
    const { dir, git } = versioned();
    git("commit", "-q", "--allow-empty", "-m", "another");
    assert.throws(() => localCommit(dir, "HEAD~2", "HEAD"), /the version commit's only parent must be/);
  });
});
