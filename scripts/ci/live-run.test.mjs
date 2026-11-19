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
import { guardStream } from "../live/live.ts";
import { findSecret, redact } from "../live/redact.ts";
import { childSpend } from "../live/run.mjs";
import { transcriptProblems, writeTranscript } from "../transcripts/write.mjs";
import { compareAll, compareFlows, diffMarkdown, flowOf } from "./live-diff.mjs";
import {
  artifactProvider,
  changeProblems,
  DATE_FILE,
  dateAfter,
  fenced,
  mergeReports,
  protectionProblems,
} from "./live-run.mjs";
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
  assert.throws(() => liveMode(["node", "x", "--live"], { LIVE: "1", LIVE_API_KEY_FILE: "/k" }), /--only/);
  const mode = liveMode(["node", "x", "--live", "--only", "a"], {
    LIVE: "1",
    LIVE_API_KEY_FILE: "/k",
    LIVE_API_KEY: "k".repeat(10),
    HOME: "/h",
  });
  assert.equal(mode.env.HOME, undefined, "only LIVE_* variables pass on");
  assert.equal(mode.env.LIVE_API_KEY, undefined, "a key in the environment never passes on");
  assert.equal(mode.env.LIVE_API_KEY_FILE, "/k");
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

/**
 * Runs run.mjs with fake keys for `providers`, each in a key file as the workflow writes it, and no key in its
 * environment; resolves with its exit code, everything it printed and whether it deleted the key files.
 */
function runLive(args, providers = ["anthropic", "openai"]) {
  const keys = mkdtempSync(join(tmpdir(), "live-keys-"));
  const files = providers.map((provider) => {
    const file = join(keys, `${provider}.key`);
    writeFileSync(file, FAKE_KEYS[provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"], { mode: 0o600 });
    return [provider, file];
  });
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(root, "scripts/live/run.mjs"), ...files.flatMap(([p, f]) => ["--key-file", `${p}=${f}`]), ...args],
      { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const deleted = files.every(([, file]) => !existsSync(file));
      rmSync(keys, { recursive: true, force: true });
      resolve({ code, out, deleted });
    });
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
  const {
    code,
    out: log,
    deleted,
  } = await runLive([
    ...["--config", writeConfig(dir, config.examples), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`, "--base-url", `openai=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  assert.ok(deleted, "run.mjs deletes each key file once it has read it");
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.ok(results.complete, log);
  for (const example of results.examples) assert.equal(example.outcome, "ran", `${example.file}\n${log}`);
  assert.match(
    readFileSync(join(report, "live-report.md"), "utf8"),
    /^anthropic and openai: spent \$0\.\d{4} of a \$1\.0000 share of the run's \$1\.0000 cap; the run's target is under \$0\.5000\./,
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
  const { code, out: log } = await runLive(
    [
      ...["--config", writeConfig(dir, examples), "--out", out, "--report", report],
      ...["--base-url", `anthropic=${stub.url}`],
    ],
    ["anthropic"],
  );
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

test("with a fixture price table, a provider's job stops before the call that would pass its share of $1.00", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  const examples = config.examples.filter((e) => e.provider === "anthropic").map((e) => ({ ...e, maxTokens: 300 }));
  // Each answer reports 100 input and its whole 300-token allowance as output: about $0.31 at the fixture's rates,
  // under each call's projection, as a real answer is. The list names two providers, so one provider's job has half
  // the $1.00 cap.
  const stub = await startStub(stubScript(examples), { usage: { input: 100, output: 300 } });
  const report = join(dir, "report");
  const { code, out: log } = await runLive(
    [
      ...["--config", writeConfig(dir, [...examples, config.examples.at(-1)]), "--out", join(dir, "out")],
      ...["--report", report, "--catalog", fixtureCatalog(dir), "--base-url", `anthropic=${stub.url}`],
    ],
    ["anthropic"],
  );
  await stub.close();
  assert.equal(code, 0, log);
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.equal(results.cap, 0.5);
  const calls = results.examples.reduce((sum, e) => sum + e.calls, 0);
  assert.equal(stub.requests.length, calls, "every call the stub saw is in the ledger");
  assert.ok(calls >= 1 && calls < 9, `the guard stopped the run part way (${calls} calls)`);
  assert.ok(results.spent <= results.cap, `spent ${results.spent}`);
  assert.ok(results.aborted !== null && results.spent + results.aborted.projected > results.cap);
  assert.equal(results.complete, false);
  assert.equal(results.examples.at(-1).outcome, "not run");
  assert.ok(
    results.examples.every((e) => e.provider === "anthropic"),
    "the job runs only its provider's examples",
  );
  const markdown = readFileSync(join(report, "live-report.md"), "utf8");
  assert.match(
    markdown,
    /^anthropic: spent \$0\.\d{4} of a \$0\.5000 share of the run's \$1\.0000 cap; the run's target is under \$0\.5000\./,
  );
  assert.match(markdown, /The run stopped at `verify\/vercel-ai-sdk/);
  rmSync(dir, { recursive: true, force: true });
});

test("the run reads an example's ledger as a claim, and stops when it can't", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-ledger-"));
  const file = join(dir, "ledger.json");
  assert.match(childSpend(file).aborted.reason, /no readable ledger/);
  writeFileSync(file, JSON.stringify({ ...newLedger(), calls: [{ cost: -5, projected: 1 }] }));
  assert.match(childSpend(file).aborted.reason, /malformed/);
  writeFileSync(
    file,
    JSON.stringify({
      ...newLedger(),
      calls: [
        { cost: 0.25, projected: 0.3 },
        { cost: 0.1, projected: 0.2 },
      ],
    }),
  );
  const claim = childSpend(file);
  assert.ok(close(claim.cost, 0.35));
  assert.equal(claim.aborted, null);
  rmSync(dir, { recursive: true, force: true });
});

test("a streamed answer settles its guard once: at the finish part, or on an error or a cancel", async () => {
  const settled = [];
  // A guard settles once, as beginCall()'s does; later calls are ignored.
  const once = () => {
    let done = false;
    return {
      settle: (usage) => {
        if (done) return;
        done = true;
        settled.push(usage ?? "projection");
      },
    };
  };
  const finishUsage = { uncachedInput: 1, output: 2 };
  const usageOf = (part) => (part.type === "finish" ? finishUsage : undefined);
  const isFinish = (part) => part.type === "finish";
  const parts = (list, fail) =>
    new ReadableStream({
      start(controller) {
        for (const part of list) controller.enqueue(part);
        if (fail) controller.error(new Error("connection reset"));
        else controller.close();
      },
    });
  const read = async (stream) => {
    const out = [];
    for await (const part of stream) out.push(part);
    return out;
  };
  // Read to the end.
  const whole = guardStream(parts([{ type: "text" }, { type: "finish" }]), once(), usageOf, isFinish);
  assert.equal((await read(whole)).length, 2);
  // Fail part way.
  await assert.rejects(read(guardStream(parts([{ type: "text" }], true), once(), usageOf, isFinish)), /reset/);
  // Cancel before the finish part.
  const endless = new ReadableStream({ pull: (controller) => controller.enqueue({ type: "text" }) });
  const cancelled = guardStream(endless, once(), usageOf, isFinish).getReader();
  await cancelled.read();
  await cancelled.cancel("the caller stopped reading");
  // Stop reading after the finish part, without cancelling or reaching the end.
  const afterFinish = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "finish" });
    },
    pull: (controller) => controller.enqueue({ type: "text" }),
  });
  const stopped = guardStream(afterFinish, once(), usageOf, isFinish).getReader();
  assert.equal((await stopped.read()).value.type, "finish");
  assert.deepEqual(settled, [finishUsage, "projection", "projection", finishUsage]);
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
  can_admins_bypass: false,
};

test("the pre-run check passes the environment as set up and stops when its protection is gone", () => {
  assert.deepEqual(protectionProblems(environment, ["main"], "owner"), []);
  assert.match(protectionProblems({ ...environment, protection_rules: [] }, ["main"], "owner")[0], /owner's review/);
  assert.match(protectionProblems(environment, ["main"], "someone-else")[0], /someone-else's review/);
  const anyBranch = { ...environment, deployment_branch_policy: null };
  assert.match(protectionProblems(anyBranch, ["main"], "owner")[0], /only protected branches/);
  const bypass = { ...environment, can_admins_bypass: true };
  assert.match(protectionProblems(bypass, ["main"], "owner")[0], /administrators can bypass/);
  assert.match(
    protectionProblems(environment, ["main", "release"], "owner")[0],
    /other than main are protected, so they could deploy: release/,
  );
  assert.match(protectionProblems(environment, [], "owner")[0], /main is not a protected branch/);
  assert.equal(protectionProblems({}, [], "owner").length, 4);
});

const reportOf = (providers, complete) => ({ providers, runCap: 1, target: 0.5, spent: 0.1, complete, examples: [] });
const entry = (dir, report) => ({ provider: artifactProvider(dir), report });

test("the date moves to the report job's own date only after every provider's own job completed", () => {
  const before = { lastCompared: "2026-11-30" };
  const both = mergeReports([
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true)),
    entry("/tmp/live/live-openai", reportOf(["openai"], true)),
  ]);
  assert.ok(close(both.spent, 0.2));
  assert.deepEqual(both.completed, ["anthropic", "openai"]);
  assert.deepEqual(dateAfter(both, "2026-12-01", before, config), { lastCompared: "2026-12-01" });
  const one = mergeReports([entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true))]);
  assert.equal(dateAfter(one, "2026-12-01", before, config), before, "the OpenAI job left no artifact");
  const partial = mergeReports([
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true)),
    entry("/tmp/live/live-openai", reportOf(["openai"], false)),
  ]);
  assert.equal(dateAfter(partial, "2026-12-01", before, config), before);
  assert.throws(() => dateAfter(both, "yesterday", before, config));
});

test("a provider's job can't claim another provider's completion or examples", () => {
  const before = { lastCompared: "2026-11-30" };
  const other = { file: "verify/vercel-ai-sdk/examples/09-triage-agent.ts", provider: "anthropic", outcome: "ran" };
  // A compromised OpenAI job claims both providers ran, with an Anthropic example, and the Anthropic job failed.
  const forged = { ...reportOf(["anthropic", "openai"], true), examples: [other] };
  const merged = mergeReports([
    entry("/tmp/live/live-openai", forged),
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], false)),
  ]);
  assert.deepEqual(merged.providers, ["openai", "anthropic"]);
  assert.deepEqual(merged.completed, ["openai"]);
  assert.deepEqual(merged.examples, [], "the OpenAI job's report may list only OpenAI examples");
  assert.equal(dateAfter(merged, "2026-12-01", before, config), before);
  // An artifact without the Anthropic job's own directory counts for nothing, whatever it claims.
  const alone = mergeReports([entry("/tmp/live/live-openai", forged), entry("/tmp/live/live-other", forged)]);
  assert.deepEqual(alone.providers, ["openai"]);
  assert.equal(dateAfter(alone, "2026-12-01", before, config), before);
  assert.equal(artifactProvider("/tmp/live/live-anthropic-extra"), undefined, "the directory name must be exact");
});

test("the results commit may change only listed live transcripts and the date file", () => {
  const live = exampleOf(config.examples[0].file).live;
  const mock = readFileSync(join(root, exampleOf(config.examples[0].file).mock), "utf8");
  const liveText = JSON.stringify({ ...JSON.parse(mock), live: { provider: "anthropic", model: "m" } });
  const read = (texts) => (path) => texts[path];
  const day = "2026-12-01";
  assert.deepEqual(changeProblems({ status: "A", path: live }, read({ [live]: liveText }), config, day), []);
  assert.match(
    changeProblems({ status: "A", path: live }, read({ [live]: mock }), config, day)[0],
    /provider and model/,
  );
  const leaked = liveText.replace('"example"', `"note":"${FAKE_KEYS.ANTHROPIC_API_KEY}","example"`);
  assert.ok(
    changeProblems({ status: "M", path: live }, read({ [live]: leaked }), config, day).some((p) =>
      /Anthropic API key/.test(p),
    ),
  );
  assert.match(
    changeProblems({ status: "M", path: "scripts/ci/live-run.mjs" }, read({}), config, day)[0],
    /not a listed/,
  );
  const date = read({ [DATE_FILE]: '{"lastCompared":"2026-12-01"}' });
  assert.deepEqual(changeProblems({ status: "M", path: DATE_FILE }, date, config, day), []);
  // A live job can't move the date: only the report job's own date passes.
  assert.match(
    changeProblems({ status: "M", path: DATE_FILE }, date, config, "2026-12-02")[0],
    /the run's date, 2026-12-02/,
  );
  const extra = read({ [DATE_FILE]: '{"lastCompared":"2026-12-01","x":1}' });
  assert.equal(changeProblems({ status: "M", path: DATE_FILE }, extra, config, day).length, 1);
});

test("text a live job wrote goes into an issue only inside a code block it can't close, with mentions broken", () => {
  const hostile = "Ping @laudebugs\n```\n## Injected heading\n````\n[click](https://example.com) @team-x\n";
  const block = fenced(hostile);
  const lines = block.trimEnd().split("\n");
  const fence = lines[0].replace(/text$/, "");
  assert.equal(fence, "`````", "one backtick longer than the longest run in the text");
  assert.equal(lines.at(-1), fence);
  for (const line of lines.slice(1, -1)) assert.ok(!line.startsWith(fence), `${line} closes the block`);
  assert.ok(!/@[A-Za-z0-9_-]/.test(block), "no @ stays right before a name");
  assert.match(fenced("plain"), /^```text\nplain\n```\n$/);
});

test("a transcript may name tools and argument keys only with [A-Za-z0-9_.-]", () => {
  const base = JSON.parse(readFileSync(join(root, exampleOf(config.examples[0].file).mock), "utf8"));
  const withCall = (name, input) => {
    const copy = structuredClone(base);
    const response = copy.events.find((event) => event.kind === "response");
    response.message.parts = [{ type: "tool-call", id: "<id-1>", name, input }];
    return transcriptProblems(copy);
  };
  assert.deepEqual(withCall("lookup_customer", { email: "a" }), []);
  assert.ok(withCall("x](https://evil.example)", {}).some((p) => /names a tool outside/.test(p)));
  assert.ok(withCall("@owner", {}).some((p) => /names a tool outside/.test(p)));
  assert.ok(withCall("lookup", { "`a`\n## b": 1 }).some((p) => /argument key outside/.test(p)));
});

// --- The workflow -----------------------------------------------------------------------------------------------

const workflows = readdirSync(join(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));
const workflow = parse(readFileSync(join(root, ".github/workflows/live-run.yml"), "utf8"));

const keyed = (job) => JSON.stringify(job).match(/secrets\.(ANTHROPIC|OPENAI)_API_KEY/g) ?? [];

test("live-run.yml runs only when started by hand, one key-holding job per provider, from main, in live-run", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const inEnvironment = Object.entries(workflow.jobs).filter(([, job]) => job.environment !== undefined);
  assert.deepEqual(inEnvironment.map(([name]) => name).sort(), ["live-anthropic", "live-openai"]);
  for (const [name, job] of inEnvironment) {
    assert.equal(job.environment, "live-run");
    assert.equal(job.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(job.permissions, { contents: "read", actions: "read" });
    const own = name === "live-anthropic" ? "secrets.ANTHROPIC_API_KEY" : "secrets.OPENAI_API_KEY";
    assert.deepEqual(keyed(job), [own], `${name} names only its own key`);
    assert.match(JSON.stringify(job), /live-run\.mjs protected/);
  }
  const report = workflow.jobs.report;
  assert.equal(report.environment, undefined);
  assert.deepEqual(report.permissions, { contents: "read", issues: "write" });
  assert.deepEqual(keyed(report), []);
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (String(step.uses ?? "").startsWith("actions/checkout@"))
        assert.equal(step.with?.["persist-credentials"], false);
    }
  }
});

test("a key reaches only the step that writes it to a private file, and run.mjs reads it from there", () => {
  for (const name of ["live-anthropic", "live-openai"]) {
    const steps = workflow.jobs[name].steps;
    const withKey = steps.filter((step) => keyed(step).length > 0);
    assert.equal(withKey.length, 1);
    assert.match(withKey[0].run, /umask 077/);
    assert.doesNotMatch(withKey[0].run, /run\.mjs/);
    const run = steps.find((step) => /scripts\/live\/run\.mjs/.test(step.run ?? ""));
    assert.match(run.run, /--key-file/);
    assert.equal(run.env, undefined, "the run step has no key in its environment");
  }
  const text = readFileSync(join(root, ".github/workflows/live-run.yml"), "utf8");
  const providerSecrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).filter((n) => /API_KEY/.test(n));
  assert.deepEqual([...new Set(providerSecrets)].sort(), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  for (const file of workflows.filter((f) => f !== "live-run.yml")) {
    const other = readFileSync(join(root, ".github/workflows", file), "utf8");
    assert.ok(!/ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(other), `${file} names a provider key`);
  }
});

test("the report job puts the live jobs' text into the issue and pull request only through fence", () => {
  for (const step of workflow.jobs.report.steps.filter((s) => /issue\.md|body\.md/.test(s.run ?? ""))) {
    assert.doesNotMatch(step.run, /cat "\$RUNNER_TEMP\/(diff\.md|live)/, step.name);
    assert.match(step.run, /live-run\.mjs fence/);
  }
});

test("the date file holds the last comparison's date, or null before the first run", () => {
  const value = JSON.parse(readFileSync(join(root, DATE_FILE), "utf8"));
  assert.deepEqual(Object.keys(value), ["lastCompared"]);
  assert.ok(value.lastCompared === null || /^\d{4}-\d{2}-\d{2}$/.test(value.lastCompared));
});
