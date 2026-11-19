// The steps of .github/workflows/live-run.yml that are not the run itself (scripts/live/run.mjs) or the comparison
// (live-diff.mjs). Each reads files and git alone and imports only node: modules and the scripts beside it.
//
//   node scripts/ci/live-run.mjs protected <environment.json> <owner>
//       Fails unless the live-run environment, as GitHub's API returned it, still requires the owner's review and
//       allows only protected branches. The job runs this before the step that receives the keys.
//   node scripts/ci/live-run.mjs date <report.json> <YYYY-MM-DD>
//       Records the run's date in apps/manual/src/data/live-comparison.json when every listed example ran, so the
//       book's line names the last complete comparison.
//   node scripts/ci/live-run.mjs check <base> <head>
//       Fails unless the commit <base>..<head> changes only listed examples' live transcripts and the date file, each
//       well formed and free of anything shaped like a key or an account or request id.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleOf, REPO_ROOT, readLiveConfig } from "../live/config.mjs";
import { findSecret } from "../live/redact.ts";
import { transcriptProblems } from "../transcripts/write.mjs";

/** The committed date of the last complete live comparison, which the book's listing pages show. */
export const DATE_FILE = "apps/manual/src/data/live-comparison.json";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The problems with the environment's protection; an empty list means it still holds. */
export function protectionProblems(environment, owner) {
  const problems = [];
  const rules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
  const reviewers = rules
    .filter((rule) => rule.type === "required_reviewers")
    .flatMap((rule) => rule.reviewers ?? [])
    .map((reviewer) => reviewer.reviewer?.login);
  if (!reviewers.includes(owner)) problems.push(`the environment no longer requires ${owner}'s review`);
  const branches = environment?.deployment_branch_policy;
  if (branches?.protected_branches !== true || branches.custom_branch_policies !== false) {
    problems.push("the environment no longer allows only protected branches");
  }
  return problems;
}

/** The date file's contents after a run: the run's date when it was complete, else unchanged. */
export function dateAfter(report, date, current) {
  if (!DATE.test(date)) throw new Error(`${date} is not a YYYY-MM-DD date`);
  return report?.complete === true ? { lastCompared: date } : current;
}

/** The problems with one changed file of the results commit; `read(path)` returns its new contents. */
export function changeProblems(entry, read, config) {
  const allowed = new Set(config.examples.map((example) => exampleOf(example.file).live));
  const { status, path } = entry;
  if (path === DATE_FILE) {
    if (status !== "M") return [`${path} may only be modified`];
    const value = JSON.parse(read(path));
    const keys = Object.keys(value);
    return keys.length === 1 && DATE.test(value.lastCompared ?? "")
      ? []
      : [`${path} must hold only a lastCompared date`];
  }
  if (!allowed.has(path)) return [`${path} is not a listed example's live transcript`];
  if (status === "D") return [];
  if (status !== "A" && status !== "M") return [`${path}: ${status} is not an addition, edit or deletion`];
  const text = read(path);
  const problems = [];
  const secret = findSecret(text);
  if (secret !== undefined) problems.push(`${path} holds ${secret}`);
  let transcript;
  try {
    transcript = JSON.parse(text);
  } catch {
    return [...problems, `${path} is not JSON`];
  }
  problems.push(...transcriptProblems(transcript).map((problem) => `${path}: ${problem}`));
  if (typeof transcript.live?.provider !== "string" || typeof transcript.live?.model !== "string") {
    problems.push(`${path} does not name the live run's provider and model`);
  }
  return problems;
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "protected") {
    const [file, owner] = args;
    const problems = protectionProblems(JSON.parse(readFileSync(file, "utf8")), owner);
    for (const problem of problems) console.error(`::error::The live-run environment changed: ${problem}.`);
    return problems.length === 0 ? 0 : 1;
  }
  if (command === "date") {
    const [reportFile, date] = args;
    const current = JSON.parse(readFileSync(join(REPO_ROOT, DATE_FILE), "utf8"));
    const next = dateAfter(JSON.parse(readFileSync(reportFile, "utf8")), date, current);
    writeFileSync(join(REPO_ROOT, DATE_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(next === current ? "The run was not complete, so the comparison date stays." : `Compared on ${date}.`);
    return 0;
  }
  if (command === "check") {
    const [base, head] = args;
    const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: REPO_ROOT, encoding: "utf8" });
    const entries = git("diff", "--name-status", "--no-renames", base, head)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, path] = line.split("\t");
        return { status, path };
      });
    const config = readLiveConfig();
    const problems = entries.flatMap((entry) =>
      changeProblems(entry, (path) => git("show", `${head}:${path}`), config),
    );
    if (entries.length === 0) problems.push("the commit changes nothing");
    for (const problem of problems) console.error(`::error::${problem}`);
    return problems.length === 0 ? 0 : 1;
  }
  console.error(
    "usage: live-run.mjs protected <environment.json> <owner> | date <report.json> <date> | check <base> <head>",
  );
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
