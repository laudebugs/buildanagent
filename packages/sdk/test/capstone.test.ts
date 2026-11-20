// The support-triage capstone on our SDK: the conformance suite on the scripted model and on both mock transports,
// then the parts of the capstone the suite leaves to a single backend: the example's own entry points, the testing
// doubles, a real socket, and the figures the README reports.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { startMockServer } from "@buildanagent/gateway/testing";
import { composeInterceptors, continueRun, run } from "@buildanagent/sdk";
import { autoResponder, ScriptedModel, scriptedApprovals } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { resumeTriage, startTriage, triageOptions } from "../examples/triage-agent.js";
import { pendingOf, roundTrip } from "./resume-helpers.js";
import { drive } from "./run-helpers.js";
import { anthropicBackend, anthropicBody, chatBackend, scriptedBackend } from "./triage-backends.js";
import { BUG, ESCALATE, LOOKUP, REASON, submit, TICKET, TRIAGE_TOOLS, triageSuite, world } from "./triage-suite.js";

triageSuite({ run, continueRun }, [scriptedBackend, anthropicBackend, chatBackend]);

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The lines a reader counts as code: not blank, and not a comment line, as the deep comparison counts them. */
function codeLines(source: string): number {
  return source.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*|$)/.test(line)).length;
}

test("startTriage() and resumeTriage() take a run from a pause to a typed result through stored JSON", async () => {
  const first = scriptedBackend.fixture([{ calls: [LOOKUP] }, { calls: [ESCALATE] }], "a");
  const one = world();
  const paused = await drive(startTriage(one.deps(first.model), TICKET));
  assert.equal(paused.result.stopReason, "awaiting_approval");
  const stored = JSON.stringify(paused.result.context);
  const [request] = pendingOf(paused.result);
  assert.ok(request);

  const second = scriptedBackend.fixture([{ calls: [submit(BUG)] }], "b");
  const two = world();
  const answer = { requestId: request.id, decision: "allow" as const };
  const done = await drive(resumeTriage(two.deps(second.model), JSON.parse(stored), [answer]));
  assert.equal(done.result.stopReason, "done");
  assert.deepEqual(done.result.stopReason === "done" ? done.result.output : undefined, BUG);
  assert.deepEqual(two.seen.escalations, [REASON]);
  first.assertComplete();
  second.assertComplete();
});

test("scriptedApprovals() answers the capstone's gate inside one run, and the escalation then runs", async () => {
  const fixture = scriptedBackend.fixture([{ calls: [LOOKUP] }, { calls: [ESCALATE] }, { calls: [submit(BUG)] }], "a");
  const process = world();
  const options = triageOptions(process.deps(fixture.model));
  const approvals = scriptedApprovals([{ decision: "allow", by: "test" }]);
  const interceptors = composeInterceptors(options.interceptors ?? {}, approvals);
  const { result } = await drive(run({ ...options, interceptors, system: "s", input: TICKET }));
  assert.equal(result.stopReason, "done");
  assert.deepEqual(process.seen.escalations, [REASON]);
  approvals.assertComplete();
  fixture.assertComplete();
});

test("a run on autoResponder() calls only the lookup, never reaching the gated tool or a host tool", async () => {
  const adapter = new ScriptedModel([autoResponder(), autoResponder()], { ref: { provider: "anthropic" } });
  const model = createModel({ adapter, id: "claude-opus-5-5", retries: 0 });
  const process = world();
  const { result } = await drive(run({ ...triageOptions(process.deps(model)), system: "s", input: TICKET }));
  assert.equal(result.stopReason, "done");
  assert.deepEqual(process.seen.lookups, ["example"]);
  assert.deepEqual(process.seen.escalations, []);
  assert.deepEqual(adapter.calls[0]?.context.tools.map((tool) => tool.name).sort(), TRIAGE_TOOLS);
  adapter.assertComplete();
});

test("the whole approve-and-resume flow also runs over a real loopback socket", async () => {
  const turns = [{ calls: [LOOKUP] }, { calls: [ESCALATE] }, { calls: [submit(BUG)] }];
  const server = await startMockServer({
    api: "anthropic-messages",
    script: turns.map((turn, t) => ({ body: anthropicBody(turn, t, "s"), chunkSize: 17 })),
  });
  try {
    const adapter = anthropic({ apiKey: "sk-test-not-a-real-key", baseURL: server.url, transport: server.transport });
    const model = () => createModel({ adapter, id: "claude-opus-5-5", retries: 0 });
    const one = world();
    const paused = await drive(startTriage(one.deps(model()), TICKET));
    const [request] = pendingOf(paused.result);
    assert.ok(request);
    const two = world();
    const answer = { requestId: request.id, decision: "allow" as const };
    const done = await drive(resumeTriage(two.deps(model()), roundTrip(paused.result.context), [answer]));
    assert.equal(done.result.stopReason, "done");
    assert.deepEqual(two.seen.escalations, [REASON]);
    assert.equal(server.requests.length, 3);
  } finally {
    await server.close();
  }
});

test("the README reports the capstone's line count and hook count, and they are the real ones", () => {
  const options = triageOptions(world().deps(scriptedBackend.fixture([], "a").model));
  const hooks = Object.keys(options.interceptors ?? {}).length + (options.observers?.length ?? 0);
  const example = codeLines(read("../examples/triage-agent.ts"));
  const withCases = [example, ...["triage-suite.ts", "triage-backends.ts"].map((f) => codeLines(read(f)))].reduce(
    (sum, n) => sum + n,
  );
  assert.ok(example <= 100, "an example file stays within the 100 lines the examples guideline allows");
  const readme = read("../README.md");
  assert.ok(readme.includes(`| Our capstone, the agent alone | ${example} | ${hooks} |`), "README row for the agent");
  assert.ok(
    readme.includes(`| Our capstone with its cases and backends | ${withCases} | ${hooks} |`),
    "README row with cases",
  );
});
