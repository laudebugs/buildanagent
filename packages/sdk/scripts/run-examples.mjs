// Runs one of the SDK's book examples against a real provider, for the book's live run (scripts/live/). Only
// scripts/live/run.mjs runs it, with --live, the LIVE_* variables and the path of the file that holds the key; the
// offline runs of the same examples are `pnpm test`'s (test/book-examples.test.ts).
//
//   node scripts/run-examples.mjs examples --only <example> --live
//
// The example runs as its own process on src/, as the offline test runs it, in a temporary directory with an
// allowlisted environment: PATH, a temporary HOME, TMPDIR, LANG and the LIVE_* variables, never ...process.env. Its
// examples/lib/live.mjs reads the key from the file and deletes it. The runner records the example's transcript to
// results/live/<provider>/<example>.json through write.mjs, or deletes that file when the example times out. It prints
// the outcome line run.mjs reads, and redacts what it prints.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveMode } from "../../../scripts/live/harness.mjs";
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_CONDITION = fileURLToPath(new URL("../../../scripts/transcripts/source-condition.mjs", import.meta.url));
const TSX = import.meta.resolve("tsx");
const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? 60_000);

/** Runs the example the arguments name; resolves with the exit code for the runner's own process. */
async function main(argv) {
  const live = liveMode(argv);
  if (live === undefined) {
    console.error(
      "run-examples: only scripts/live/run.mjs runs this, with --live; `pnpm test` runs the examples offline",
    );
    return 2;
  }
  const id = argv[argv.indexOf("--only") + 1] ?? "";
  const file = join(PACKAGE_DIR, "examples", `${id}.ts`);
  if (!/^\d{2}-[a-z0-9-]+$/.test(id) || !existsSync(file)) {
    console.error(`run-examples: ${id} is not one of the book's examples in examples/`);
    return 2;
  }
  const cwd = mkdtempSync(join(tmpdir(), "sdk-live-"));
  const home = mkdtempSync(join(tmpdir(), "sdk-live-home-"));
  const env = { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: tmpdir(), LANG: "C.UTF-8", NODE_NO_WARNINGS: "1" };
  Object.assign(env, live.env);
  const args = ["--import", TSX];
  const transcript = transcriptRun(args, env);
  args.push("--import", SOURCE_CONDITION, file);
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ exit: null, timedOut: true, out });
    }, TIMEOUT_MS);
    child.on("close", (exit) => {
      clearTimeout(timer);
      done({ exit, timedOut: false, out });
    });
  });
  // A killed example never wrote its checks, so a transcript of only its requests and answers would read as a run
  // that checked nothing; the timeout is the finding. The earlier run's transcript is deleted too, so run.mjs reports
  // no transcript rather than that run's.
  const where = { harnessDir: PACKAGE_DIR, exampleFile: file, ...live.transcript };
  if (result.timedOut) transcript.discard(where);
  else transcript.write({ ...where, cwd });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  const outcome = result.timedOut ? "timeout" : result.exit === 0 ? "ran" : "error";
  console.log(`${outcome.padEnd(8)} ${id}`);
  if (outcome !== "ran") console.log(live.redact(result.out.trim().split("\n").slice(-8).join("\n").slice(-1200)));
  return outcome === "ran" ? 0 : 1;
}

process.exitCode = await main(process.argv);
