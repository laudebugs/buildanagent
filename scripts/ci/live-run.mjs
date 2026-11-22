// The steps of .github/workflows/live-run.yml that are not the run itself (scripts/live/run.mjs) or the comparison
// (live-diff.mjs). Each reads files and git alone and imports only node: modules and the scripts beside it.
//
//   node scripts/ci/live-run.mjs protected <environment.json> <protected-branches.txt> <owner>
//       Fails unless the live-run environment, as GitHub's API returned it, still requires the owner's review, lets
//       no administrator bypass that, and allows only protected branches, and unless main is the only protected
//       branch. Each provider's job runs this before it receives its key.
//   node scripts/ci/live-run.mjs merge <out.json> <artifact-dir>...
//       Merges the provider jobs' reports into one, which the date step and the issue and pull request read. Each
//       report counts for the provider its artifact's directory names, live-<provider>, whatever the report claims.
//   node scripts/ci/live-run.mjs date <report.json> <YYYY-MM-DD>
//       Records the date in apps/manual/src/data/live-comparison.json when every listed provider's own artifact
//       reports its job complete. The report job passes the date it computed itself.
//   node scripts/ci/live-run.mjs check <base> <head> <YYYY-MM-DD>
//       Fails unless the commit <base>..<head> changes only listed examples' live transcripts, each well formed and
//       free of anything shaped like a key or an account or request id, and the date file, set to that date.
//   node scripts/ci/live-run.mjs fence <file>
//       Prints a file as a Markdown code block that its text can't close, with its @ mentions broken, so text a live
//       job wrote can go into an issue or a pull request without becoming Markdown or a notification.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleOf, KEY_NAMES, REPO_ROOT, readLiveConfig } from "../live/config.mjs";
import { findSecret } from "../live/redact.ts";
import { transcriptProblems } from "../transcripts/write.mjs";

/** The committed date of the last complete live comparison, which the book's listing pages show. */
export const DATE_FILE = "apps/manual/src/data/live-comparison.json";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The problems with the environment's protection; an empty list means it still holds. `protectedBranches` names
 * the branches GitHub's API lists for `branches?protected=true`: "protected branches only" admits every one of them,
 * so the check also fails when any branch but main is protected.
 */
export function protectionProblems(environment, protectedBranches, owner) {
  const problems = [];
  const rules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
  const reviewers = rules
    .filter((rule) => rule.type === "required_reviewers")
    .flatMap((rule) => rule.reviewers ?? [])
    .map((reviewer) => reviewer.reviewer?.login);
  if (!reviewers.includes(owner)) problems.push(`the environment no longer requires ${owner}'s review`);
  if (environment?.can_admins_bypass !== false) problems.push("administrators can bypass the environment's rules");
  const branches = environment?.deployment_branch_policy;
  if (branches?.protected_branches !== true || branches.custom_branch_policies !== false) {
    problems.push("the environment no longer allows only protected branches");
  }
  const names = Array.isArray(protectedBranches) ? protectedBranches : [];
  const others = names.filter((name) => name !== "main");
  if (!names.includes("main")) problems.push("main is not a protected branch");
  if (others.length > 0)
    problems.push(`branches other than main are protected, so they could deploy: ${others.join(", ")}`);
  return problems;
}

/**
 * Merges the provider jobs' reports into one. Each entry is `{ provider, report }`. The provider comes from the
 * artifact's name (`live-anthropic`, `live-openai`), never from the report, because a job that ran package code wrote
 * the report. A provider's job therefore can't claim another provider's examples or completion. `completed` lists the
 * providers whose own report says it ran every example.
 */
export function mergeReports(entries) {
  const known = entries.filter(({ provider }) => provider in KEY_NAMES);
  const reports = known.map(({ report }) => report ?? {});
  return {
    providers: known.map(({ provider }) => provider),
    completed: known.filter(({ report }) => report?.complete === true).map(({ provider }) => provider),
    cap: reports[0]?.runCap ?? 1,
    runCap: reports[0]?.runCap ?? 1,
    target: reports[0]?.target ?? 0.5,
    spent: reports.reduce((sum, report) => sum + (Number.isFinite(report.spent) ? report.spent : 0), 0),
    complete: known.length > 0 && known.every(({ report }) => report?.complete === true),
    aborted: reports.find((report) => report.aborted)?.aborted ?? null,
    // Each job's examples count only for its own provider.
    examples: known.flatMap(({ provider, report }) =>
      (Array.isArray(report?.examples) ? report.examples : []).filter((example) => example?.provider === provider),
    ),
  };
}

/** The provider an artifact directory belongs to, from its name, `live-<provider>`; undefined for any other name. */
export function artifactProvider(dir) {
  const match = /^live-([a-z]+)$/.exec(basename(dir));
  return match && match[1] in KEY_NAMES ? match[1] : undefined;
}

/**
 * The date file's contents after a run. They hold `date`, the date the report job computed, once every provider the
 * list names has its own artifact whose report says its job completed; otherwise they stay unchanged.
 */
export function dateAfter(report, date, current, config) {
  if (!DATE.test(date)) throw new Error(`${date} is not a YYYY-MM-DD date`);
  const listed = new Set(config.examples.map((example) => example.provider));
  const completed = Array.isArray(report?.completed) ? report.completed : [];
  return [...listed].every((provider) => completed.includes(provider)) ? { lastCompared: date } : current;
}

/** The problems with one changed file of the results commit; `read(path)` returns its new contents. */
export function changeProblems(entry, read, config, date) {
  // Each listed entry's live transcript, with the provider whose folder holds it.
  const allowed = new Map(
    config.examples.map((example) => [exampleOf(example.file, example.provider).live, example.provider]),
  );
  const { status, path } = entry;
  if (path === DATE_FILE) {
    if (status !== "M") return [`${path} may only be modified`];
    const value = JSON.parse(read(path));
    const keys = Object.keys(value);
    return keys.length === 1 && value.lastCompared === date ? [] : [`${path} must hold only the run's date, ${date}`];
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
  } else if (transcript.live.provider !== allowed.get(path)) {
    problems.push(`${path} names ${transcript.live.provider}, but it sits in ${allowed.get(path)}'s folder`);
  }
  return problems;
}

/**
 * `text` as a Markdown code block it can't close: the fence is one backtick longer than the longest run of backticks
 * in the text, and never shorter than three. Each @ before a name gets a zero-width space after it, so no mention
 * notifies anyone, inside the block or out of it.
 */
export function fenced(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const quiet = text.replace(/@(?=[A-Za-z0-9_-])/g, "@​");
  return `${fence}text\n${quiet.replace(/\n$/, "")}\n${fence}\n`;
}

function main(argv) {
  const [command, ...args] = argv;
  const json = (file) => JSON.parse(readFileSync(file, "utf8"));
  if (command === "protected") {
    const [environmentFile, branchesFile, owner] = args;
    const branches = readFileSync(branchesFile, "utf8").split("\n").filter(Boolean);
    const problems = protectionProblems(json(environmentFile), branches, owner);
    for (const problem of problems) console.error(`::error::The live-run environment changed: ${problem}.`);
    return problems.length === 0 ? 0 : 1;
  }
  if (command === "merge") {
    const [out, ...dirs] = args;
    const entries = dirs.map((dir) => ({
      provider: artifactProvider(dir),
      report: json(join(dir, "live-report.json")),
    }));
    writeFileSync(out, `${JSON.stringify(mergeReports(entries), null, 2)}\n`);
    return 0;
  }
  if (command === "date") {
    const [reportFile, date] = args;
    const current = json(join(REPO_ROOT, DATE_FILE));
    const next = dateAfter(json(reportFile), date, current, readLiveConfig());
    writeFileSync(join(REPO_ROOT, DATE_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(next === current ? "The run was not complete, so the comparison date stays." : `Compared on ${date}.`);
    return 0;
  }
  if (command === "check") {
    const [base, head, date] = args;
    if (!DATE.test(date ?? "")) {
      console.error("::error::check needs the run's own date as YYYY-MM-DD");
      return 2;
    }
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
      changeProblems(entry, (path) => git("show", `${head}:${path}`), config, date),
    );
    if (entries.length === 0) problems.push("the commit changes nothing");
    for (const problem of problems) console.error(`::error::${problem}`);
    return problems.length === 0 ? 0 : 1;
  }
  if (command === "fence") {
    process.stdout.write(fenced(readFileSync(args[0], "utf8")));
    return 0;
  }
  console.error("usage: live-run.mjs protected | merge | date | check | fence (see the file's header)");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
