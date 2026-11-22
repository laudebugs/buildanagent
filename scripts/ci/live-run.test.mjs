// Offline tests for the live run: the cost guard (scripts/live/budget.ts), the example list (config.mjs), redaction,
// the live transcript writer, the runner (run.mjs) against a stub server on the loopback interface, the proxy that
// the Claude Agent SDK's and Copilot SDK's live mode sends their CLI's calls through (proxy.mjs), the flow
// comparison (live-diff.mjs), the workflow's helper steps (live-run.mjs) and the workflow itself. Run with
// `node --test scripts/ci/*.test.mjs`. No test reaches a provider: every request goes to live-stub.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { liveTool as claudeLiveTool } from "../../verify/claude-agent-sdk/scripts/live-tools.mjs";
import { liveTool as copilotLiveTool } from "../../verify/copilot-sdk/scripts/live-tools.mjs";
import { BUILTIN_DENY } from "../../verify/copilot-sdk/scripts/mock-model.mjs";
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
import { guardStream, HOST_TOOL_NAMES } from "../live/live.ts";
import { exampleEnv, loopbackNamespace, PLACEHOLDER_KEY, prepareBody, requestProblem } from "../live/proxy.mjs";
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
  inIndex,
  mergeReports,
  patchProblems,
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

/** Our SDK's triage agent's system prompt, which tells its requests apart from Pi's, whose tools have the same names. */
const SDK_TRIAGE_SYSTEM = "Escalate only what an engineer must see.";

/**
 * Which listed example a request comes from, by the API it reaches and the tools it offers, and that example's mock
 * answers. Our gateway's OpenAI adapter speaks Chat Completions, which no verify harness does.
 */
function stubScript(examples) {
  const turns = new Map(
    examples.map((e) => [
      e.file,
      turnsFromTranscript(JSON.parse(readFileSync(join(root, exampleOf(e.file).mock), "utf8"))),
    ]),
  );
  const counts = new Map();
  const exampleFor = (api, body) => {
    const names = (body.tools ?? []).map((tool) => tool.name);
    const find = (part) => examples.find((e) => e.file.includes(part))?.file;
    if (api === "openai-chat") return find("packages/sdk/");
    if (api === "anthropic") {
      if (JSON.stringify(body.system ?? "").includes(SDK_TRIAGE_SYSTEM)) return find("packages/sdk/");
      if (names.includes("lookupOrder")) return find("vercel-ai-sdk");
      if (names.includes("Triage")) return find("langchain");
      if (names.includes("submit_triage")) return find("verify/pi/");
    } else {
      return names.includes("lookup_customer") ? find("openai-agents-sdk") : find("cloudflare-agents");
    }
    return undefined;
  };
  // One file may be listed on both providers, so each provider's run of it plays the mock's turns from the start.
  return (api, body) => {
    const file = exampleFor(api, body);
    const key = `${api === "anthropic" ? "anthropic" : "openai"} ${file}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
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
      const allowance =
        request.provider === "openai-chat" ? request.body.max_completion_tokens : request.body.max_output_tokens;
      assert.ok(allowance <= 2048, `${request.provider} allows ${allowance}`);
    }
    const names = (request.body.tools ?? []).map((tool) => tool.name ?? tool.function?.name);
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

test("a streamed answer settles its guard once: at the finish part, or at the projection on any other ending", async () => {
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
  // End cleanly without a finish part, after a part that reported partial usage, as an Anthropic body that stops after
  // message_start does: the partial usage is not what the call is billed, so the call counts at its projection.
  const partialUsage = { uncachedInput: 1, output: 1 };
  const anyUsage = (part) => part.usage;
  assert.equal(
    (await read(guardStream(parts([{ type: "start", usage: partialUsage }]), once(), anyUsage, isFinish))).length,
    1,
  );
  assert.deepEqual(settled, [finishUsage, "projection", "projection", finishUsage, "projection"]);
});

// --- Our SDK's live mode ----------------------------------------------------------------------------------------

const SDK_TRIAGE = "packages/sdk/examples/13-triage-agent.ts";
const sdkEntries = () => config.examples.filter((example) => example.file === SDK_TRIAGE);
const TSX = import.meta.resolve("tsx");
const SOURCE_CONDITION = join(root, "scripts/transcripts/source-condition.mjs");
/** A file of the repository as a quoted file URL, for a child script's import. */
const fileURL = (path) => JSON.stringify(pathToFileURL(join(root, path)).href);

test("the list runs our SDK's triage agent on both providers, each with its own live transcript", () => {
  assert.deepEqual(
    sdkEntries()
      .map((example) => example.provider)
      .sort(),
    ["anthropic", "openai"],
  );
  const [first, second] = sdkEntries();
  assert.notEqual(exampleOf(first.file, first.provider).live, exampleOf(second.file, second.provider).live);
  assert.equal(exampleOf(SDK_TRIAGE, "openai").live, "packages/sdk/results/live/openai/13-triage-agent.json");
  assert.equal(exampleOf(SDK_TRIAGE).mock, "packages/sdk/results/transcripts/13-triage-agent.json");
  // Without a provider no run writes a live transcript, so none is named, not one in an "undefined" folder.
  assert.equal("live" in exampleOf(SDK_TRIAGE), false);
  const twice = { ...config, examples: [first, { ...first }] };
  assert.ok(liveConfigProblems(twice).some((p) => p.includes(`${SDK_TRIAGE} is listed twice on ${first.provider}`)));
  const stray = { ...config, projection: { ...config.projection, examples: { ...config.projection.examples, x: 1 } } };
  assert.ok(liveConfigProblems(stray).some((p) => /"x"\] names no entry/.test(p)));
});

test("our SDK's triage agent runs live through our gateway's two adapters and keeps the mock's flow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-sdk-"));
  const entries = sdkEntries();
  const stub = await startStub(stubScript(entries));
  const out = join(dir, "out");
  const report = join(dir, "report");
  const {
    code,
    out: log,
    deleted,
  } = await runLive([
    ...["--config", writeConfig(dir, entries), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`, "--base-url", `openai=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  assert.ok(deleted, "run.mjs deletes each key file once it has read it");
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.ok(results.complete, log);
  for (const example of results.examples) {
    assert.equal(example.outcome, "ran", `${example.provider}\n${log}`);
    assert.equal(example.calls, 3, "the ledger holds each of the three calls");
    // Our gateway's adapters cancel the body at message_stop or [DONE]; each call is still priced from the usage the
    // stub streamed, 120 input and 30 output tokens, not at its projection.
    const model = catalog.models.find((m) => m.provider === example.provider && m.id === example.model);
    const streamed = priceUsage({ uncachedInput: 120, cacheRead: 0, cacheWrite: 0, output: 30 }, model);
    assert.ok(close(example.spent, 3 * streamed), `${example.provider} spent ${example.spent}, not ${3 * streamed}`);
    assert.deepEqual(example.checks, { passed: 6, total: 6 });
    assert.equal(example.transcript, `packages/sdk/${example.provider}/13-triage-agent.json`);
  }
  for (const result of compareAll({ ...config, examples: entries }, { liveDir: out })) {
    assert.deepEqual(result.differences, [], result.provider);
  }
  for (const provider of ["anthropic", "openai"]) {
    const transcript = JSON.parse(readFileSync(join(out, "packages/sdk", provider, "13-triage-agent.json"), "utf8"));
    assert.deepEqual(transcriptProblems(transcript), []);
    assert.equal(transcript.harness, "packages/sdk");
    assert.equal(transcript.live.provider, provider);
    // The usage the stub streamed reached the transcript through our gateway.
    const usage = transcript.events.find((event) => event.kind === "response").usage;
    assert.equal(usage.output, 30);
  }
  // Each provider's key reached only its own API, through our adapters' own endpoints, with the run's allowance.
  const byApi = Object.groupBy(stub.requests, (request) => request.provider);
  assert.equal(byApi.anthropic.length, 3);
  assert.equal(byApi["openai-chat"].length, 3);
  for (const request of byApi.anthropic) {
    assert.equal(request.headers["x-api-key"], FAKE_KEYS.ANTHROPIC_API_KEY);
    assert.equal(request.headers.authorization, undefined);
    assert.ok(request.body.max_tokens <= 1024);
    assert.equal(request.body.model, "claude-haiku-5-5");
  }
  for (const request of byApi["openai-chat"]) {
    assert.equal(request.headers.authorization, `Bearer ${FAKE_KEYS.OPENAI_API_KEY}`);
    assert.equal(request.headers["x-api-key"], undefined);
    assert.ok(request.body.max_completion_tokens <= 2048);
    assert.equal(request.body.model, "gpt-5.4-mini");
  }
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, "utf8");
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${file} holds a secret`);
  }
  for (const secret of SECRETS) assert.ok(!log.includes(secret), "the log holds a secret");
  rmSync(dir, { recursive: true, force: true });
});

test("a call our gateway retries after a 429 counts once in our SDK's checks and transcript, and the guard charges both attempts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-sdk-retry-"));
  const entries = sdkEntries();
  // Each API refuses its first request as a rate-limited provider does; the gateway waits and sends it again.
  const refusals = {
    anthropic: { type: "error", error: { type: "rate_limit_error", message: "rate limited" } },
    "openai-chat": { error: { type: "rate_limit_exceeded", message: "rate limited" } },
  };
  const stub = await startStub(stubScript(entries), {
    refuse: (api, n) =>
      n === 0 ? { status: 429, body: refusals[api], headers: { "retry-after-ms": "0" } } : undefined,
  });
  const out = join(dir, "out");
  const report = join(dir, "report");
  const { code, out: log } = await runLive([
    ...["--config", writeConfig(dir, entries), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`, "--base-url", `openai=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.ok(results.complete, log);
  for (const example of results.examples) {
    assert.equal(example.outcome, "ran", `${example.provider}\n${log}`);
    // The example's own check that it made exactly three calls passes: the retried attempt is not a call of the run.
    assert.deepEqual(example.checks, { passed: 6, total: 6 }, `${example.provider}\n${log}`);
    // The guard charged the refused attempt too, at its projection, beside the three answered calls' streamed usage.
    assert.equal(example.calls, 4, "the ledger holds the refused attempt and the three calls");
    const model = catalog.models.find((m) => m.provider === example.provider && m.id === example.model);
    const streamed = priceUsage({ uncachedInput: 120, cacheRead: 0, cacheWrite: 0, output: 30 }, model);
    assert.ok(example.spent > 3 * streamed, `${example.provider} spent ${example.spent}, no more than 3 answers`);
  }
  for (const result of compareAll({ ...config, examples: entries }, { liveDir: out })) {
    assert.deepEqual(result.differences, [], result.provider);
  }
  for (const provider of ["anthropic", "openai"]) {
    const transcript = JSON.parse(readFileSync(join(out, "packages/sdk", provider, "13-triage-agent.json"), "utf8"));
    assert.deepEqual(transcriptProblems(transcript), []);
    const kinds = transcript.events
      .map((event) => event.kind)
      .filter((kind) => kind === "request" || kind === "response");
    assert.deepEqual(kinds, ["request", "response", "request", "response", "request", "response"], provider);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("our SDK's runner runs only under run.mjs, with --live and one example", () => {
  const runner = join(root, "packages/sdk/scripts/run-examples.mjs");
  const run = (args, env = {}) => {
    try {
      execFileSync(process.execPath, [runner, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: "pipe" });
      return { code: 0, text: "" };
    } catch (error) {
      return { code: error.status, text: `${error.stdout}${error.stderr}` };
    }
  };
  const offline = run(["examples", "--only", "13-triage-agent"]);
  assert.equal(offline.code, 2);
  assert.match(offline.text, /only scripts\/live\/run\.mjs runs this/);
  assert.match(run(["examples", "--only", "13-triage-agent", "--live"]).text, /only under scripts\/live\/run\.mjs/);
  const settings = { LIVE: "1", LIVE_API_KEY_FILE: join(tmpdir(), "no-such-key-file") };
  assert.match(run(["examples", "--live"], settings).text, /--live needs --only/);
  const unknown = run(["examples", "--only", "../../etc/passwd", "--live"], settings);
  assert.equal(unknown.code, 2);
  assert.match(unknown.text, /is not one of the book's examples/);
});

test("our SDK's runner deletes an earlier live transcript and its raw events when the example times out", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-sdk-timeout-"));
  const temp = join(dir, "tmp");
  const outDir = join(dir, "out");
  mkdirSync(temp);
  mkdirSync(outDir);
  const stale = join(outDir, "13-triage-agent.json");
  writeFileSync(stale, "{}\n");
  const keyFile = join(dir, "key");
  writeFileSync(keyFile, FAKE_KEYS.ANTHROPIC_API_KEY, { mode: 0o600 });
  // A 1 ms timeout kills the example before it can send anything.
  const env = {
    PATH: process.env.PATH,
    TMPDIR: temp,
    EXAMPLE_TIMEOUT_MS: "1",
    LIVE: "1",
    LIVE_PROVIDER: "anthropic",
    LIVE_MODEL: "claude-haiku-5-5",
    LIVE_API_KEY_FILE: keyFile,
    LIVE_OUT_DIR: outDir,
  };
  let text = "";
  let code = 0;
  try {
    text = execFileSync(
      process.execPath,
      [join(root, "packages/sdk/scripts/run-examples.mjs"), "examples", "--only", "13-triage-agent", "--live"],
      { env, stdio: "pipe" },
    ).toString();
  } catch (error) {
    code = error.status;
    text = `${error.stdout}${error.stderr}`;
  }
  assert.equal(code, 1, text);
  assert.match(text, /^timeout\s+13-triage-agent/m);
  assert.ok(!existsSync(stale), "the earlier run's transcript is deleted, so run.mjs can't report it");
  assert.deepEqual(readdirSync(temp), [], "the raw events and the runner's temporary folders are deleted");
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs `script` with tsx, on our packages' src/, in a child whose environment is a live run's of our SDK's triage
 * agent, with a dummy key file and a fresh ledger; resolves with its exit code, its output and whether the key file
 * is left. `env` adds to or, with undefined, takes away from that environment.
 */
function sdkChild(script, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "live-sdk-child-"));
  const keyFile = join(dir, "key");
  writeFileSync(keyFile, FAKE_KEYS.ANTHROPIC_API_KEY, { mode: 0o600 });
  const ledger = join(dir, "ledger.json");
  writeLedger(ledger, newLedger());
  const file = join(dir, "child.mts");
  writeFileSync(file, script);
  const base = {
    PATH: process.env.PATH,
    HOME: dir,
    LIVE: "1",
    LIVE_PROVIDER: "anthropic",
    LIVE_MODEL: "claude-haiku-5-5",
    LIVE_MAX_TOKENS: "1024",
    LIVE_LEDGER: ledger,
    LIVE_EXAMPLE: SDK_TRIAGE,
    LIVE_API_KEY_FILE: keyFile,
  };
  const childEnv = Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, value]) => value !== undefined));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", TSX, "--import", SOURCE_CONDITION, file], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const keyLeft = existsSync(keyFile);
      const spent = readLedger(ledger);
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, keyLeft, ledger: spent });
    });
  });
}

test("in our SDK's live mode the offline setup still guards every fetch but the live transport's", async () => {
  const { code, out, keyLeft } =
    await sdkChild(`import { modelRequestsAreAllowed } from ${fileURL("packages/gateway/src/index.ts")};
import { scripted } from ${fileURL("packages/sdk/examples/lib/check.ts")};
const before = modelRequestsAreAllowed();
const outside = await fetch("https://api.anthropic.com/v1/messages").then(() => "sent", (error) => error.message);
const { adapter } = scripted([]);
console.log(JSON.stringify({ before, after: modelRequestsAreAllowed(), outside, calls: adapter.calls.length }));
`);
  assert.equal(code, 0, out);
  assert.ok(!keyLeft, "the live mode deletes the key file once it has read it");
  const result = JSON.parse(out.trim().split("\n").at(-1));
  assert.equal(result.before, false, "real model requests stay off until the live model is built");
  assert.equal(result.after, true);
  assert.match(result.outside, /Blocked outbound request to api\.anthropic\.com/);
  assert.equal(result.calls, 0);
  // A provider key variable still stops the example before it runs, live or not.
  const keyed = await sdkChild(`import ${fileURL("packages/sdk/examples/lib/check.ts")};\nconsole.log("ran");\n`, {
    ANTHROPIC_API_KEY: FAKE_KEYS.ANTHROPIC_API_KEY,
  });
  assert.notEqual(keyed.code, 0);
  assert.match(keyed.out, /Refusing to run tests with provider credentials set \(ANTHROPIC_API_KEY\)/);
  assert.ok(!keyed.out.includes(FAKE_KEYS.ANTHROPIC_API_KEY));
});

test("our SDK's live transport refuses before sending, guards each call and passes on no provider header", async () => {
  const { code, out, ledger } =
    await sdkChild(`import { readLedger, writeLedger } from ${fileURL("scripts/live/budget.ts")};
import { liveTransport, requestProblem, usageReader } from ${fileURL("packages/sdk/examples/lib/live.mjs")};
const ledger = process.env.LIVE_LEDGER;
const config = { provider: "anthropic", model: "claude-haiku-5-5", maxTokens: 1024, apiKey: "k", baseURL: undefined,
  example: "${SDK_TRIAGE}", ledger, catalog: undefined };
const sent = [];
const sse = (events) => events.map((e) => "event: " + e.type + "\\ndata: " + JSON.stringify(e) + "\\n\\n").join("");
let answer = () => new Response(sse([
  { type: "message_start", message: { usage: { input_tokens: 40, cache_read_input_tokens: 10, output_tokens: 1 } } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
]), { headers: { "content-type": "text/event-stream", "request-id": "req_0123456789abcdef" } });
const send = async (url, init) => { sent.push(url); return answer(); };
const transport = liveTransport(config, send);
const post = (body, url = "https://api.anthropic.com/v1/messages") =>
  transport(new Request(url, { method: "POST", body: JSON.stringify(body) })).then(
    async (response) => ({ status: response.status, headers: [...response.headers.keys()], text: await response.text() }),
    (error) => error.message,
  );
// Reads the answer as our gateway's adapters do: up to the event that until names, then cancels the body.
const readUntil = (body, until) =>
  transport(new Request("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify(body) })).then(
    async (response) => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes(until)) {
        const { done, value } = await reader.read();
        if (done) return "ended";
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
      return "cancelled";
    },
  );
const ok = { model: "claude-haiku-5-5", max_tokens: 1024, messages: [], tools: [{ name: "lookup_customer" }] };
const results = {
  elsewhere: await post(ok, "https://example.com/v1/messages"),
  host: await post({ ...ok, tools: [{ name: "bash" }] }),
  typed: await post({ ...ok, tools: [{ name: "x", type: "computer_20250124" }] }),
  model: await post({ ...ok, model: "claude-opus-5-5" }),
  allowance: await post({ ...ok, max_tokens: 4096 }),
  // Fields an extraBody could add that reach past the model or multiply the output, and one the adapter never sends.
  mcp: await post({ ...ok, mcp_servers: [{ type: "url", url: "https://example.com/mcp", name: "x" }] }),
  container: await post({ ...ok, container: "container_1" }),
  unknown: await post({ ...ok, metadata: { user_id: "u" } }),
  sentBefore: sent.length,
  ok: await post(ok),
  afterFinal: await readUntil(ok, "message_stop"),
};
// A body cancelled after message_start, before the final usage and message_stop, streams more than it reported.
const started = sse([{ type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } }]);
answer = () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode(started)); },
  pull: () => new Promise(() => {}),
}), { headers: { "content-type": "text/event-stream" } });
results.beforeFinal = await readUntil(ok, "message_start");
answer = () => new Response("overloaded", { status: 529, headers: {
  "retry-after": "7", "retry-after-ms": "7000", "request-id": "req_0123456789abcdef",
  "anthropic-organization-id": "0d4b5ad1-3f0e-4c0a-9b1e-5f4e3d2c1b0a",
} });
results.failed = await post(ok);
answer = () => new Response("rate limited", { status: 429, headers: {
  "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT", "retry-after-ms": "soon",
} });
results.limited = await post(ok);
// A body that ends cleanly after message_start, with no message_delta or message_stop, reported only partial usage.
answer = () => new Response(started, { headers: { "content-type": "text/event-stream" } });
results.endedEarly = await post(ok);
// The same endings on OpenAI: a finished answer is priced from its usage chunk; one that ends before it, or ends with
// [DONE] but no usage, at its projection.
const openai = liveTransport({ ...config, provider: "openai", model: "gpt-5.4-mini", maxTokens: 2048 }, send);
const chat = { model: "gpt-5.4-mini", max_completion_tokens: 2048, messages: [], stream: true };
const postOpenAI = () =>
  openai(new Request("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify(chat) })).then(
    async (response) => ({ status: response.status, text: await response.text() }),
  );
const data = (lines) => lines.map((line) => "data: " + line + "\\n\\n").join("");
const text = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
const usageChunk = JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } });
for (const [name, lines] of [["openaiDone", [text, usageChunk, "[DONE]"]], ["openaiEarly", [text]], ["openaiNoUsage", [text, "[DONE]"]]]) {
  answer = () => new Response(data(lines), { headers: { "content-type": "text/event-stream" } });
  results[name] = await postOpenAI();
}
const chatConfig = { ...config, provider: "openai", model: "gpt-5.4-mini", maxTokens: 2048 };
results.chatFields = {
  adapter: requestProblem(chatConfig, { ...chat, stream_options: { include_usage: true }, prompt_cache_options: { mode: "explicit" } }) ?? null,
  one: requestProblem(chatConfig, { ...chat, n: 1 }) ?? null,
  several: requestProblem(chatConfig, { ...chat, n: 2 }),
  audio: requestProblem(chatConfig, { ...chat, modalities: ["text", "audio"] }),
};
const now = readLedger(ledger);
writeLedger(ledger, { ...now, cap: now.spent + 0.0001 });
results.overCap = await post(ok);
results.sent = sent.length;
const read = usageReader("openai");
const chunk = (text) => new TextEncoder().encode(text);
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":20}}}';
results.split = [read.usageOf(chunk(usage.slice(0, 30)))];
results.finishedEarly = read.isFinish();
results.split.push(read.usageOf(chunk(usage.slice(30) + "\\n\\n")));
results.finishedAtUsage = read.isFinish();
const done = usageReader("openai");
done.usageOf(chunk('data: {"choices":[{"delta":{"content":"hi"}}]}\\n\\n'));
results.finishedAtText = done.isFinish();
done.usageOf(chunk("data: [DONE]\\n\\n"));
results.finishedAtDone = done.isFinish();
console.log(JSON.stringify(results));
`);
  assert.equal(code, 0, out);
  const r = JSON.parse(out.trim().split("\n").at(-1));
  assert.match(r.elsewhere, /sends only to https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(r.host, /the host tool "bash"/);
  assert.match(r.typed, /of type "computer_20250124", not an in-process function/);
  assert.match(r.model, /names the model "claude-opus-5-5"/);
  assert.match(r.allowance, /allows 4096 output tokens, not at most the run's 1024/);
  assert.match(r.mcp, /carries "mcp_servers", which the live mode doesn't send/);
  assert.match(r.container, /carries "container"/);
  assert.match(r.unknown, /carries "metadata"/);
  assert.deepEqual(r.chatFields.adapter, null, "the fields our OpenAI adapter sends pass");
  assert.equal(r.chatFields.one, null);
  assert.match(r.chatFields.several, /asks for 2 answers, not one/);
  assert.match(r.chatFields.audio, /carries "modalities"/);
  assert.equal(r.sentBefore, 0, "nothing refused reached the provider");
  assert.equal(r.ok.status, 200);
  assert.deepEqual(r.ok.headers, ["content-type"], "the provider's headers stay behind");
  assert.equal(r.afterFinal, "cancelled");
  assert.equal(r.beforeFinal, "cancelled");
  assert.equal(r.failed.status, 529);
  // A failed answer passes on its numeric retry delays, so the gateway waits as asked, and no other header.
  assert.deepEqual(r.failed.headers.sort(), ["content-type", "retry-after", "retry-after-ms"]);
  assert.equal(r.limited.status, 429);
  assert.deepEqual(r.limited.headers, ["content-type"], "a delay that is not a plain number stays behind");
  assert.match(r.overCap, /would pass the \$\d\.\d{4} cap/);
  assert.equal(r.endedEarly.status, 200);
  assert.equal(r.openaiDone.status, 200);
  assert.equal(r.sent, 9, "the call past the cap was refused before it was sent");
  // JSON writes the first, unfinished event's missing usage as null.
  assert.deepEqual(r.split, [null, { uncachedInput: 30, cacheRead: 20, output: 7 }]);
  assert.equal(r.finishedEarly, false);
  assert.equal(r.finishedAtUsage, true, "OpenAI's usage chunk carries the whole usage");
  assert.equal(r.finishedAtText, false);
  assert.equal(r.finishedAtDone, true);
  // An answer read to its end, or cancelled after its final event as the gateway's adapters cancel it, is priced from
  // its streamed usage. One cancelled before its final event, one that ends without it and the failed ones, at the
  // projection, as they may be billed. On OpenAI only the answer whose usage chunk arrived is priced from its usage.
  assert.deepEqual(
    ledger.calls.map((call) => call.basis),
    ["usage", "usage", "projection", "projection", "projection", "projection", "usage", "projection", "projection"],
  );
  const haiku = catalog.models.find((m) => m.provider === "anthropic" && m.id === "claude-haiku-5-5");
  for (const call of ledger.calls.slice(0, 2)) {
    assert.ok(close(call.cost, priceUsage({ uncachedInput: 40, cacheRead: 10, output: 20 }, haiku)));
  }
  assert.ok(close(ledger.calls[2].cost, ledger.calls[2].projected));
  assert.ok(
    close(ledger.calls[5].cost, ledger.calls[5].projected),
    "a body that ends after message_start costs its projection",
  );
  assert.ok(ledger.aborted !== null);
});

// --- The proxied live mode of the Claude Agent SDK and Copilot SDK ----------------------------------------------

/** The examples the book lists from the two harnesses whose CLI or runtime makes the model calls. */
const PROXIED = [
  { file: "verify/claude-agent-sdk/examples/02-custom-tool.ts", provider: "anthropic" },
  { file: "verify/copilot-sdk/examples/05-streaming.ts", provider: "openai" },
].map((e) => ({
  ...e,
  model: e.provider === "anthropic" ? "claude-haiku-5-5" : "gpt-5.4-mini",
  maxTokens: 1024,
  calls: 4,
}));

/** Every model request a proxied example's mock or live run logged, to look for a key in it. */
const harnessLog = (file) => join(root, exampleOf(file).harness, ".tmp/logs", `${exampleOf(file).id}.jsonl`);

test("the Claude Agent SDK and Copilot SDK run a listed example live through the proxy, keeping the mock's flow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-run-"));
  // One example on each provider: Claude's on Anthropic, Copilot's on OpenAI through BYOK.
  const turns = Object.fromEntries(
    PROXIED.map((e) => [
      e.provider,
      turnsFromTranscript(JSON.parse(readFileSync(join(root, exampleOf(e.file).mock), "utf8"))),
    ]),
  );
  // Copilot's example runs two sessions with one prompt, so its one scripted answer serves both.
  const stub = await startStub((provider, _body, n) => turns[provider][n] ?? turns[provider].at(-1));
  const out = join(dir, "out");
  const report = join(dir, "report");
  const {
    code,
    out: log,
    deleted,
  } = await runLive([
    ...["--config", writeConfig(dir, PROXIED), "--out", out, "--report", report],
    ...["--base-url", `anthropic=${stub.url}`, "--base-url", `openai=${stub.url}`],
  ]);
  await stub.close();
  assert.equal(code, 0, log);
  assert.ok(deleted, "run.mjs deletes each key file once it has read it");
  const results = JSON.parse(readFileSync(join(report, "live-report.json"), "utf8"));
  assert.ok(results.complete, log);
  for (const example of results.examples) {
    assert.equal(example.outcome, "ran", `${example.file}\n${log}`);
    assert.ok(example.checks.total > 0 && example.checks.passed === example.checks.total, example.file);
  }
  const flows = compareAll({ ...config, examples: PROXIED }, { liveDir: out });
  for (const result of flows) assert.deepEqual(result.differences, [], result.file);

  // The proxy, not the CLI or runtime, chose the model and the output cap and sent the key, each to its own provider.
  assert.ok(
    stub.requests.some((r) => r.provider === "anthropic") && stub.requests.some((r) => r.provider === "openai"),
  );
  for (const request of stub.requests) {
    const example = PROXIED.find((e) => e.provider === request.provider);
    assert.equal(request.body.model, example.model);
    if (request.provider === "anthropic") {
      assert.equal(request.headers["x-api-key"], FAKE_KEYS.ANTHROPIC_API_KEY);
      assert.equal(request.headers.authorization, undefined);
      assert.ok(request.body.max_tokens <= example.maxTokens);
    } else {
      assert.equal(request.headers.authorization, `Bearer ${FAKE_KEYS.OPENAI_API_KEY}`);
      assert.equal(request.headers["x-api-key"], undefined);
      assert.ok(request.body.max_output_tokens <= example.maxTokens);
    }
    assert.equal(request.body.metadata, undefined, "the machine's ids stay behind");
    assert.ok(!JSON.stringify(request).includes(PLACEHOLDER_KEY), "the placeholder key stops at the proxy");
    const names = (request.body.tools ?? []).map((tool) => tool.name ?? tool.type);
    for (const name of names) {
      assert.ok(!HOST_TOOL_NAMES.has(name.toLowerCase()) && !BUILTIN_DENY.test(name), `${name} reached the provider`);
      assert.ok(claudeLiveTool(name) || copilotLiveTool(name), name);
    }
  }
  // No key, account id or request id reached a written file, the harnesses' request logs or the log.
  for (const file of [...filesUnder(dir), ...PROXIED.map((e) => harnessLog(e.file))]) {
    const text = readFileSync(file, "utf8");
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${file} holds a secret`);
  }
  for (const secret of SECRETS) assert.ok(!log.includes(secret), "the log holds a secret");
  rmSync(dir, { recursive: true, force: true });
});

test("a proxied example gets the proxy's socket and the run's provider and model, never the key file", () => {
  const env = exampleEnv("/s", {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    apiKey: FAKE_KEYS.ANTHROPIC_API_KEY,
  });
  assert.deepEqual(Object.keys(env).sort(), ["LIVE", "LIVE_MODEL", "LIVE_PROVIDER", "LIVE_PROXY_SOCKET"]);
  assert.ok(!JSON.stringify(env).includes(FAKE_KEYS.ANTHROPIC_API_KEY));
});

test("the proxy refuses a host tool by name or type, a tool its harness doesn't allow, and a field it doesn't know", () => {
  const ok = (tools, extra = {}) => ({ model: "m", messages: [], max_tokens: 10, tools, ...extra });
  const claude = (tools, extra) => requestProblem("anthropic", ok(tools, extra), claudeLiveTool);
  const copilot = (tools, extra) => requestProblem("anthropic", ok(tools, extra), copilotLiveTool);
  assert.equal(claude([{ name: "mcp__weather__get_temperature" }, { name: "ToolSearch" }]), undefined);
  assert.match(claude([{ name: "Bash" }]), /host tool "Bash"/);
  assert.match(claude([{ name: "WebFetch" }]), /"WebFetch", which this live mode doesn't allow/);
  assert.match(claude([{ name: "Agent" }]), /"Agent", which this live mode doesn't allow/);
  assert.match(claude([{ name: "mcp__x__y", type: "web_search_20250305" }]), /of type "web_search_20250305"/);
  assert.match(claude([{ type: "code_execution_20250825" }]), /code_execution/);
  assert.match(claude([], { mcp_servers: [{ url: "https://example.com" }] }), /carries "mcp_servers"/);
  assert.match(claude([], { container: "c" }), /carries "container"/);
  assert.equal(copilot([{ name: "lookup_order" }]), undefined);
  for (const name of ["bash", "view", "create", "edit", "web_fetch", "skill", "task", "read_bash", "sql"]) {
    assert.ok(copilot([{ name }]) !== undefined, name);
  }
  const responses = (tools) => requestProblem("openai", { model: "m", input: "hi", tools }, copilotLiveTool);
  assert.equal(responses([{ type: "function", name: "lookup_order" }]), undefined);
  // A server tool has no name, so the proxy names it by its type, which the shared list also refuses.
  assert.match(responses([{ type: "web_search" }]), /host tool "web_search"/);
  assert.match(responses([{ type: "mcp", server_url: "https://example.com" }]), /of type "mcp"/);
  assert.match(responses([{ type: "function", name: "shell" }]), /host tool "shell"/);
});

test("the proxy sets the run's model and output cap and drops the machine's ids", () => {
  const settings = { model: "claude-haiku-5-5", maxTokens: 1024 };
  const body = {
    model: "claude-opus-5-5",
    max_tokens: 128000,
    metadata: { user_id: "device" },
    thinking: { type: "enabled", budget_tokens: 4096 },
  };
  const sent = prepareBody("anthropic", body, settings);
  assert.deepEqual(sent, { model: "claude-haiku-5-5", max_tokens: 1024 });
  assert.equal(prepareBody("anthropic", { max_tokens: 100 }, settings).max_tokens, 100);
  assert.equal(prepareBody("openai", { user: "u" }, settings).max_output_tokens, 1024);
  assert.equal(prepareBody("openai", { user: "u" }, settings).user, undefined);
});

test("the proxy drops the edits that clear thinking together with the thinking they need", () => {
  const settings = { model: "claude-haiku-5-5", maxTokens: 1024 };
  const thinking = { type: "enabled", budget_tokens: 31999 };
  const cleared = { edits: [{ type: "clear_thinking_20251015" }] };
  assert.equal(
    prepareBody("anthropic", { max_tokens: 64000, thinking, context_management: cleared }, settings).context_management,
    undefined,
  );
  const mixed = { edits: [{ type: "clear_thinking_20251015" }, { type: "clear_tool_uses_20250919" }] };
  assert.deepEqual(
    prepareBody("anthropic", { max_tokens: 64000, thinking, context_management: mixed }, settings).context_management,
    {
      edits: [{ type: "clear_tool_uses_20250919" }],
    },
  );
  // Thinking that fits the cap stays, with its edits.
  const fits = prepareBody(
    "anthropic",
    { max_tokens: 64000, thinking: { type: "enabled", budget_tokens: 512 }, context_management: cleared },
    settings,
  );
  assert.deepEqual(fits.context_management, cleared);
});

test("the Claude live preload checks every MCP config, offers the CLI only ToolSearch, and refuses what it can't inspect", async () => {
  const { isCli, liveArgs, mcpServers } = await import(
    new URL("../../verify/claude-agent-sdk/scripts/live-args.mjs", import.meta.url).href
  );
  const sdk = JSON.stringify({ mcpServers: { weather: { type: "sdk", name: "weather" } } });
  const stdio = JSON.stringify({ mcpServers: { host: { type: "stdio", command: "node" } } });
  const cli = ["--output-format", "stream-json", "--input-format", "stream-json"];
  assert.ok(isCli(cli));
  assert.ok(!isCli(["--version"]));
  assert.deepEqual(
    mcpServers(["--mcp-config", sdk, `--mcp-config=${stdio}`]).map(([name]) => name),
    ["weather", "host"],
  );
  // A later server of the same name does not hide an earlier one.
  const hidden = JSON.stringify({ mcpServers: { host: { type: "sdk" } } });
  assert.throws(() => liveArgs([...cli, "--mcp-config", stdio, "--mcp-config", hidden]), /MCP server "host"/);
  assert.deepEqual(liveArgs([...cli, "--mcp-config", sdk, "--tools", "Bash,Read", "--model", "m"]), [
    ...cli,
    "--mcp-config",
    sdk,
    "--model",
    "m",
    "--strict-mcp-config",
    "--setting-sources=",
    "--tools=ToolSearch",
  ]);
  // A stdio server in a second config, or a config given as a file path, stops the run.
  assert.throws(() => liveArgs([...cli, "--mcp-config", sdk, "--mcp-config", stdio]), /MCP server "host"/);
  assert.throws(() => liveArgs([...cli, "--mcp-config", "./mcp.json"]), /not inline JSON/);
});

test("the Claude live preload refuses settings, plugins and a settings file, loads none, and keeps the CLI's environment to a list", async () => {
  const { cliEnv, liveArgs } = await import(
    new URL("../../verify/claude-agent-sdk/scripts/live-args.mjs", import.meta.url).href
  );
  const cli = ["--output-format", "stream-json", "--input-format", "stream-json"];
  // Project or user settings, plugins and a settings file run hooks and servers on the host.
  assert.throws(() => liveArgs([...cli, "--setting-sources=project"]), /loads settings from the host/);
  assert.throws(() => liveArgs([...cli, "--setting-sources", "user,project"]), /loads settings from the host/);
  assert.throws(() => liveArgs([...cli, "--plugin-dir", "./plugin"]), /--plugin-dir/);
  assert.throws(() => liveArgs([...cli, "--settings", "{}"]), /--settings/);
  // An example that asks for no settings gets none, and only the MCP servers its arguments name.
  const args = liveArgs([...cli, "--setting-sources=", "--strict-mcp-config"]);
  assert.deepEqual(
    args.filter((a) => a.startsWith("--setting-sources") || a === "--strict-mcp-config"),
    ["--strict-mcp-config", "--setting-sources="],
  );
  const env = cliEnv(
    {
      PATH: "/bin",
      HOME: "/h",
      LANG: "C",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      SECRET_TOKEN: "x",
      ANTHROPIC_API_KEY: "real",
      MOCK_LOG: "/l",
    },
    "http://127.0.0.1:1",
    PLACEHOLDER_KEY,
  );
  assert.deepEqual(env, {
    PATH: "/bin",
    HOME: "/h",
    LANG: "C",
    CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
    ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
  });
});

test("the proxy drops thinking blocks from the history together with the thinking they belong to", () => {
  const settings = { model: "claude-haiku-5-5", maxTokens: 1024 };
  const messages = [
    { role: "user", content: "Hi" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "…", signature: "s" },
        { type: "text", text: "Hello." },
      ],
    },
  ];
  const sent = prepareBody(
    "anthropic",
    { max_tokens: 64000, thinking: { type: "enabled", budget_tokens: 31999 }, messages },
    settings,
  );
  assert.equal(sent.thinking, undefined);
  assert.deepEqual(sent.messages[1].content, [{ type: "text", text: "Hello." }]);
  assert.equal(sent.messages[0].content, "Hi");
});

test("calls that overlap, or that a killed run never settled, count against the cap while they are in flight", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-inflight-"));
  const prices = readCatalog(fixtureCatalog(dir));
  const ledger = join(dir, "ledger.json");
  writeLedger(ledger, newLedger(1, 0.5));
  // Each call projects $0.30 (see above), so three in flight reach $0.90 and the fourth would pass the $1.00 cap.
  const call = {
    example: "x",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    inputTokens: 2000,
    maxOutputTokens: 100,
  };
  const projected = [
    reserveCall(ledger, call, prices),
    reserveCall(ledger, call, prices),
    reserveCall(ledger, call, prices),
  ];
  assert.ok(close(readLedger(ledger).inflight, 0.9));
  assert.throws(() => reserveCall(ledger, call, prices), /in flight/);
  // A call that settles moves from in flight to spent, and a ledger with nothing in flight holds no `inflight` field.
  for (const p of projected) settleCall(ledger, call, p, { uncachedInput: 2000, output: 100 }, prices);
  const after = readLedger(ledger);
  assert.equal(after.inflight, undefined);
  assert.ok(close(after.spent, 0.9));
  rmSync(dir, { recursive: true, force: true });
});

/** Runs `script` in a child whose environment is a live run's, with a dummy key file; resolves with its stdout. */
function proxyChild(script, env) {
  const dir = mkdtempSync(join(tmpdir(), "live-proxy-test-"));
  const keyFile = join(dir, "key");
  writeFileSync(keyFile, FAKE_KEYS.ANTHROPIC_API_KEY, { mode: 0o600 });
  const ledger = join(dir, "ledger.json");
  writeLedger(ledger, newLedger());
  const file = join(dir, "child.mjs");
  writeFileSync(file, script);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      env: {
        PATH: process.env.PATH,
        LIVE: "1",
        LIVE_PROVIDER: "anthropic",
        LIVE_MODEL: "claude-haiku-5-5",
        LIVE_MAX_TOKENS: "1024",
        LIVE_LEDGER: ledger,
        LIVE_EXAMPLE: "verify/claude-agent-sdk/examples/02-custom-tool.ts",
        LIVE_API_KEY_FILE: keyFile,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => {
      const keyLeft = existsSync(keyFile);
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, err, keyLeft });
    });
  });
}

test("the proxy forwards only what it allows, answers with no provider header, and keeps the key out of every answer", async () => {
  // The stub answers the first call; then it fails as a broken provider might, quoting the key and a request id.
  let calls = 0;
  const stub = await startStub(() => "Hello.", {
    fail: (_provider, _body, headers) =>
      calls++ === 0
        ? undefined
        : { type: "error", error: { message: `bad key ${headers["x-api-key"]} ${STUB_IDS.requestId}` } },
  });
  const url = (path) => JSON.stringify(new URL(path, import.meta.url).href);
  const { code, out, err, keyLeft } = await proxyChild(
    `import { request } from "node:http";
import { readLedger, writeLedger } from ${url("../live/budget.ts")};
import { startLiveProxy } from ${url("../live/proxy.mjs")};
import { liveTool } from ${url("../../verify/claude-agent-sdk/scripts/live-tools.mjs")};
import { messagesOf } from ${url("../../verify/claude-agent-sdk/scripts/mock-anthropic.mjs")};
const secrets = [];
const proxy = await startLiveProxy({ allowTool: liveTool, messagesOf, secrets });
const post = (path, body) => new Promise((done) => {
  const req = request({ socketPath: proxy.socket, path, method: "POST", headers: { "x-api-key": "placeholder" } }, (res) => {
    let text = "";
    res.on("data", (c) => (text += c));
    res.on("end", () => done({ status: res.statusCode, headers: res.headers, text }));
  });
  req.end(JSON.stringify(body));
});
const message = { model: "claude-opus-5-5", max_tokens: 64000, messages: [{ role: "user", content: "Hi" }] };
const results = {
  bash: await post("/v1/messages", { ...message, tools: [{ name: "Bash", input_schema: {} }] }),
  mcp: await post("/v1/messages", { ...message, mcp_servers: [{ url: "https://example.com" }] }),
  count: await post("/v1/messages/count_tokens", message),
  ok: await post("/v1/messages", { ...message, stream: true }),
  failed: await post("/v1/messages", message),
};
const ledger = readLedger(process.env.LIVE_LEDGER);
writeLedger(process.env.LIVE_LEDGER, { ...ledger, spent: ledger.cap });
results.overCap = await post("/v1/messages", message);
await proxy.close();
console.log(JSON.stringify({ results, refused: proxy.refused, events: proxy.events, secrets: secrets.length }));
`,
    { LIVE_BASE_URL: stub.url },
  );
  await stub.close();
  assert.equal(code, 0, err);
  assert.equal(keyLeft, false, "the proxy's live.ts deletes the key file once read");
  const { results, refused, events, secrets } = JSON.parse(out);
  assert.equal(secrets, 1, "the key joins the runner's redaction list");
  assert.equal(results.bash.status, 400);
  assert.equal(results.mcp.status, 400);
  assert.equal(results.count.status, 404);
  assert.equal(results.overCap.status, 400);
  assert.match(refused.join("\n"), /host tool "Bash"[\s\S]*carries "mcp_servers"[\s\S]*cap/);
  // Only the two allowed calls reached the stub, with the run's model, its cap and the real key.
  assert.equal(stub.requests.length, 2);
  for (const r of stub.requests) {
    assert.equal(r.body.model, "claude-haiku-5-5");
    assert.equal(r.body.max_tokens, 1024);
    assert.equal(r.headers["x-api-key"], FAKE_KEYS.ANTHROPIC_API_KEY);
  }
  assert.equal(results.ok.status, 200);
  assert.match(results.ok.text, /text_delta/);
  assert.equal(results.failed.status, 401);
  for (const result of Object.values(results)) {
    for (const header of Object.keys(result.headers)) assert.ok(!/request-id|organization|workspace/.test(header));
    for (const secret of SECRETS) assert.ok(!result.text.includes(secret), "an answer holds a secret");
  }
  // The failed call, which a CLI would retry, adds no request to the transcript.
  assert.deepEqual(
    events.map((e) => e.kind),
    ["request", "response"],
  );
  assert.deepEqual(events[1].message.parts, [{ type: "text", text: "Hello." }]);
});

test("a proxied example's namespace reaches only its own loopback interface", async () => {
  const stub = await startStub(() => "unreachable");
  const [command, args] = loopbackNamespace()(process.execPath, [
    "-e",
    `fetch(${JSON.stringify(stub.url)}).then(() => process.exit(0), () => process.exit(3))`,
  ]);
  const code = await new Promise((resolve) => {
    spawn(command, args, { env: { PATH: process.env.PATH }, stdio: "ignore" }).on("close", resolve);
  });
  await stub.close();
  assert.equal(code, 3, "a fetch to the host's loopback interface fails inside the namespace");
  assert.equal(stub.requests.length, 0);
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
  const { file, provider } = results[0];
  const markdown = diffMarkdown(results, { examples: [{ file, provider, outcome: "not run" }] });
  assert.match(markdown, new RegExp(`^${results.length} of ${results.length} live examples differ`));
  assert.match(markdown, /outcome: not run/);
  // One file listed on both providers keeps each provider's outcome.
  const both = results.filter((r) => r.file === SDK_TRIAGE);
  assert.deepEqual(both.map((r) => r.provider).sort(), ["anthropic", "openai"]);
  const outcomes = both.map((r) => ({ file: r.file, provider: r.provider, outcome: `${r.provider} outcome` }));
  const split = diffMarkdown(both, { examples: outcomes });
  assert.match(split, /anthropic `claude-haiku-5-5`, outcome: anthropic outcome/);
  assert.match(split, /openai `gpt-5\.4-mini`, outcome: openai outcome/);
  assert.match(diffMarkdown([{ ...results[0], differences: [] }]), /^All 1 live examples kept the mock's flow/);
  // An entry the run reached whose transcript is not here says so, rather than that it never ran.
  const ran = { examples: [{ file: SDK_TRIAGE, provider: "openai", outcome: "ran" }] };
  const reached = compareAll(config, { liveDir: mkdtempSync(join(tmpdir(), "live-none-")), report: ran });
  const sdk = reached.find((r) => r.file === SDK_TRIAGE && r.provider === "openai");
  assert.match(sdk.differences[0], /^No live transcript is committed: the run reports this example's outcome as ran/);
  assert.match(sdk.differences[0], /verified against mock models only/);
  const unreached = reached.find((r) => r.file === SDK_TRIAGE && r.provider === "anthropic");
  assert.equal(unreached.differences[0], "No live transcript: the example recorded no live run.");
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

/** A results commit that holds every listed live transcript. */
const everything = () => true;

test("the date moves to the report job's own date only after every provider's own job completed", () => {
  const before = { lastCompared: "2026-11-30" };
  const both = mergeReports([
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true)),
    entry("/tmp/live/live-openai", reportOf(["openai"], true)),
  ]);
  assert.ok(close(both.spent, 0.2));
  assert.deepEqual(both.completed, ["anthropic", "openai"]);
  assert.deepEqual(dateAfter(both, "2026-12-01", before, config, everything), { lastCompared: "2026-12-01" });
  const one = mergeReports([entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true))]);
  assert.equal(dateAfter(one, "2026-12-01", before, config, everything), before, "the OpenAI job left no artifact");
  const partial = mergeReports([
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true)),
    entry("/tmp/live/live-openai", reportOf(["openai"], false)),
  ]);
  assert.equal(dateAfter(partial, "2026-12-01", before, config, everything), before);
  assert.throws(() => dateAfter(both, "yesterday", before, config, everything));
});

test("only an entry whose live transcript the results commit holds can move the date", () => {
  const before = { lastCompared: "2026-11-30" };
  const both = mergeReports([
    entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true)),
    entry("/tmp/live/live-openai", reportOf(["openai"], true)),
  ]);
  // Both jobs completed, but the commit holds no transcript, as when the workflow stages none: the date stays.
  assert.equal(
    dateAfter(both, "2026-12-01", before, config, () => false),
    before,
  );
  // The commit holds verify/'s transcripts but not our SDK's: those entries count, and move the date.
  const verifyOnly = (path) => path.startsWith("verify/");
  assert.deepEqual(dateAfter(both, "2026-12-01", before, config, verifyOnly), { lastCompared: "2026-12-01" });
  // Only Anthropic's transcripts are held, and only its job completed: the entries that count all completed.
  const one = mergeReports([entry("/tmp/live/live-anthropic", reportOf(["anthropic"], true))]);
  const anthropicOnly = (path) => path.includes("/results/live/anthropic/");
  assert.deepEqual(dateAfter(one, "2026-12-01", before, config, anthropicOnly), { lastCompared: "2026-12-01" });
  assert.equal(dateAfter(one, "2026-12-01", before, config, everything), before);
  // The date step asks git's index, where the patches applied: a committed file is there, and a missing one is not.
  assert.equal(inIndex("apps/manual/src/data/live-examples.json"), true);
  assert.equal(inIndex("packages/sdk/results/live/no-such-provider/13-triage-agent.json"), false);
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
  assert.equal(dateAfter(merged, "2026-12-01", before, config, everything), before);
  // An artifact without the Anthropic job's own directory counts for nothing, whatever it claims.
  const alone = mergeReports([entry("/tmp/live/live-openai", forged), entry("/tmp/live/live-other", forged)]);
  assert.deepEqual(alone.providers, ["openai"]);
  assert.equal(dateAfter(alone, "2026-12-01", before, config, everything), before);
  assert.equal(artifactProvider("/tmp/live/live-anthropic-extra"), undefined, "the directory name must be exact");
});

test("the results commit may change only listed live transcripts and the date file", () => {
  const first = config.examples[0];
  const live = exampleOf(first.file, first.provider).live;
  const mock = readFileSync(join(root, exampleOf(first.file).mock), "utf8");
  const liveText = JSON.stringify({ ...JSON.parse(mock), live: { provider: first.provider, model: "m" } });
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
  // A transcript in one provider's folder must name that provider, so it can't pass for the other provider's run.
  // Which job wrote it is checked on that job's own patch, before any patch applies (patchProblems below).
  const other = first.provider === "anthropic" ? "openai" : "anthropic";
  const misplaced = liveText.replace(`"provider":"${first.provider}"`, `"provider":"${other}"`);
  assert.match(
    changeProblems({ status: "A", path: live }, read({ [live]: misplaced }), config, day)[0],
    /sits in .*'s folder/,
  );
  // The same file listed on the other provider has its own live transcript, in that provider's folder.
  assert.notEqual(exampleOf(first.file, other).live, live);
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

/** A patch that adds `path` with the text `{}`, as a provider job's `git diff --cached --binary` writes one. */
const addPatch = (path) =>
  [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0967ef4",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    "+{}",
    "",
  ].join("\n");

test("a provider job's patch may touch only that provider's listed live transcripts", () => {
  const anthropicLive = exampleOf(SDK_TRIAGE, "anthropic").live;
  const openaiLive = exampleOf(SDK_TRIAGE, "openai").live;
  assert.deepEqual(patchProblems("anthropic", addPatch(anthropicLive), config), []);
  assert.deepEqual(patchProblems("openai", addPatch(openaiLive), config), []);
  // The OpenAI job writes a transcript into Anthropic's folder; the transcript may name anthropic, but the job can't.
  assert.match(patchProblems("openai", addPatch(anthropicLive), config)[0], /openai job's patch touches .*anthropic/);
  assert.match(patchProblems("anthropic", addPatch("scripts/ci/live-run.mjs"), config)[0], /not one of its live/);
  assert.match(patchProblems(undefined, addPatch(anthropicLive), config)[0], /names no provider/);
  // A rename's source, a quoted path and a path only git apply reports count too.
  const rename = `diff --git a/${openaiLive} b/${openaiLive}\nrename from ${anthropicLive}\nrename to ${openaiLive}\n`;
  assert.equal(patchProblems("openai", rename, config).length, 1);
  assert.match(patchProblems("openai", `diff --git "a/x y" "b/x y"\n`, config)[0], /header it can't read/);
  assert.equal(patchProblems("openai", addPatch(openaiLive), config, [anthropicLive]).length, 1);
});

test("merge refuses every artifact's patch that touches another provider's files, before any patch applies", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-merge-"));
  const artifact = (provider, patch, report = true) => {
    const path = join(dir, "live", `live-${provider}`);
    mkdirSync(path, { recursive: true });
    if (report) writeFileSync(join(path, "live-report.json"), JSON.stringify(reportOf([provider], true)));
    writeFileSync(join(path, "live.patch"), patch);
    return path;
  };
  const merge = (...dirs) => {
    try {
      execFileSync(process.execPath, [join(root, "scripts/ci/live-run.mjs"), "merge", join(dir, "r.json"), ...dirs], {
        env: { PATH: process.env.PATH },
        stdio: "pipe",
      });
      return { code: 0, text: "" };
    } catch (error) {
      return { code: error.status, text: `${error.stdout}${error.stderr}` };
    }
  };
  const anthropic = artifact("anthropic", addPatch(exampleOf(SDK_TRIAGE, "anthropic").live));
  const openai = artifact("openai", addPatch(exampleOf(SDK_TRIAGE, "openai").live));
  assert.deepEqual(merge(anthropic, openai), { code: 0, text: "" });
  assert.ok(existsSync(join(dir, "r.json")));
  // The OpenAI job left out its report, so the workflow passes only Anthropic's directory; its patch is still read.
  rmSync(join(dir, "r.json"));
  artifact("openai", addPatch(exampleOf(SDK_TRIAGE, "anthropic").live), false);
  rmSync(join(openai, "live-report.json"));
  const refused = merge(anthropic);
  assert.equal(refused.code, 1);
  assert.match(refused.text, /live-openai: the openai job's patch touches packages\/sdk\/results\/live\/anthropic\//);
  assert.ok(!existsSync(join(dir, "r.json")), "no merged report, so the job stops before it applies a patch");
  writeFileSync(join(openai, "live.patch"), "not a patch\n");
  assert.match(merge(anthropic).text, /live-openai's live.patch is not a patch git can read/);
  rmSync(dir, { recursive: true, force: true });
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
