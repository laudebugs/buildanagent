// Offline tests for the live run: the cost guard (scripts/live/budget.ts), the example list (config.mjs), redaction,
// the live transcript writer, the runner (run.mjs) against a stub server on the loopback interface, the flow
// comparison (live-diff.mjs), the workflow's helper steps (live-run.mjs) and the workflow itself. Run with
// `node --test scripts/ci/*.test.mjs`. No test reaches a provider: every request goes to live-stub.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  LiveBudgetError,
  newLedger,
  priceUsage,
  projectCost,
  readCatalog,
  readLedger,
  reserveCall,
  settleCall,
  writeLedger,
} from "../live/budget.ts";
import { exampleOf, LIVE_HARNESSES, liveConfigProblems, projection, readLiveConfig } from "../live/config.mjs";
import { liveMode } from "../live/harness.mjs";
import { findSecret, redact } from "../live/redact.ts";
import { writeTranscript } from "../transcripts/write.mjs";
import { compareAll, compareFlows, diffMarkdown, flowOf } from "./live-diff.mjs";
import { changeProblems, DATE_FILE, dateAfter, protectionProblems } from "./live-run.mjs";
import { STUB_IDS, startStub, turnsFromTranscript } from "./live-stub.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = readLiveConfig();
const catalog = readCatalog();
const FAKE_KEYS = {
  ANTHROPIC_API_KEY: "sk-ant-fake-0123456789abcdefghij",
  OPENAI_API_KEY: "sk-fake0123456789abcdefghijklmn",
};
const close = (a, b) => Math.abs(a - b) < 1e-12;

// --- The cost guard ---------------------------------------------------------------------------------------------

test("projectCost prices every input token at the tier's dearest input rate and the whole output allowance", () => {
  const haiku = catalog.models.find((entry) => entry.id === "claude-haiku-5-5");
  // Up to 100,000 input tokens: the 1-hour cache write ($0.20) is the dearest input rate; output is $0.50.
  assert.ok(close(projectCost({ inputTokens: 8000, maxOutputTokens: 1024 }, haiku), (8000 * 0.2 + 1024 * 0.5) / 1e6));
  // Past 100,000 the long-context tier applies: $1.00 for a 1-hour write and $2.50 for output.
  assert.ok(close(projectCost({ inputTokens: 200_000, maxOutputTokens: 10 }, haiku), (200_000 * 1 + 10 * 2.5) / 1e6));
  const mini = catalog.models.find((entry) => entry.id === "gpt-5.4-mini");
  assert.ok(close(projectCost({ inputTokens: 8000, maxOutputTokens: 2048 }, mini), (8000 * 0.75 + 2048 * 4.5) / 1e6));
  assert.equal(projectCost({ inputTokens: 1, maxOutputTokens: 1 }, undefined), null);
});

test("priceUsage prices each reported token class at its own rate", () => {
  const haiku = catalog.models.find((entry) => entry.id === "claude-haiku-5-5");
  const cost = priceUsage({ uncachedInput: 1000, cacheRead: 500, cacheWrite: 200, output: 100 }, haiku);
  assert.ok(close(cost, (1000 * 0.1 + 500 * 0.01 + 200 * 0.125 + 100 * 0.5) / 1e6));
});

/** A price table whose one model makes each call cost about a quarter of the cap, so the guard's choice is visible. */
function fixtureCatalog(dir) {
  const file = join(dir, "catalog.json");
  const tier = { upToInputTokens: null, uncachedInput: 100, cacheRead: 100, cacheWrite: { "5m": 100, "1h": 100 } };
  const models = ["anthropic", "openai"].map((provider) => ({
    provider,
    id: provider === "anthropic" ? "claude-haiku-5-5" : "gpt-5.4-mini",
    rates: [{ ...tier, output: 1000 }],
    asOf: "2026-11-19",
  }));
  writeFileSync(file, JSON.stringify({ models }));
  return file;
}

test("the guard refuses, before it is sent, the call that would take the spend past the cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-guard-"));
  const prices = readCatalog(fixtureCatalog(dir));
  const ledger = join(dir, "ledger.json");
  writeLedger(ledger, newLedger(1, 0.5));
  // Each call projects 2,000 × $100/M + 100 × $1000/M = $0.30 and reports 3,000 in and 100 out, $0.40.
  const call = {
    example: "x",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    inputTokens: 2000,
    maxOutputTokens: 100,
  };
  const usage = { uncachedInput: 3000, output: 100 };
  let sent = 0;
  for (let i = 0; i < 5; i++) {
    let projected;
    try {
      projected = reserveCall(ledger, call, prices);
    } catch (error) {
      assert.ok(error instanceof LiveBudgetError);
      break;
    }
    sent += 1;
    settleCall(ledger, call, projected, usage, prices);
  }
  const after = readLedger(ledger);
  // $0.40 + $0.40 spent; the third call's $0.30 would make $1.10, so it never goes out.
  assert.equal(sent, 2);
  assert.ok(close(after.spent, 0.8));
  assert.ok(close(after.aborted.projected, 0.3));
  assert.match(
    after.aborted.reason,
    /\$0\.8000 spent plus this call's projected \$0\.3000 would pass the \$1\.0000 cap/,
  );
  // Once the guard has refused a call, it refuses every later one.
  assert.throws(() => reserveCall(ledger, { ...call, inputTokens: 1, maxOutputTokens: 1 }, prices), LiveBudgetError);
  rmSync(dir, { recursive: true, force: true });
});

test("the guard refuses a model the price catalog lacks instead of guessing its price", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-guard-"));
  const ledger = join(dir, "ledger.json");
  writeLedger(ledger, newLedger());
  const call = { example: "x", provider: "anthropic", model: "no-such-model", inputTokens: 1, maxOutputTokens: 1 };
  assert.throws(() => reserveCall(ledger, call, catalog), /no entry for anthropic no-such-model/);
  rmSync(dir, { recursive: true, force: true });
});

// --- The example list --------------------------------------------------------------------------------------------

test("the committed list is sound and projects under the $0.50 target", () => {
  assert.deepEqual(liveConfigProblems(config), []);
  assert.ok(projection(config).total < 0.5);
  assert.equal(config.projection.total, projection(config).total);
  for (const example of config.examples) assert.ok(LIVE_HARNESSES.includes(exampleOf(example.file).harness));
});

test("the list refuses google-adk, a provider a harness's pins don't reach, and a stale projection", () => {
  const adk = { ...config.examples[0], file: "verify/google-adk/examples/08-triage-agent.ts" };
  assert.ok(liveConfigProblems({ ...config, examples: [adk] }).some((p) => /reach no provider/.test(p)));
  const openaiOnly = { ...config.examples.find((e) => e.file.includes("openai-agents")), provider: "anthropic" };
  assert.ok(liveConfigProblems({ ...config, examples: [openaiOnly] }).some((p) => /reach openai/.test(p)));
  const stale = { ...config, projection: { ...config.projection, total: 0.01 } };
  assert.ok(liveConfigProblems(stale).some((p) => /projection.total/.test(p)));
  assert.ok(liveConfigProblems({ ...config, cap: 2 }).some((p) => /cap is 2/.test(p)));
});

// --- Redaction and the writer -----------------------------------------------------------------------------------

test("redaction names the shape it found and never repeats the value", () => {
  const key = FAKE_KEYS.ANTHROPIC_API_KEY;
  assert.equal(findSecret(`x ${key} y`, [key]), "an API key the run was given");
  assert.equal(findSecret(`request-id: ${STUB_IDS.requestId}`), "an Anthropic request id");
  assert.equal(findSecret("Authorization: Bearer abcdefghijklmnop"), "an authorization header");
  assert.equal(findSecret(`anthropic-workspace-id: ${STUB_IDS.workspace}`), "a workspace header");
  assert.equal(findSecret("It is 21C in Lisbon."), undefined);
  const out = redact(`ok\nkey=${key}\nopenai-organization: ${STUB_IDS.organization}`, [key]);
  assert.ok(!out.includes(key) && !out.includes(STUB_IDS.organization));
  assert.match(out, /^ok\n/);
});

test("the writer refuses a live transcript that holds the key, and drops every tool-call id the model chose", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-writer-"));
  const harnessDir = join(root, "verify/vercel-ai-sdk");
  const exampleFile = join(harnessDir, "examples/09-triage-agent.ts");
  const events = (text) => [
    { kind: "request", model: "model-1", messages: [{ role: "user", parts: [{ type: "text", text }] }], tools: [] },
    {
      kind: "response",
      model: "model-1",
      message: { role: "assistant", parts: [{ type: "tool-call", id: "toolu_01Real", name: "t", input: {} }] },
      finish: "tool-calls",
      scripted: ["toolu_01Real"],
    },
  ];
  const write = (text) => {
    const rawFile = join(dir, "raw.json");
    writeFileSync(rawFile, JSON.stringify({ events: events(text) }));
    const live = { provider: "anthropic", model: "claude-haiku-5-5", secrets: [FAKE_KEYS.ANTHROPIC_API_KEY] };
    return writeTranscript({ harnessDir, exampleFile, rawFile, cwd: dir, home: dir, outDir: dir, live });
  };
  const file = write("hello");
  const written = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(written.live, { provider: "anthropic", model: "claude-haiku-5-5" });
  assert.equal(written.events[1].message.parts[0].id, "<id-1>");
  assert.equal(write(`the key is ${FAKE_KEYS.ANTHROPIC_API_KEY}`), undefined);
  assert.ok(!existsSync(file), "the earlier file is deleted, so no stale transcript stays");
  rmSync(dir, { recursive: true, force: true });
});

test("a harness runner's --live needs the runner's environment and one example", () => {
  assert.equal(liveMode(["node", "x"], {}), undefined);
  assert.throws(() => liveMode(["node", "x", "--live", "--only", "a"], {}), /only under scripts\/live\/run\.mjs/);
  assert.throws(() => liveMode(["node", "x", "--live"], { LIVE: "1", LIVE_API_KEY: "k".repeat(10) }), /--only/);
  const mode = liveMode(["node", "x", "--live", "--only", "a"], {
    LIVE: "1",
    LIVE_API_KEY: "k".repeat(10),
    HOME: "/h",
  });
  assert.equal(mode.env.HOME, undefined, "only LIVE_* variables pass on");
});

// --- The runner against a stub ----------------------------------------------------------------------------------

/** Which listed example a request comes from, by the tools it offers, and that example's mock answers. */
function stubScript(examples) {
  const turns = new Map(
    examples.map((e) => [
      e.file,
      turnsFromTranscript(JSON.parse(readFileSync(join(root, exampleOf(e.file).mock), "utf8"))),
    ]),
  );
  const counts = new Map();
  const exampleFor = (provider, body) => {
    const names = (body.tools ?? []).map((tool) => tool.name);
    const find = (part) => examples.find((e) => e.file.includes(part))?.file;
    if (provider === "anthropic") {
      if (names.includes("lookupOrder")) return find("vercel-ai-sdk");
      if (names.includes("Triage")) return find("langchain");
      if (names.includes("submit_triage")) return find("verify/pi/");
    } else {
      return names.includes("lookup_customer") ? find("openai-agents-sdk") : find("cloudflare-agents");
    }
    return undefined;
  };
  return (provider, body) => {
    const file = exampleFor(provider, body);
    const n = counts.get(file) ?? 0;
    counts.set(file, n + 1);
    return turns.get(file)?.[n] ?? "No more turns.";
  };
}

/** Runs run.mjs with the fake keys; resolves with its exit code and everything it printed. */
function runLive(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "scripts/live/run.mjs"), ...args], {
      env: { PATH: process.env.PATH, ...FAKE_KEYS },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The fake keys and the stub's account and request ids: none may reach a file or a log. */
const SECRETS = [
  ...Object.values(FAKE_KEYS),
  STUB_IDS.requestId,
  STUB_IDS.organization,
  STUB_IDS.anthropicOrganization,
];

function writeConfig(dir, examples, extra = {}) {
  const file = join(dir, "live-examples.json");
  const list = { ...config, examples, ...extra };
  list.projection = { ...config.projection, ...projection(list) };
  writeFileSync(file, JSON.stringify(list));
  return file;
}

test("every listed example runs live against a stub that answers as its mock did, and keeps the mock's flow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  const stub = await startStub(stubScript(config.examples));
  const out = join(dir, "out");
  const report = join(dir, "report");
  const { code, out: log } = await runLive([
    ...["--config", writeConfig(dir, config.examples), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`, "--base-url", `openai=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.ok(results.complete, log);
  for (const example of results.examples) assert.equal(example.outcome, "ran", `${example.file}\n${log}`);
  assert.match(
    readFileSync(join(report, "live-report.md"), "utf8"),
    /of the \$1\.0000 cap; the target is under \$0\.5000/,
  );
  const flows = compareAll(config, { liveDir: out });
  for (const result of flows) assert.deepEqual(result.differences, [], result.file);

  // Each key reached only its own provider, in that provider's header, and every call kept to its allowance.
  for (const request of stub.requests) {
    if (request.provider === "anthropic") {
      assert.equal(request.headers["x-api-key"], FAKE_KEYS.ANTHROPIC_API_KEY);
      assert.ok(request.body.max_tokens <= 1024);
    } else {
      assert.equal(request.headers.authorization, `Bearer ${FAKE_KEYS.OPENAI_API_KEY}`);
      assert.ok(request.body.max_output_tokens <= 2048);
    }
    const names = (request.body.tools ?? []).map((tool) => tool.name);
    for (const host of ["read", "write", "edit", "bash", "ls", "grep"]) assert.ok(!names.includes(host), host);
  }
  // No key, account id or request id reached a written file or the log.
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, "utf8");
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${file} holds a secret`);
  }
  for (const secret of SECRETS) assert.ok(!log.includes(secret), "the log holds a secret");
  rmSync(dir, { recursive: true, force: true });
});

test("a provider error that repeats the key reaches no file or log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  // The stub answers as a broken provider might: an error that quotes the key and the request id.
  const stub = await startStub(() => "unused", {
    fail: (_provider, _body, headers) => ({
      type: "error",
      error: {
        type: "authentication_error",
        message: `invalid x-api-key ${headers["x-api-key"]} ${STUB_IDS.requestId}`,
      },
    }),
  });
  const examples = config.examples.filter((e) => e.provider === "anthropic").slice(0, 1);
  const out = join(dir, "out");
  const report = join(dir, "report");
  const { code, out: log } = await runLive([
    ...["--config", writeConfig(dir, examples), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.equal(results.examples[0].outcome, "error");
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, "utf8");
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${file} holds a secret`);
  }
  for (const secret of SECRETS) assert.ok(!log.includes(secret), "the log holds a secret");
  rmSync(dir, { recursive: true, force: true });
});

test("with a fixture price table, the run stops before the call that would pass $1.00 and reports it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  const examples = config.examples.filter((e) => e.provider === "anthropic").map((e) => ({ ...e, maxTokens: 300 }));
  // Each answer reports 100 input and its whole 300-token allowance as output: about $0.31 at the fixture's rates,
  // under each call's projection, as a real answer is.
  const stub = await startStub(stubScript(examples), { usage: { input: 100, output: 300 } });
  const report = join(dir, "report");
  const { code, out: log } = await runLive([
    ...["--config", writeConfig(dir, examples), "--out", join(dir, "out"), "--report", report],
    ...["--catalog", fixtureCatalog(dir), "--base-url", `anthropic=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  const calls = results.examples.reduce((sum, e) => sum + e.calls, 0);
  assert.equal(stub.requests.length, calls, "every call the stub saw is in the ledger");
  assert.ok(calls >= 2 && calls < 9, `the guard stopped the run part way (${calls} calls)`);
  assert.ok(results.spent <= 1, `spent ${results.spent}`);
  assert.ok(results.aborted !== null && results.spent + results.aborted.projected > 1);
  assert.equal(results.complete, false);
  assert.equal(results.examples.at(-1).outcome, "not run");
  const markdown = readFileSync(join(report, "live-report.md"), "utf8");
  assert.match(markdown, /^Spent \$0\.\d{4} of the \$1\.0000 cap; the target is under \$0\.5000\./);
  assert.match(markdown, /The cost guard stopped the run before a call/);
  rmSync(dir, { recursive: true, force: true });
});

// --- The flow comparison ----------------------------------------------------------------------------------------

const transcript = ({
  calls = [["lookup", { email: "a" }]],
  finish = "stop",
  text = "Done.",
  checks = [["ok", true]],
} = {}) => ({
  events: [
    { kind: "request", model: "model-1", repeated: 0, messages: [], tools: [] },
    {
      kind: "response",
      model: "model-1",
      message: {
        role: "assistant",
        parts: calls.map(([name, input], i) => ({ type: "tool-call", id: `<id-${i + 1}>`, name, input })),
      },
      finish: "tool-calls",
    },
    { kind: "response", model: "model-1", message: { role: "assistant", parts: [{ type: "text", text }] }, finish },
    ...checks.map(([message, pass]) => ({ kind: "check", message, pass })),
  ],
});
const differences = (mock, live) => compareFlows(flowOf(transcript(mock)), flowOf(transcript(live)));

test("live-diff ignores text, argument values and ids", () => {
  assert.deepEqual(differences({}, { text: "Something else entirely." }), []);
  assert.deepEqual(differences({}, { calls: [["lookup", { email: "other@example.com" }]] }), []);
  const parallel = [
    ["b", {}],
    ["a", {}],
  ];
  assert.deepEqual(
    differences(
      {
        calls: [
          ["a", {}],
          ["b", {}],
        ],
      },
      { calls: parallel },
    ),
    [],
  );
});

test("live-diff reports a changed tool call, argument keys, stop reason and check result", () => {
  assert.match(
    differences({}, { calls: [["escalate", { email: "a" }]] })[0],
    /^Tool calls changed: .*`lookup\(email\)`.*`escalate\(email\)`/,
  );
  assert.match(differences({}, { calls: [["lookup", { id: "a" }]] })[0], /`lookup\(id\)`/);
  assert.match(differences({}, { calls: [] })[0], /the live run made no tool calls/);
  assert.match(differences({}, { finish: "length" })[0], /^Stop reason changed: .*`stop`.*`length`/);
  assert.match(
    differences({}, { checks: [["ok", false]] })[0],
    /^Check "ok" failed live; it passes against the mock\./,
  );
  assert.match(differences({}, { checks: [] })[0], /^Check "ok" did not run live\./);
  assert.match(differences({ checks: [] }, {})[0], /ran live \(passed\) but not against the mock/);
});

test("live-diff counts a missing live transcript as a difference and writes Markdown for the issue", () => {
  const results = compareAll(config, { liveDir: mkdtempSync(join(tmpdir(), "live-none-")) });
  assert.ok(results.every((r) => r.differences.length === 1));
  const markdown = diffMarkdown(results, { examples: [{ file: results[0].file, outcome: "not run" }] });
  assert.match(markdown, new RegExp(`^${results.length} of ${results.length} live examples differ`));
  assert.match(markdown, /outcome: not run/);
  assert.match(diffMarkdown([{ ...results[0], differences: [] }]), /^All 1 live examples kept the mock's flow/);
});

test("live-diff exits 0 when the flows differ", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-diff-"));
  const out = execFileSync(
    process.execPath,
    [join(root, "scripts/ci/live-diff.mjs"), "--live-dir", dir, "--json", join(dir, "d.json")],
    {
      encoding: "utf8",
    },
  );
  assert.match(out, /differ in flow/);
  assert.equal(JSON.parse(readFileSync(join(dir, "d.json"), "utf8")).differences, config.examples.length);
  rmSync(dir, { recursive: true, force: true });
});

// --- The workflow's helper steps ---------------------------------------------------------------------------------

const environment = {
  protection_rules: [
    { type: "branch_policy" },
    { type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "owner" } }] },
  ],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
};

test("the pre-run check passes the environment as set up and stops when its protection is gone", () => {
  assert.deepEqual(protectionProblems(environment, "owner"), []);
  assert.match(protectionProblems({ ...environment, protection_rules: [] }, "owner")[0], /owner's review/);
  assert.match(protectionProblems(environment, "someone-else")[0], /someone-else's review/);
  const anyBranch = { ...environment, deployment_branch_policy: null };
  assert.match(protectionProblems(anyBranch, "owner")[0], /only protected branches/);
  assert.equal(protectionProblems({}, "owner").length, 2);
});

test("the date moves only after a complete run", () => {
  assert.deepEqual(dateAfter({ complete: true }, "2026-12-01", { lastCompared: null }), { lastCompared: "2026-12-01" });
  const before = { lastCompared: "2026-11-30" };
  assert.equal(dateAfter({ complete: false }, "2026-12-01", before), before);
  assert.throws(() => dateAfter({ complete: true }, "yesterday", before));
});

test("the results commit may change only listed live transcripts and the date file", () => {
  const live = exampleOf(config.examples[0].file).live;
  const mock = readFileSync(join(root, exampleOf(config.examples[0].file).mock), "utf8");
  const liveText = JSON.stringify({ ...JSON.parse(mock), live: { provider: "anthropic", model: "m" } });
  const read = (texts) => (path) => texts[path];
  assert.deepEqual(changeProblems({ status: "A", path: live }, read({ [live]: liveText }), config), []);
  assert.match(changeProblems({ status: "A", path: live }, read({ [live]: mock }), config)[0], /provider and model/);
  const leaked = liveText.replace('"example"', `"note":"${FAKE_KEYS.ANTHROPIC_API_KEY}","example"`);
  assert.ok(
    changeProblems({ status: "M", path: live }, read({ [live]: leaked }), config).some((p) =>
      /Anthropic API key/.test(p),
    ),
  );
  assert.match(changeProblems({ status: "M", path: "scripts/ci/live-run.mjs" }, read({}), config)[0], /not a listed/);
  const date = read({ [DATE_FILE]: '{"lastCompared":"2026-12-01"}' });
  assert.deepEqual(changeProblems({ status: "M", path: DATE_FILE }, date, config), []);
  const extra = read({ [DATE_FILE]: '{"lastCompared":"2026-12-01","x":1}' });
  assert.equal(changeProblems({ status: "M", path: DATE_FILE }, extra, config).length, 1);
});

// --- The workflow -----------------------------------------------------------------------------------------------

const workflows = readdirSync(join(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));
const workflow = parse(readFileSync(join(root, ".github/workflows/live-run.yml"), "utf8"));

test("live-run.yml runs only when started by hand, from main, in the protected environment", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const inEnvironment = Object.entries(workflow.jobs).filter(([, job]) => job.environment !== undefined);
  assert.equal(inEnvironment.length, 1);
  const [, live] = inEnvironment[0];
  assert.equal(live.environment, "live-run");
  assert.equal(live.if, "github.ref == 'refs/heads/main'");
  assert.deepEqual(live.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (String(step.uses ?? "").startsWith("actions/checkout@"))
        assert.equal(step.with?.["persist-credentials"], false);
    }
  }
});

test("only the step that runs the examples receives a provider key, and no workflow but live-run.yml names one", () => {
  const text = readFileSync(join(root, ".github/workflows/live-run.yml"), "utf8");
  const keyed = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => /secrets\.(ANTHROPIC|OPENAI)_API_KEY/.test(JSON.stringify(step)));
  assert.equal(keyed.length, 1);
  assert.match(keyed[0].run, /scripts\/live\/run\.mjs/);
  assert.deepEqual(Object.keys(keyed[0].env).sort(), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const providerSecrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).filter((n) => /API_KEY/.test(n));
  assert.deepEqual([...new Set(providerSecrets)].sort(), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  for (const file of workflows.filter((f) => f !== "live-run.yml")) {
    const other = readFileSync(join(root, ".github/workflows", file), "utf8");
    assert.ok(!/ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(other), `${file} names a provider key`);
  }
});

test("the date file holds the last comparison's date, or null before the first run", () => {
  const value = JSON.parse(readFileSync(join(root, DATE_FILE), "utf8"));
  assert.deepEqual(Object.keys(value), ["lastCompared"]);
  assert.ok(value.lastCompared === null || /^\d{4}-\d{2}-\d{2}$/.test(value.lastCompared));
});
