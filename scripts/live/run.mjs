// Runs the live list (apps/manual/src/data/live-examples.json) against the real APIs, one example at a time, and
// writes each example's live transcript to verify/<sdk>/results/live/<example>.json. Only .github/workflows/live-run.yml
// runs it, in the step that holds the owner's keys; the tests run it against a stub server on the loopback interface.
//
//   node scripts/live/run.mjs [--config <file>] [--report <dir>] [--out <dir>] [--catalog <file>]
//                             [--base-url anthropic=<url>] [--base-url openai=<url>]
//
// The keys come from ANTHROPIC_API_KEY and OPENAI_API_KEY. Each example runs through its harness's own
// scripts/run-examples.mjs --live, in an allowlisted environment that holds only the key of the example's provider,
// under the name LIVE_API_KEY, which the example's live mode reads once and deletes (live.ts). The cost guard
// (budget.ts) checks every model call against the $1.00 cap before it is sent; when it refuses one, the run stops,
// and the report says where. --out writes the transcripts elsewhere and --base-url points a provider at a loopback
// stub, both for the tests. Whatever happens to the examples, the run exits 0 with its report, unless the list is
// invalid, a key is missing, or a written file holds a key, in which case it deletes that file and exits 1.
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
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
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

function reportMarkdown(report) {
  const lines = [
    `Spent ${usd(report.spent)} of the ${usd(report.cap)} cap; the target is under ${usd(report.target)}.`,
    "",
  ];
  if (report.aborted) {
    lines.push(
      `The cost guard stopped the run before a call in \`${report.aborted.example}\`: ${report.aborted.reason}.`,
      "",
    );
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

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: LIVE_EXAMPLES_FILE },
      report: { type: "string" },
      out: { type: "string" },
      catalog: { type: "string", default: CATALOG_FILE },
      "base-url": { type: "string", multiple: true, default: [] },
    },
  });
  const config = readLiveConfig(values.config);
  const catalog = readCatalog(values.catalog);
  const problems = liveConfigProblems(config, { catalog, projection: false });
  if (problems.length > 0) {
    console.error(`live run: ${values.config} has problems:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  const baseURLs = Object.fromEntries(values["base-url"].map((pair) => pair.split(/=(.*)/s).slice(0, 2)));
  const providers = [...new Set(config.examples.map((example) => example.provider))];
  const missing = providers.map((provider) => KEY_NAMES[provider]).filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`live run: ${missing.join(" and ")} must be set; the live-run environment holds them`);
    return 1;
  }
  const secrets = Object.values(KEY_NAMES)
    .map((name) => process.env[name])
    .filter((value) => typeof value === "string" && value.length >= 8);

  const work = mkdtempSync(join(tmpdir(), "live-run-"));
  const ledgerFile = join(work, "ledger.json");
  writeLedger(ledgerFile, newLedger(config.cap, config.target));
  const examples = [];
  const written = [];
  for (const example of config.examples) {
    const { harness, id, live } = exampleOf(example.file);
    const transcript = values.out === undefined ? join(REPO_ROOT, live) : join(values.out, harness, `${id}.json`);
    const base = { file: example.file, provider: example.provider, model: example.model };
    if (readLedger(ledgerFile).aborted) {
      examples.push({ ...base, outcome: "not run", calls: 0, spent: 0, checks: { passed: 0, total: 0 }, log: "" });
      continue;
    }
    const home = mkdtempSync(join(work, "home-"));
    // The allowlisted environment of one example: no inherited variable but PATH, and one provider's key.
    const env = {
      PATH: process.env.PATH,
      HOME: home,
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
      LIVE_API_KEY: process.env[KEY_NAMES[example.provider]],
      ...(values.out === undefined ? {} : { LIVE_OUT_DIR: join(values.out, harness) }),
      ...(baseURLs[example.provider] === undefined ? {} : { LIVE_BASE_URL: baseURLs[example.provider] }),
    };
    const result = await runExample({ example, harnessDir: join(REPO_ROOT, harness), env, secrets });
    const calls = readLedger(ledgerFile).calls.filter((call) => call.example === example.file);
    const checks = checksOf(transcript);
    if (existsSync(transcript)) written.push(transcript);
    examples.push({
      ...base,
      outcome: result.outcome,
      calls: calls.length,
      spent: calls.reduce((sum, call) => sum + call.cost, 0),
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

  const ledger = readLedger(ledgerFile);
  const report = {
    cap: ledger.cap,
    target: ledger.target,
    spent: ledger.spent,
    complete: ledger.aborted === null && examples.every((e) => e.outcome !== "not run"),
    aborted: ledger.aborted,
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

process.exitCode = await main();
