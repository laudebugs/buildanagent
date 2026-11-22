// Runs the live list (apps/manual/src/data/live-examples.json) against the real APIs, one example at a time, and writes
// each example's live transcript to verify/<sdk>/results/live/<example>.json. Only .github/workflows/live-run.yml runs
// it, once in each provider's job; the tests run it against a stub server on the loopback interface.
//
//   node scripts/live/run.mjs --key-file <provider>=<file> [--key-file …] [--config <file>] [--report <dir>]
//                             [--out <dir>] [--catalog <file>] [--base-url <provider>=<url>]
//
// The run covers the listed examples of each provider it is given a key file for. It reads each file and deletes it,
// so no key sits in its environment. For each example it writes the key to a new file that only this user can read
// and passes that file's path, in an allowlisted environment, to the harness's own scripts/run-examples.mjs --live;
// the example's live mode reads the file and deletes it (live.ts). A run given keys for one of the list's two providers
// may spend half of the $1.00 cap, so the workflow's two provider jobs together stay within it.
//
// Before each model call the example's cost guard (budget.ts) checks the call against the cap, from a ledger that
// starts at the run's spend so far. The example writes that ledger, so this script treats its figures as the example's
// claim, and a ledger it can't read stops the run. The guard catches our own mistakes; it can't stop malicious package
// code, which can rewrite the ledger or call the provider itself, so the provider's spend limit is the hard ceiling.
//
// --out writes the transcripts elsewhere and --base-url points a provider at a loopback stub, both for the tests.
// Whatever happens to the examples, the run exits 0 with its report, unless the list or a key file is invalid, or a
// written file holds a key, in which case it deletes that file and exits 1.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CATALOG_FILE, newLedger, readCatalog, readLedger, writeLedger } from "./budget.ts";
import { exampleOf, KEY_NAMES, LIVE_EXAMPLES_FILE, liveConfigProblems, REPO_ROOT, readLiveConfig } from "./config.mjs";
import { findSecret, redact } from "./redact.ts";

const TIMEOUT_MS = 180_000;

const usd = (value) => `$${value.toFixed(4)}`;

/** The checks a live transcript records, in order. */
function checksOf(file) {
  if (!existsSync(file)) return [];
  const transcript = JSON.parse(readFileSync(file, "utf8"));
  return (transcript.events ?? []).filter((event) => event.kind === "check");
}

/** Runs one example through its harness's runner; resolves with its outcome and its redacted output. */
function runExample({ example, harnessDir, env, secrets }) {
  const { id } = exampleOf(example.file);
  return new Promise((done) => {
    const child = spawn(process.execPath, ["scripts/run-examples.mjs", "examples", "--only", id, "--live"], {
      cwd: harnessDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    // The runner stops the example's own process group when it gets SIGTERM, so it goes first and SIGKILL follows.
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 5000).unref();
    }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = redact(out, secrets);
      const line = text.split("\n").find((l) => l.trim().endsWith(` ${id}`) || l.includes(` ${id} (`));
      const outcome = signal ? "timeout" : (line?.trim().split(/\s+/)[0] ?? (code === 0 ? "ran" : "error"));
      done({ outcome, log: text.trim().split("\n").slice(-12).join("\n") });
    });
  });
}

/** Every file under `dir`, recursively. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export function reportMarkdown(report) {
  const lines = [
    `${report.providers.join(" and ")}: spent ${usd(report.spent)} of a ${usd(report.cap)} share of the run's ` +
      `${usd(report.runCap)} cap; the run's target is under ${usd(report.target)}.`,
    "",
  ];
  if (report.aborted) {
    lines.push(`The run stopped at \`${report.aborted.example}\`: ${report.aborted.reason}.`, "");
  }
  lines.push(
    "| Example | Provider and model | Outcome | Checks passed | Model calls | Spent |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const e of report.examples) {
    const checks = e.checks.total === 0 ? "none recorded" : `${e.checks.passed} of ${e.checks.total}`;
    lines.push(
      `| \`${e.file}\` | ${e.provider} \`${e.model}\` | ${e.outcome} | ${checks} | ${e.calls} | ${usd(e.spent)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Reads one key file the workflow wrote and deletes it, so the key never sits in this process's environment. */
function readKeyFile(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } finally {
    rmSync(path, { force: true });
  }
}

/**
 * The spend an example's own ledger reports, which run.mjs adds to the run's total. The example wrote that file, so
 * its figures are advisory: a ledger that is missing or malformed, or whose costs are not plain non-negative numbers,
 * stops the run, because its spend can't be known.
 */
export function childSpend(file) {
  let ledger;
  try {
    ledger = readLedger(file);
  } catch {
    return { calls: [], cost: 0, aborted: { reason: "the example left no readable ledger" } };
  }
  const calls = Array.isArray(ledger.calls) ? ledger.calls : null;
  const valid = calls?.every(
    (call) => Number.isFinite(call?.cost) && call.cost >= 0 && Number.isFinite(call?.projected),
  );
  if (!valid) return { calls: [], cost: 0, aborted: { reason: "the example's ledger was malformed" } };
  return { calls, cost: calls.reduce((sum, call) => sum + call.cost, 0), aborted: ledger.aborted ?? null };
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: LIVE_EXAMPLES_FILE },
      report: { type: "string" },
      out: { type: "string" },
      catalog: { type: "string", default: CATALOG_FILE },
      "key-file": { type: "string", multiple: true, default: [] },
      "base-url": { type: "string", multiple: true, default: [] },
    },
  });
  const pairs = (list) => Object.fromEntries(list.map((pair) => pair.split(/=(.*)/s).slice(0, 2)));
  // The keys come only from files, which are deleted once read; the environment holds none.
  const keyFiles = pairs(values["key-file"]);
  const keys = Object.fromEntries(Object.entries(keyFiles).map(([provider, path]) => [provider, readKeyFile(path)]));
  const config = readLiveConfig(values.config);
  const catalog = readCatalog(values.catalog);
  const problems = liveConfigProblems(config, { catalog, projection: false });
  for (const provider of Object.keys(keys)) {
    if (!(provider in KEY_NAMES)) problems.push(`--key-file names ${provider}, which is not a provider the run knows`);
    else if (!keys[provider]) problems.push(`the key file for ${provider} is empty`);
  }
  if (Object.keys(keys).length === 0) problems.push("give at least one --key-file <provider>=<path>");
  if (problems.length > 0) {
    console.error(`live run: ${problems.join("\n  ")}`);
    return 1;
  }
  const baseURLs = pairs(values["base-url"]);
  const secrets = Object.values(keys).filter((value) => value.length >= 8);
  // A run covers the providers it holds a key for; each provider's job may spend its share of the cap, so the jobs
  // together stay within it.
  const providers = Object.keys(keys);
  const listed = config.examples.filter((example) => providers.includes(example.provider));
  const allProviders = new Set(config.examples.map((example) => example.provider));
  const share = allProviders.size === 0 ? 0 : providers.filter((p) => allProviders.has(p)).length / allProviders.size;
  const cap = config.cap * share;

  const work = mkdtempSync(join(tmpdir(), "live-run-"));
  let spent = 0;
  let aborted = null;
  const examples = [];
  const written = [];
  for (const example of listed) {
    const { harness, id, live } = exampleOf(example.file);
    const transcript = values.out === undefined ? join(REPO_ROOT, live) : join(values.out, harness, `${id}.json`);
    const base = { file: example.file, provider: example.provider, model: example.model };
    if (aborted) {
      examples.push({ ...base, outcome: "not run", calls: 0, spent: 0, checks: { passed: 0, total: 0 }, log: "" });
      continue;
    }
    const dir = mkdtempSync(join(work, "example-"));
    // The example's ledger starts from the run's spend; the example writes it, so run.mjs reads it as a claim.
    const ledgerFile = join(dir, "ledger.json");
    writeLedger(ledgerFile, { ...newLedger(cap, config.target * share), spent });
    // The key goes to the example in a file only this user can read, which the example deletes once read.
    const keyFile = join(dir, "key");
    writeFileSync(keyFile, keys[example.provider], { mode: 0o600 });
    const env = {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(dir, "home-")),
      TMPDIR: tmpdir(),
      LANG: "C.UTF-8",
      NODE_NO_WARNINGS: "1",
      EXAMPLE_TIMEOUT_MS: String(TIMEOUT_MS - 10_000),
      LIVE: "1",
      LIVE_PROVIDER: example.provider,
      LIVE_MODEL: example.model,
      LIVE_MAX_TOKENS: String(example.maxTokens),
      LIVE_LEDGER: ledgerFile,
      LIVE_EXAMPLE: example.file,
      LIVE_CATALOG: values.catalog,
      LIVE_API_KEY_FILE: keyFile,
      ...(values.out === undefined ? {} : { LIVE_OUT_DIR: join(values.out, harness) }),
      ...(baseURLs[example.provider] === undefined ? {} : { LIVE_BASE_URL: baseURLs[example.provider] }),
    };
    const result = await runExample({ example, harnessDir: join(REPO_ROOT, harness), env, secrets });
    rmSync(keyFile, { force: true });
    const child = childSpend(ledgerFile);
    spent += child.cost;
    if (child.aborted) aborted = { example: example.file, ...child.aborted };
    const checks = checksOf(transcript);
    if (existsSync(transcript)) written.push(transcript);
    examples.push({
      ...base,
      outcome: result.outcome,
      calls: child.calls.length,
      spent: child.cost,
      checks: { passed: checks.filter((check) => check.pass).length, total: checks.length },
      transcript: existsSync(transcript)
        ? relative(values.out ?? REPO_ROOT, transcript)
            .split("\\")
            .join("/")
        : null,
      log: result.outcome === "ran" ? "" : result.log,
    });
    console.log(`${result.outcome.padEnd(8)} ${example.file}`);
    if (result.outcome !== "ran" && result.log) console.log(result.log.replace(/^/gm, "    "));
  }

  const report = {
    providers,
    cap,
    runCap: config.cap,
    target: config.target,
    spent,
    complete: aborted === null && examples.every((e) => e.outcome !== "not run"),
    aborted,
    examples,
  };
  const markdown = reportMarkdown(report);
  console.log(`\n${markdown}`);
  if (values.report !== undefined) {
    mkdirSync(values.report, { recursive: true });
    writeFileSync(join(values.report, "live-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(values.report, "live-report.md"), markdown);
    written.push(...filesUnder(values.report));
  }
  rmSync(work, { recursive: true, force: true });

  // The last guard: no file this run wrote may hold a key. The transcript writer already refuses one that does.
  const leaked = written.filter((file) => findSecret(readFileSync(file, "utf8"), secrets) !== undefined);
  for (const file of leaked) rmSync(file);
  if (leaked.length > 0) {
    console.error(`live run: deleted ${leaked.length} written file(s) that held a key or an account or request id`);
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
