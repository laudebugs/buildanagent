// A stand-in for gh, shared by the tests that run release.yml's and sdk-updates.yml's steps for real. This file is a
// test helper, so `node --test scripts/ci/*.test.mjs` doesn't run it as a test.
//
// The stand-in logs each call to $GH_LOG and answers as GitHub would: `pr list` prints $EXISTING_PR,
// `pr create` prints the new pull request's URL, `pr view` prints $AUTO_MERGE, whether auto-merge is on, and the
// branch lookup prints $REQUIRED_CHECKS, whether main requires the checks status (nothing when it requires none).
// The git ref and commit endpoints and GraphQL's createCommitOnBranch act on the bare repository $FAKE_REMOTE. A
// commit made through createCommitOnBranch is listed in $FAKE_REMOTE/signed and reads as verified, unless
// $UNVERIFIED is set; a commit pushed with git reads as unsigned, as on GitHub.
export const FAKE_GH = `#!/usr/bin/env node
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
  const message = git(["log", "-1", "--format=%B", match[1]]);
  const [name, email] = git(["log", "-1", "--format=%cn%n%ce", match[1]]).split("\\n");
  out({ sha: match[1], message, committer: { name, email }, tree: { sha: tree }, parents: parents.map((p) => ({ sha: p })),
    verification: { verified, reason: verified ? "valid" : "unsigned" } });
}
if (method === "POST" && route === "graphql") {
  const input = body.variables.input;
  const ref = "refs/heads/" + input.branch.branchName;
  if (input.branch.repositoryNameWithOwner !== "o/r") fail(422, "wrong repository");
  // $MOVED_HEAD stands for another writer that moved the branch after the script set it.
  if (process.env.MOVED_HEAD || sha(ref) !== input.expectedHeadOid) {
    // gh 2.89.0 exits 1 when a GraphQL response holds errors, with the response on stdout and each message on stderr.
    const message = "Expected branch to point to " + input.expectedHeadOid;
    console.log(JSON.stringify({ errors: [{ message }] }));
    console.error("gh: " + message);
    process.exit(1);
  }
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
