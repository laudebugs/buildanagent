// Offline tests for results-drift.mjs; run with `node --test scripts/ci/*.test.mjs`. Each test builds a small git
// repository in a temporary directory, commits a harness's results, changes them as a run would, and runs the script
// there.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./results-drift.mjs", import.meta.url));
let repo;

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function write(file, text) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
}

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

const transcript = (answer) =>
  `${JSON.stringify(
    {
      format: 1,
      example: "01-call",
      file: "verify/demo/examples/01-call.ts",
      harness: "verify/demo",
      pin: "demo@1.0.0",
      events: [
        { kind: "request", line: 2, model: "model-1", repeated: 0, messages: [], tools: [] },
        {
          kind: "response",
          line: 2,
          model: "model-1",
          message: { role: "assistant", parts: [{ type: "text", text: answer }] },
          finish: "stop",
        },
      ],
    },
    null,
    2,
  )}\n`;

/** A repository with one harness whose example, run results and transcript are committed. */
function committedHarness() {
  repo = mkdtempSync(join(tmpdir(), "drift-"));
  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write("verify/demo/examples/01-call.ts", "// an example\n");
  write("verify/demo/results/run-examples.json", JSON.stringify([{ file: "01-call.ts", outcome: "ran", ms: 10 }]));
  write("verify/demo/results/transcripts/01-call.json", transcript("Hello."));
  git("add", ".");
  git("commit", "--quiet", "-m", "results");
}

const drift = () => spawnSync(process.execPath, [script], { cwd: repo, encoding: "utf8" });

test("passes when a run rewrites the same transcript and changes only a timing", () => {
  committedHarness();
  write("verify/demo/results/transcripts/01-call.json", transcript("Hello."));
  write("verify/demo/results/run-examples.json", JSON.stringify([{ file: "01-call.ts", outcome: "ran", ms: 99 }]));
  const run = drift();
  assert.equal(run.status, 0, run.stderr);
});

test("fails when the example's model exchange changed but the committed transcript did not", () => {
  committedHarness();
  write("verify/demo/results/transcripts/01-call.json", transcript("Hello there."));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /verify\/demo\/results\/transcripts\/01-call\.json: \/events\/1\/message\/parts\/0\/text/);
});

test("fails when a transcript's bytes change though its JSON does not", () => {
  committedHarness();
  write("verify/demo/results/transcripts/01-call.json", JSON.stringify(JSON.parse(transcript("Hello."))));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /same JSON, different bytes/);
});

test("fails on a transcript the run wrote that is not committed", () => {
  committedHarness();
  write("verify/demo/examples/02-loop.ts", "// another example\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "example");
  write("verify/demo/results/transcripts/02-loop.json", transcript("Loop."));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /02-loop\.json \(untracked\)/);
});

test("fails on a committed transcript the run deleted", () => {
  committedHarness();
  rmSync(join(repo, "verify/demo/results/transcripts/01-call.json"));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /01-call\.json \(deleted\)/);
});

test("fails on a committed transcript whose example no longer exists", () => {
  committedHarness();
  git("rm", "--quiet", "verify/demo/examples/01-call.ts");
  git("commit", "--quiet", "-m", "remove the example");
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /01-call\.json \(no example verify\/demo\/examples\/01-call\.ts\)/);
});

/** A repository with one of our own packages, whose example and transcript are committed and no run results. */
function committedPackage() {
  committedHarness();
  write("packages/sdk/examples/01-call.ts", "// an example\n");
  write("packages/sdk/results/transcripts/01-call.json", transcript("Hello."));
  git("add", ".");
  git("commit", "--quiet", "-m", "package transcript");
}

test("fails when one of our own packages' transcripts changed", () => {
  committedPackage();
  write("packages/sdk/results/transcripts/01-call.json", transcript("Hello there."));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /packages\/sdk\/results\/transcripts\/01-call\.json: \/events\/1\/message\/parts\/0\/text/);
});

test("fails on a transcript one of our packages wrote that is not committed", () => {
  committedPackage();
  write("packages/sdk/results/transcripts/02-loop.json", transcript("Loop."));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /packages\/sdk\/results\/transcripts\/02-loop\.json \(untracked\)/);
});

test("fails on a package transcript whose example no longer exists", () => {
  committedPackage();
  git("rm", "--quiet", "packages/sdk/examples/01-call.ts");
  git("commit", "--quiet", "-m", "remove the example");
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /01-call\.json \(no example packages\/sdk\/examples\/01-call\.ts\)/);
});

/** A release tracker as ahead-of-release.mjs writes it, committed in the harness of `committedHarness()`. */
const tracker = ({ latest = "1.0.0", main = "a".repeat(40), exports = ["One"] } = {}) =>
  `${JSON.stringify(
    { checkedAt: "2026-11-27T00:00:00.000Z", latest: { demo: latest }, main, exportsOnMainNotIn250: exports },
    null,
    2,
  )}\n`;

function committedTracker() {
  committedHarness();
  write("verify/demo/results/latest-releases.json", tracker());
  git("add", ".");
  git("commit", "--quiet", "-m", "tracker");
}

test("passes when only the upstream main branch moved in a release tracker", () => {
  committedTracker();
  write("verify/demo/results/latest-releases.json", tracker({ main: "b".repeat(40), exports: ["One", "Two"] }));
  const run = drift();
  assert.equal(run.status, 0, run.stderr);
});

test("fails when a release tracker records a new release", () => {
  committedTracker();
  write("verify/demo/results/latest-releases.json", tracker({ latest: "1.0.1" }));
  const run = drift();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /latest-releases\.json: \/latest\/demo: "1\.0\.0" -> "1\.0\.1"/);
});
