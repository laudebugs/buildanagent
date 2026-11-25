// The harness triage capstone (build-harness.md §5.4): the triage example runs on the harness end to end on a scripted
// model, and each describe block below checks one capstone row. The second process that resolves the pause over
// `buildanagent rpc` is in packages/cli/test/capstone-rpc.test.ts, because only the CLI package can start that command.
// The cases' logs and model pairs are kept in test/fixtures/capstone/ for the offline replay suite; set
// CAPSTONE_FIXTURES=write to rewrite them after a deliberate change, then format them with `pnpm format`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHarnessError } from "@buildanagent/harness";
import { createDispatcher, inProcessTransport } from "@buildanagent/harness/server";
import { openSession, type Session, type SessionEntry, type TurnResult } from "@buildanagent/harness/session";
import { CAPABILITIES } from "@buildanagent/sdk";
import { afterAll, describe, test } from "vitest";
import { builtinRegistry } from "../examples/lib/workspace.js";
import { answerTriage, SYSTEM_PROMPT, startTriage, triageHarness } from "../examples/triage-session.js";
import { triageRegistry } from "../examples/triage-tools.js";
import { guardedPager, LEASE_MS, pagesIn } from "./capstone/crash-systems.js";
import {
  decoderLines,
  type Line,
  type Played,
  perBlock,
  perDelta,
  perMessage,
  playBlocks,
  playDeltas,
  playMessages,
} from "./capstone/granularity.js";
import { longSession, SUMMARY } from "./capstone/long-session.js";
import {
  BUG,
  bytesOf,
  CASES,
  type CaseName,
  CUSTOMER,
  call,
  entriesOf,
  FIXTURE_ENV,
  type Files,
  FREEZE,
  filesAt,
  KEY,
  PAGER_TOKEN,
  PROVIDER_KEY,
  QUESTION,
  REASON,
  type RecordedCase,
  recordCase,
  recordedModel,
  replayedModel,
  signer,
  submit,
  TRIAGE_TOOLS,
  world,
} from "./capstone/triage-fixture.js";
import { testEnv } from "./sandbox/home.js";
import { exportSpans } from "./telemetry/spans.js";

const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fresh = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "harness-capstone-"));
  made.push(dir);
  return dir;
};

const FIXTURES = fileURLToPath(new URL("./fixtures/capstone/", import.meta.url));
const WRITE_FIXTURES = process.env.CAPSTONE_FIXTURES === "write";
const NAMES = Object.keys(CASES) as CaseName[];

/** One recording of each case, shared by the rows that only read it. */
const recorded = new Map<CaseName, { files: Files; run: RecordedCase; entries: SessionEntry[] }>();
async function recording(name: CaseName) {
  const known = recorded.get(name);
  if (known !== undefined) return known;
  const files = filesAt(fresh());
  const run = await recordCase(files, CASES[name]);
  const found = { files, run, entries: await entriesOf(files) };
  recorded.set(name, found);
  return found;
}

const ofType = <T extends SessionEntry["type"]>(entries: readonly SessionEntry[], type: T) =>
  entries.filter((entry): entry is Extract<SessionEntry, { type: T }> => entry.type === type);
const resultOf = (entries: readonly SessionEntry[], callId: string) =>
  ofType(entries, "tool_result").find((entry) => entry.callId === callId);
const outputOf = (run: RecordedCase) => (run.result.stopReason === "done" ? run.result.output : undefined);
const fileOf = (files: Files): string => Object.values(bytesOf(files)).join("");

describe("Risky tool: the pipeline asks, the pause is durable first, and a later deny wins", () => {
  test("an approved escalation pauses, then runs once in the answering process and ends with a typed result", async () => {
    const { run, entries } = await recording("approved");
    assert.equal(run.paused.stopReason, "awaiting_approval");
    assert.deepEqual(run.first, { lookups: [CUSTOMER.customerEmail], escalations: [] }, "nothing paged before");
    assert.deepEqual(run.second, { lookups: [], escalations: [REASON] }, "one page, and no second lookup");
    assert.equal(run.result.stopReason, "done");
    assert.deepEqual(outputOf(run), BUG);
    const asked = ofType(entries, "permission_decision").find((entry) => entry.decision === "ask");
    assert.equal(asked?.tool, "escalate");
    assert.equal(ofType(entries, "approval_requested")[0]?.request.id, run.requestId);
  });

  test("the approval_requested entry is in the log before any observer hears of the request", async () => {
    const files = filesAt(fresh());
    const seen: boolean[] = [];
    await recordCase(files, CASES.approved, {
      observers: [
        async (event) => {
          if (event.type !== "approval_request") return;
          const entries = await entriesOf(files);
          seen.push(ofType(entries, "approval_requested").some((entry) => entry.request.id === event.request.id));
        },
      ],
    });
    assert.deepEqual(seen, [true]);
  });

  test("a rejected escalation never runs, and the model triages without it", async () => {
    const { run, entries } = await recording("rejected");
    assert.deepEqual([...run.first.escalations, ...run.second.escalations], []);
    assert.deepEqual(outputOf(run), QUESTION);
    const denial = resultOf(entries, "call-2");
    assert.ok(denial?.isError);
    assert.match(JSON.stringify(denial.content), /denied: not an outage/);
  });

  test("a deny added after the pause wins over the allow a person gave before it", async () => {
    const { run, entries } = await recording("policy_changed");
    const [answer] = ofType(entries, "approval_resolved");
    assert.ok(answer !== undefined && "decision" in answer.resolution);
    assert.equal(answer.resolution.decision, "allow");
    assert.deepEqual([...run.first.escalations, ...run.second.escalations], [], "the approved page never ran");
    const denial = resultOf(entries, "call-2");
    assert.ok(denial?.isError);
    assert.ok(JSON.stringify(denial.content).includes(FREEZE.reason as string));
    const decided = ofType(entries, "permission_decision").filter((entry) => entry.tool === "escalate");
    assert.deepEqual(
      decided.map((entry) => [entry.decision, entry.policyVersion]),
      [
        ["ask", "triage-1"],
        ["deny", "triage-2"],
      ],
      "the pause carried the old policy, and the resume decided under the new one",
    );
    assert.deepEqual(outputOf(run), QUESTION);
  });
});

describe("Tool surface: the capstone's tools and no built-ins reach the model", () => {
  test("every request of every case offers exactly the agent's two tools and its output tool", async () => {
    for (const name of NAMES) {
      const { run } = await recording(name);
      assert.ok(run.toolNames.length > 0);
      for (const names of run.toolNames) assert.deepEqual(names, TRIAGE_TOOLS, name);
    }
  });

  test("the registry holds no built-in tool, and its preamble is printed beside the built-ins' preamble", async () => {
    const registry = triageRegistry(world().deps);
    assert.deepEqual(
      registry
        .list()
        .map((tool) => tool.canonicalName)
        .sort(),
      ["escalate", "lookup_customer"],
    );
    const builtins = await builtinRegistry();
    const builtinNames = builtins.list().map((tool) => tool.canonicalName);
    assert.ok(builtinNames.length >= 6 && builtinNames.every((name) => registry.get(name) === undefined));
    const preamble = registry.preambleTokens({ system: SYSTEM_PROMPT });
    const builtinPreamble = builtins.preambleTokens({ system: SYSTEM_PROMPT });
    console.log(
      `capstone preamble: ${preamble} tokens with 2 tools; ${builtinPreamble} with ${builtinNames.length} built-ins`,
    );
    assert.ok(preamble > 0 && preamble < builtinPreamble);
  });
});

/** A session file with the header's release fields blanked, so a version bump alone does not fail the fixtures. */
const normalized = (text: string): string =>
  text
    .replace(/"sdkVersion":"[^"]*"/g, '"sdkVersion":"*"')
    .replace(/"defaultsHash":"[^"]*"/g, '"defaultsHash":"*"')
    .replace(/"capabilities":\[[^\]]*\]/g, '"capabilities":["*"]');

/** Recorded pairs with the SDK version left out of their stamps, for the same reason. */
const unstamped = (pairs: RecordedCase["pairs"]) =>
  Object.values(pairs).map((list) => list.map((pair) => ({ ...pair, stamp: { ...pair.stamp, sdkVersion: "*" } })));

describe("State: playback is byte-identical, and HEAD survives a reload after a checkout", () => {
  test("two recordings of each case write byte-identical session files", async () => {
    for (const name of NAMES) {
      const again = filesAt(fresh());
      await recordCase(again, CASES[name]);
      assert.deepEqual(bytesOf(again), bytesOf((await recording(name)).files), name);
    }
  });

  test("playback yields the file's entries, and writing them out again gives the file's bytes", async () => {
    for (const name of NAMES) {
      const { files } = await recording(name);
      const reader = await openSession({ store: files.store, index: files.index, key: KEY });
      let written = "";
      for await (const entry of reader.playback()) written += `${JSON.stringify(entry)}\n`;
      assert.equal(written, fileOf(files), name);
    }
  });

  test("the recorded model pairs replay through the harness and write the same bytes again", async () => {
    for (const name of NAMES) {
      const { files, run } = await recording(name);
      const replay = filesAt(fresh());
      const models = { start: replayedModel(run.pairs.start), resume: replayedModel(run.pairs.resume) };
      await recordCase(replay, CASES[name], { models });
      assert.deepEqual(bytesOf(replay), bytesOf(files), name);
    }
  });

  test("the recorded cases match the replay fixtures", async () => {
    if (WRITE_FIXTURES) mkdirSync(FIXTURES, { recursive: true });
    for (const name of NAMES) {
      const { files, run } = await recording(name);
      const log = fileOf(files);
      const pairs = `${JSON.stringify(run.pairs, null, 2)}\n`;
      if (WRITE_FIXTURES) {
        writeFileSync(join(FIXTURES, `${name}.jsonl`), log);
        writeFileSync(join(FIXTURES, `${name}.pairs.json`), pairs);
      }
      assert.equal(normalized(log), normalized(readFileSync(join(FIXTURES, `${name}.jsonl`), "utf8")), name);
      const kept = JSON.parse(readFileSync(join(FIXTURES, `${name}.pairs.json`), "utf8")) as RecordedCase["pairs"];
      assert.deepEqual(unstamped(run.pairs), unstamped(kept), name);
    }
  });

  test("HEAD moved by a checkout is where a reload finds it, and the reloaded context follows it", async () => {
    const files = filesAt(fresh());
    await recordCase(files, CASES.approved);
    const session = await openSession({ ...files, key: KEY });
    const paused = ofType(await entriesOf(files), "turn_end")[0];
    assert.ok(paused);
    await session.checkout(paused.id);
    const before = await session.toContext();
    await session.close();
    const reloaded = await openSession({ ...files, key: KEY });
    assert.equal(reloaded.head(), paused.id);
    assert.equal(reloaded.headMoved(), true);
    assert.deepEqual(await reloaded.toContext(), before);
    assert.ok(!JSON.stringify(before.messages).includes("submit_triage"), "the context ends at the pause");
    await reloaded.close();
  });
});

describe("Context: a long session masks older results and writes one visible summary", () => {
  const TICKETS = 6;
  test("six tickets in one session mask older lookups in the request view and leave one compaction entry", async () => {
    const { entries, requests } = await longSession(filesAt(fresh()), TICKETS);
    const masked = requests.filter((request) =>
      JSON.stringify(request.context.messages).includes("[older tool result masked:"),
    );
    assert.ok(masked.length > 0, "a request saw a masked result");
    const compactions = ofType(entries, "compaction");
    assert.equal(compactions.length, 1);
    assert.equal(compactions[0]?.summary, SUMMARY);
    const lookups = ofType(entries, "tool_result").filter((entry) => entry.tool === "lookup_customer");
    assert.equal(lookups.length, TICKETS, "the log keeps every original result");
    assert.ok(lookups.every((entry) => !JSON.stringify(entry.content).includes("[older tool result masked:")));
  });
});

/** Everything a person or a backend could read from the capstone: files, entries, spans and recorded pairs. */
async function everything(): Promise<string> {
  const parts: string[] = [];
  for (const name of NAMES) {
    const { files, run, entries } = await recording(name);
    parts.push(fileOf(files), JSON.stringify(entries), JSON.stringify(run.pairs));
    const spans = await exportSpans(entries, { content: "attributes", toolArguments: true });
    parts.push(JSON.stringify(spans.map((span) => [span.name, span.attributes, span.events, span.status])));
  }
  return parts.join("\n");
}

describe("Secrets: no provider key or injected credential appears in any entry or span", () => {
  test("the planted secrets reached a tool's result, and the log, the spans and the pairs hold neither", async () => {
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "the provider key lives in the fixture only");
    assert.equal(FIXTURE_ENV.ANTHROPIC_API_KEY, PROVIDER_KEY);
    const { entries } = await recording("approved");
    const page = resultOf(entries, "call-2");
    assert.match(JSON.stringify(page?.details), /"authorization":"Bearer \[REDACTED\]","x-api-key":"\[REDACTED\]"/);
    const all = await everything();
    for (const secret of [PROVIDER_KEY, PAGER_TOKEN, btoa(PROVIDER_KEY), encodeURIComponent(PAGER_TOKEN)]) {
      assert.ok(!all.includes(secret), `${secret.slice(0, 8)}... is absent`);
    }
  });
});

const CRASH_CHILD = fileURLToPath(new URL("./capstone/crash-child.ts", import.meta.url));
const SOURCE_CONDITION = fileURLToPath(new URL("./permissions/source-condition.mjs", import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Runs the crash child until the pager has accepted the page, then kills it with SIGKILL. */
async function crashAfterAccept(dir: string, effects: string, pager: string): Promise<void> {
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", SOURCE_CONDITION, "--import", "tsx", CRASH_CHILD, dir, effects, pager],
    { cwd: PACKAGE_DIR, env: testEnv([]), stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const closed = new Promise<NodeJS.Signals | null>((resolve) => child.on("close", (_code, signal) => resolve(signal)));
  const accepted = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("accepted")) resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", () => reject(new Error(`the child ended before the page was accepted:\n${output}`)));
  });
  await accepted;
  child.kill("SIGKILL");
  assert.equal(await closed, "SIGKILL");
}

const waitUntil = async (time: number) => {
  while (Date.now() <= time) await new Promise((resolve) => setTimeout(resolve, LEASE_MS / 4));
};

/** Opens the session once the killed writer's lock lease has run out. */
async function openAfterLease(files: Files): Promise<Session> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      return await openSession({ ...files, key: KEY });
    } catch (error) {
      if (!isHarnessError(error) || error.code !== "session_locked" || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, LEASE_MS / 4));
    }
  }
}

describe("Crash: a process killed after the pager accepted a page resumes without paging twice", () => {
  test("the crashed call settles as unknown, the repeated call reconciles to applied, and the pager holds one page", async () => {
    const dir = fresh();
    const effects = join(dir, "effects.json");
    const pager = join(dir, "pages.log");
    await crashAfterAccept(dir, effects, pager);
    assert.equal(pagesIn(pager).length, 1, "the pager accepted the page");
    const files = filesAt(dir, LEASE_MS);
    assert.equal(resultOf(await entriesOf(files), "call-2"), undefined, "the page's result never reached the log");
    const records = Object.values(
      JSON.parse(readFileSync(effects, "utf8")) as Record<string, { state: string; leaseUntil: string }>,
    );
    assert.deepEqual(
      records.map((record) => record.state),
      ["started"],
      "the effect record was never settled",
    );

    const target: { session?: Session; harness?: never } = {};
    const escalate = guardedPager({ target, effects, pager });
    const model = recordedModel([call("call-9", "escalate", { reason: REASON }), submit("call-10", BUG)]);
    const registry = triageRegistry({ ...world().deps, escalate });
    const harness = triageHarness({ model: model.model, signer: signer(), registry, policy: { version: "triage-1" } });
    const session = await openAfterLease(files);
    Object.assign(target, { session, harness });
    const run = { session, harness, app: CUSTOMER };
    const asked = await startTriage(run, "Did the page go out?");
    assert.equal(asked.stopReason, "awaiting_approval");
    const crashed = resultOf(await entriesOf(files), "call-2");
    assert.match(JSON.stringify(crashed?.details), /"kind":"unknown".*"retry":"reconcile_first"/);
    const [again] = asked.stopReason === "awaiting_approval" ? asked.pending : [];
    // The resume only takes over an attempt whose lease has run out; until then the page counts as still running.
    await waitUntil(Date.parse(records[0]?.leaseUntil ?? ""));
    const done = await answerTriage(run, [{ requestId: again?.id ?? "", decision: "allow", by: "lead" }]);
    await session.close();
    assert.equal((done as TurnResult).stopReason, "done");
    model.adapter.assertComplete();
    const repeated = resultOf(await entriesOf(files), "call-9");
    assert.match(JSON.stringify(repeated?.details), /"outcome":\{"kind":"applied"/);
    const key = (repeated?.details as { receipt: { outcome: { effectKey: string } } } | undefined)?.receipt.outcome
      .effectKey;
    assert.deepEqual(pagesIn(pager), [key], "the pager still holds one page, under the repeated call's key");
  });
});

/** The assistant messages and tool results of a context, in the shape the granularity decoders play back. */
function playedOf(messages: readonly { role: string }[]): Played[] {
  return messages.flatMap((message): Played[] => {
    if (message.role === "assistant") {
      const { content, stopReason, usage } = message as Extract<Played, { role: "assistant" }>;
      return [{ role: "assistant", content, stopReason, usage }];
    }
    if (message.role !== "tool") return [];
    const { callId, content, isError } = message as unknown as { callId: string; content: unknown; isError?: boolean };
    return [{ role: "tool", callId, content, isError: isError === true }];
  });
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

describe("HD1: per-block playback keeps everything per-delta keeps that playback reads", () => {
  test("the capstone at three granularities: file size, playback fidelity and resume code", async () => {
    const source = readFileSync(new URL("./capstone/granularity.ts", import.meta.url), "utf8");
    const report: Record<string, unknown> = {
      decoderLines: {
        perDelta: decoderLines(source, "perDelta"),
        perBlock: decoderLines(source, "perBlock"),
        perMessage: decoderLines(source, "perMessage"),
      },
    };
    for (const name of NAMES) {
      const recorders = { perDelta: perDelta(), perBlock: perBlock(), perMessage: perMessage() };
      const files = filesAt(fresh());
      await recordCase(files, CASES[name], { observers: Object.values(recorders).map((r) => r.observer) });
      const reader = await openSession({ store: files.store, index: files.index, key: KEY });
      const context = playedOf((await reader.toContext()).messages);
      const played = {
        perDelta: playDeltas(recorders.perDelta.lines()),
        perBlock: playBlocks(recorders.perBlock.lines()),
        perMessage: playMessages(recorders.perMessage.lines()),
      };
      for (const [granularity, transcript] of Object.entries(played)) {
        assert.deepEqual(transcript, context, `${name}: ${granularity} plays back the context the log rebuilds`);
      }
      const deltas = recorders.perDelta.lines().filter((line: Line) => line.t === "delta").length;
      report[name] = {
        bytes: {
          perDelta: bytes(recorders.perDelta.file()),
          perBlock: bytes(recorders.perBlock.file()),
          perMessage: bytes(recorders.perMessage.file()),
          packageLog: bytes(fileOf(files)),
        },
        lines: Object.fromEntries(Object.entries(recorders).map(([key, r]) => [key, r.lines().length])),
        // What per-delta keeps that per-block drops: the stream's chunk boundaries, one per delta, and their times.
        deltas,
      };
    }
    const text = `${JSON.stringify(report, null, 2)}\n`;
    console.log(`HD1 granularity report:\n${text}`);
    const path = join(FIXTURES, "granularity.json");
    if (WRITE_FIXTURES) writeFileSync(path, text);
    assert.equal(text, readFileSync(path, "utf8"));
  });
});

describe("initialize reports the SDK's capability list", () => {
  test("a dispatcher over the triage harness answers initialize with CAPABILITIES, and the header records them", async () => {
    const files = filesAt(fresh());
    const harness = triageHarness({
      model: recordedModel([]).model,
      signer: signer(),
      registry: triageRegistry(world().deps),
      policy: { version: "triage-1" },
    });
    const client = inProcessTransport(createDispatcher({ harness, ...files, userId: KEY.userId }));
    const answer = await client.request("initialize", {
      clientInfo: { name: "capstone", version: "0" },
      capabilities: [],
    });
    client.close();
    assert.deepEqual(answer.capabilities, [...CAPABILITIES]);
    assert.ok(CAPABILITIES.every((name) => /^[a-z_]+_v\d+$/.test(name)));
    const [header] = (await recording("approved")).entries;
    assert.ok(header?.type === "session_header");
    assert.deepEqual(header.capabilities, [...CAPABILITIES]);
  });
});
