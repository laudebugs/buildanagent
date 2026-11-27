// The harness capstone's triage agent, rebuilt from public harness APIs so the replay suite can run it again on the
// recorded model pairs and compare every entry it writes with the fixture's. The harness's own copy lives in its
// examples (packages/harness/examples/triage-session.ts and triage-tools.ts), which no other package may import. Only
// the behaviour is restated here: the tools' names, descriptions and schemas come from the recorded requests, so they
// cannot drift from the agent that was recorded, and any other drift shows up as a changed entry.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline, type Rule } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import {
  createApprovals,
  openSession,
  runTurn,
  type SessionEntry,
  type SessionStore,
} from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, hmacSigner, type Resolution, type ToolDefinition } from "@buildanagent/sdk";
import { fixedClock, type RecordedPair, type ReplayModel, replayPairs, sequentialIds } from "@buildanagent/sdk/testing";
import { CATALOG, type CaseName, KEY } from "./capstone.js";

/** When the capstone recorded its pairs; the replay checks their expiry against this fixed time, never the wall clock. */
export const RECORDED_AT = "2026-11-25T09:00:00.000Z";

const SYSTEM =
  "You triage support tickets. Look the customer up first. Escalate only a ticket an on-call engineer must see. Submit the triage last.";
const TICKET = "user@example.com says checkout fails with a 500. Triage it.";
const APP = { customerEmail: "user@example.com" };
const LIMITS = { maxSteps: 8, budgetUsd: 0.25 };
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
const FREEZE: Rule = { tool: "escalate", reason: "Paging is frozen during the incident review." };

/** How each case answers the pause, and the policy of the process that answers it. */
const ANSWERS: Record<CaseName, { answer: (id: string) => Resolution; version: string; deny: Rule[] }> = {
  approved: {
    answer: (id) => ({ requestId: id, decision: "allow", by: "on-call lead" }),
    version: "triage-1",
    deny: [],
  },
  rejected: {
    answer: (id) => ({ requestId: id, decision: "deny", reason: "not an outage" }),
    version: "triage-1",
    deny: [],
  },
  policy_changed: {
    answer: (id) => ({ requestId: id, decision: "allow", by: "on-call lead" }),
    version: "triage-2",
    deny: [FREEZE],
  },
};

type AnyTool = ToolDefinition<unknown, unknown, unknown>;
type WireTool = RecordedPair["request"]["context"]["tools"][number];
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/**
 * The three tools with the recorded wire definitions. The page's receipt is the one the fixture holds after the
 * capstone scrubbed its planted secrets, so the rerun writes the same scrubbed details without any secret.
 */
function tools(wire: readonly WireTool[]) {
  const spec = (name: string) => {
    const found = wire.find((tool) => tool.name === name);
    if (found === undefined) throw new Error(`the recording has no ${name} tool`);
    return { name, description: found.description, inputSchema: found.inputSchema };
  };
  const lookup = defineTool({
    ...spec("lookup_customer"),
    execute: async () => text('{"plan":"pro","openTickets":2}'),
  });
  const escalate = defineTool<{ reason: string }>({
    ...spec("escalate"),
    effect: { kind: "write", businessKey: (input: { reason: string }) => `escalate:${input.reason}` },
    execute: async () => ({
      ...text("paged the on-call engineer"),
      details: { receipt: { page: "pg-1", echoed: { authorization: "Bearer [REDACTED]", "x-api-key": "[REDACTED]" } } },
    }),
  });
  const output = defineTool({
    ...spec("submit_triage"),
    execute: async (input: unknown) => ({ ...text("triage recorded"), structured: input, terminate: true }),
  }) as AnyTool;
  return { agent: [lookup, escalate] as AnyTool[], output };
}

function harnessFor(model: Model, wire: readonly WireTool[], policy: { version: string; deny: Rule[] }) {
  const { agent, output } = tools(wire);
  const registry = createToolRegistry();
  for (const definition of agent) registry.register({ name: definition.name, source: "builtin", definition });
  const pipeline = createPermissionPipeline(
    {
      mode: "default",
      interactive: true,
      policyVersion: policy.version,
      allow: [{ tool: "lookup_customer" }, { tool: "submit_triage" }],
      ask: [{ tool: "escalate", reason: "An on-call engineer will be paged." }],
      deny: policy.deny,
    },
    registry,
  );
  const signer = hmacSigner({ keys: { k1: KEY_BYTES }, current: "k1" });
  return { harness: createHarness<typeof APP>({ model, signer, registry, system: SYSTEM, pipeline }), output };
}

function replayed(pairs: readonly RecordedPair[]): { adapter: ReplayModel; model: Model } {
  const adapter = replayPairs(pairs, { clock: fixedClock(RECORDED_AT), expect: { providerVersion: "scripted" } });
  return { adapter, model: createModel({ adapter, id: adapter.modelId, catalog: CATALOG, retries: 0 }) as Model };
}

async function entriesIn(store: SessionStore): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of store.load(KEY)) found.push(entry);
  return found;
}

/**
 * Runs one case again on its recorded pairs, as the capstone did: the first process pauses at the page, and a second
 * harness, model and policy answer it. Returns every entry the rerun wrote. Throws when a call sends a request other
 * than the recorded one.
 */
export async function rerun(name: CaseName, pairs: { start: RecordedPair[]; resume: RecordedPair[] }) {
  const dir = mkdtempSync(join(tmpdir(), "evals-replay-"));
  try {
    return await rerunIn(dir, name, pairs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The JSONL store, as the capstone recorded with: the order in which the runner's appends and the model's events
// interleave, and so the entry ids, follows the store the run writes to.
async function rerunIn(dir: string, name: CaseName, pairs: { start: RecordedPair[]; resume: RecordedPair[] }) {
  const clock = fixedClock(RECORDED_AT, 250);
  const newId = sequentialIds("t");
  const store = jsonlStore({ dir: join(dir, "sessions") });
  const files = {
    store,
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
  };
  const options = { ...files, key: KEY, now: () => new Date(clock.now()), newId };
  const wire = pairs.start[0]?.request.context.tools ?? [];
  const first = replayed(pairs.start);
  const start = harnessFor(first.model, wire, { version: "triage-1", deny: [] });
  const session = await openSession(options);
  const paused = await runTurn(session, start.harness, {
    ...LIMITS,
    input: TICKET,
    hostContext: APP,
    output: start.output,
    clock,
    newId,
  });
  await session.close();
  const requestId = paused.stopReason === "awaiting_approval" ? (paused.pending[0]?.id ?? "") : "";
  const second = replayed(pairs.resume);
  const resume = harnessFor(second.model, wire, ANSWERS[name]);
  const reopened = await openSession(options);
  await createApprovals(resume.harness).resolve(reopened, [ANSWERS[name].answer(requestId)], {
    ...LIMITS,
    hostContext: APP,
    output: resume.output,
    clock,
    newId,
  });
  await reopened.close();
  first.adapter.assertComplete();
  second.adapter.assertComplete();
  return entriesIn(store);
}
