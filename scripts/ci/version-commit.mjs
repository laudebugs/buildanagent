// Recreates the checked version commit on GitHub through the API, so that GitHub signs it and the ruleset's "Require
// signed commits" lets the Version packages pull request merge. A commit pushed with plain git is unsigned. GraphQL's
// createCommitOnBranch makes a commit that GitHub signs, authored by the token's owner, but it appends to a branch's
// head, and moving the pull request's own branch back to main first could close or merge the open pull request. So the
// commit is made on a staging branch that starts at the checked base, and the release branch is then force-updated to
// it. release.yml runs this in the version-pr job's last step, the only one that holds RELEASE_PR_TOKEN, so it imports
// only node: modules and version-pr.mjs, which imports only node: modules and the two scripts beside it.
//
//   node scripts/ci/version-commit.mjs <base> <head> <branch>
//
// <head> is the local version commit, whose only parent must be <base>; REPO names the repository and gh reads the
// token from GH_TOKEN. The script makes the commit that holds <head>'s tree on <base>, checks through the REST API that
// GitHub verified its signature and that its tree and parent match, and only then moves <branch> to it. When <branch>
// already holds a verified commit with that tree on <base>, it changes nothing, so a rerun doesn't restart the checks.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRawDiff } from "./version-pr.mjs";

/** The branch the commit is made on before the release branch moves to it. Nothing else uses it. */
export const STAGING_BRANCH = "changeset-release/staging";

const CREATE_COMMIT = `mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

/**
 * Turns parseRawDiff entries into createCommitOnBranch's `fileChanges`: each added or edited file is an addition with
 * its full contents in base64, and each deleted file a deletion. A moved file, such as a changeset that moves into
 * .changeset/pre/, is a deletion of the old path plus an addition of the new one. `readBlob(sha)` returns a blob's
 * bytes.
 */
export function fileChanges(entries, readBlob) {
  const additions = [];
  const deletions = [];
  for (const entry of entries) {
    if (entry.status === "D") deletions.push({ path: entry.path });
    else if (entry.status === "A" || entry.status === "M") {
      additions.push({ path: entry.path, contents: Buffer.from(readBlob(entry.dstBlob)).toString("base64") });
    } else {
      throw new Error(`${entry.status} ${entry.path}: the API commit can express only additions, edits and deletions`);
    }
  }
  return { additions, deletions };
}

/** Splits a commit message into createCommitOnBranch's `{ headline, body }`, leaving out an empty body. */
export function commitMessage(text) {
  const [headline, ...rest] = text.replace(/\s+$/, "").split("\n");
  const body = rest.join("\n").trim();
  return body ? { headline, body } : { headline };
}

/**
 * Calls the GitHub API through gh. `run(args, input)` runs gh and returns spawnSync's `{ status, stdout, stderr }`,
 * with `error` or `signal` set when gh couldn't run or was killed. Returns the parsed response, or undefined for a
 * missing resource when `missingOk` is set, and throws on any other failure. A missing resource is a 404, or the 422
 * "Reference does not exist" that GitHub answers when the ref to delete is already gone.
 */
export function apiCall(run, { method = "GET", path, body, missingOk = false }) {
  const args = ["api", "--method", method, path];
  if (body !== undefined) args.push("--input", "-");
  const result = run(args, body === undefined ? undefined : JSON.stringify(body));
  if (result.error || result.signal) {
    throw new Error(
      `${method} ${path} failed: gh didn't run: ${result.error?.message ?? `killed by ${result.signal}`}`,
    );
  }
  if (result.status !== 0) {
    const output = `${result.stderr ?? ""} ${result.stdout ?? ""}`.trim();
    if (missingOk && /HTTP 404|Reference does not exist/.test(output)) return undefined;
    throw new Error(`${method} ${path} failed: ${output}`);
  }
  return result.stdout.trim() === "" ? undefined : JSON.parse(result.stdout);
}

/** Points `refs/heads/<branch>` at `sha`, creating the branch or force-updating it. */
function setBranch(run, repo, branch, sha) {
  const existing = apiCall(run, { path: `repos/${repo}/git/ref/heads/${branch}`, missingOk: true });
  if (existing) {
    apiCall(run, { method: "PATCH", path: `repos/${repo}/git/refs/heads/${branch}`, body: { sha, force: true } });
  } else {
    apiCall(run, { method: "POST", path: `repos/${repo}/git/refs`, body: { ref: `refs/heads/${branch}`, sha } });
  }
}

/** Says why GitHub's commit `commit` (from GET git/commits) isn't the verified commit of `tree` on `base`, or "". */
export function commitProblem(commit, { tree, base }) {
  const parents = (commit.parents ?? []).map((parent) => parent.sha);
  if (!commit.verification?.verified) {
    const reason = commit.verification?.reason ?? "none given";
    return `GitHub didn't verify the signature of ${commit.sha} (reason: ${reason})`;
  }
  if (commit.tree?.sha !== tree) return `${commit.sha} holds the tree ${commit.tree?.sha}, not the checked ${tree}`;
  if (parents.length !== 1 || parents[0] !== base) return `${commit.sha}'s parents are ${parents}, not ${base}`;
  return "";
}

/**
 * Makes the verified commit and moves `branch` to it. `local` describes the checked commit as `{ base, tree, message,
 * fileChanges }`. Returns `{ sha, created }`; throws, leaving `branch` as it was, when GitHub's commit isn't verified
 * or doesn't match. `log` receives progress lines.
 */
export function publishVersionCommit({ run, repo, branch, local, log = () => {} }) {
  const { base } = local;
  const getCommit = (sha) => apiCall(run, { path: `repos/${repo}/git/commits/${sha}` });
  const current = apiCall(run, { path: `repos/${repo}/git/ref/heads/${branch}`, missingOk: true });
  if (current && commitProblem(getCommit(current.object.sha), local) === "") {
    log(`${branch} already holds this version commit, verified, at ${current.object.sha}.`);
    return { sha: current.object.sha, created: false };
  }
  try {
    // Inside the try, so that a staging branch that GitHub created but gh failed to report is still deleted.
    setBranch(run, repo, STAGING_BRANCH, base);
    const response = apiCall(run, {
      method: "POST",
      path: "graphql",
      body: {
        query: CREATE_COMMIT,
        variables: {
          input: {
            branch: { repositoryNameWithOwner: repo, branchName: STAGING_BRANCH },
            expectedHeadOid: base,
            message: local.message,
            fileChanges: local.fileChanges,
          },
        },
      },
    });
    const sha = response?.data?.createCommitOnBranch?.commit?.oid;
    if (!sha)
      throw new Error(`createCommitOnBranch returned no commit: ${JSON.stringify(response?.errors ?? response)}`);
    const problem = commitProblem(getCommit(sha), local);
    if (problem) throw new Error(`${problem}, so ${branch} stays as it was`);
    setBranch(run, repo, branch, sha);
    log(`${branch} now holds the verified version commit ${sha}.`);
    return { sha, created: true };
  } finally {
    try {
      apiCall(run, { method: "DELETE", path: `repos/${repo}/git/refs/heads/${STAGING_BRANCH}`, missingOk: true });
    } catch (error) {
      // A leftover staging branch is harmless: the next run moves it back to its base before committing.
      console.error(`::warning::couldn't delete ${STAGING_BRANCH}: ${error.message}`);
    }
  }
}

/** Reads the checked commit `head` and its change from `base` in the git checkout at `root`. */
export function localCommit(root, base, head) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const parents = git("rev-list", "--parents", "-n", "1", head).trim().split(" ").slice(1);
  const baseSha = git("rev-parse", "--verify", `${base}^{commit}`).trim();
  if (parents.length !== 1 || parents[0] !== baseSha) {
    throw new Error(`${head}'s parents are ${parents}, but the version commit's only parent must be ${baseSha}`);
  }
  const entries = parseRawDiff(git("diff", "--raw", "-z", "--no-renames", "--no-abbrev", baseSha, head));
  const readBlob = (sha) => execFileSync("git", ["cat-file", "blob", sha], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return {
    base: baseSha,
    tree: git("rev-parse", `${head}^{tree}`).trim(),
    message: commitMessage(git("log", "-1", "--format=%B", head)),
    fileChanges: fileChanges(entries, readBlob),
  };
}

function runGh(args, input) {
  return spawnSync("gh", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head, branch] = process.argv.slice(2);
  const repo = process.env.REPO;
  try {
    if (!base || !head || !branch || !repo) {
      throw new Error("usage: REPO=<owner/name> version-commit.mjs <base> <head> <branch>");
    }
    const local = localCommit(process.cwd(), base, head);
    publishVersionCommit({ run: runGh, repo, branch, local, log: console.log });
  } catch (error) {
    console.error(`::error::version-commit: ${error.message}`);
    process.exit(1);
  }
}
