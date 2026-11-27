// The offline replay suite (build-harness.md §5.5): each recorded capstone session is checked against its recorded
// model calls, with no model and no network. For every model call in the log, the context the log rebuilds up to that
// call is sent through `replayPairs()`, which fails when it differs from the request that was recorded, and the
// replayed response must equal the blocks, stop reason, usage and cost the log wrote for it. So a change to any entry a
// model call reads or writes fails the replay. The entries no model call reads (permission decisions, approvals, turn
// ends) are checked through the eval row, the trajectory and the case's expected tools and decisions; the harness's own
// capstone test pins every byte of the files.
import assert from "node:assert/strict";
import { toEvalRow, toMiniSweTrajectory } from "@buildanagent/evals";
import { createModel, type Model, totalInput } from "@buildanagent/gateway";
import { memoryIndex, memoryStore, openSession } from "@buildanagent/harness/session";
import type { MessageBlockEntry, SessionEntry, UsageEntry } from "@buildanagent/protocol";
import { replayPairs } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { CASE_NAMES, CATALOG, type CaseName, KEY, loadCase, type RecordedCase } from "./capstone.js";

type Block = SessionEntry & MessageBlockEntry;

/** The entries of each assistant message, in log order: its blocks, its end and the usage entry after it. */
function modelCalls(entries: readonly SessionEntry[]) {
  const calls: { blocks: Block[]; end: SessionEntry | undefined; usage: (SessionEntry & UsageEntry) | undefined }[] =
    [];
  for (const entry of entries) {
    if (entry.type === "message_block" && entry.role === "assistant") {
      const last = calls.at(-1);
      if (last?.blocks[0]?.messageId === entry.messageId) last.blocks.push(entry);
      else calls.push({ blocks: [entry], end: undefined, usage: undefined });
    } else if (entry.type === "message_end") {
      const last = calls.at(-1);
      if (last !== undefined) last.end = entry;
    } else if (entry.type === "usage" && entry.source === "model_call") {
      const last = calls.at(-1);
      if (last !== undefined) last.usage = entry;
    }
  }
  return calls;
}

/**
 * Replays a case's model calls against its log. The replay checks the recording's expiry against the real clock, as
 * the capstone meant: once the pairs are a year old the suite fails until they are recorded again.
 */
async function replay({ entries, pairs }: RecordedCase): Promise<void> {
  const store = memoryStore();
  await store.append(
    KEY,
    entries.map(({ seq: _seq, ...entry }) => entry),
  );
  const session = await openSession({ store, index: memoryIndex(), key: KEY });
  const adapter = replayPairs(pairs, { expect: { providerVersion: "scripted" } });
  const model = createModel({ adapter, id: adapter.modelId, catalog: CATALOG, retries: 0 }) as Model;
  const calls = modelCalls(entries);
  assert.equal(calls.length, pairs.length, "one recorded pair per model call in the log");
  for (const [index, call] of calls.entries()) {
    const pair = pairs[index];
    assert.ok(pair);
    const first = call.blocks[0];
    assert.ok(first);
    const context = await session.toContext(first.parentId);
    const request = { system: context.system, messages: [...context.messages], tools: pair.request.context.tools };
    const message = await model.complete(request, pair.request.options);
    assert.notEqual(message.stopReason, "error", `call ${index + 1}: ${message.error?.message ?? ""}`);
    assert.deepEqual(
      call.blocks.map((block) => block.block),
      message.content,
      `call ${index + 1}: blocks`,
    );
    assert.equal(call.end?.type === "message_end" ? call.end.stopReason : undefined, message.stopReason);
    assert.deepEqual(call.usage?.usage, message.usage, `call ${index + 1}: usage`);
    assert.deepEqual(call.usage?.cost, message.cost, `call ${index + 1}: cost`);
  }
  adapter.assertComplete();
  await session.close();
}

const PRICE = 0.00135; // 200 input tokens at $3 and 50 output tokens at $15 per million

/** What each case's row and log must say, worked out from the capstone's script. */
const EXPECTED: Record<CaseName, { results: string[]; decisions: string[]; entries: number }> = {
  approved: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    // The resume decides the escalation again, and the rule still asks; the approval in the log lets it run.
    decisions: ["lookup_customer:allow", "escalate:ask", "escalate:ask", "submit_triage:allow"],
    entries: 27,
  },
  rejected: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    decisions: ["lookup_customer:allow", "escalate:ask", "submit_triage:allow"],
    entries: 26,
  },
  policy_changed: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    decisions: ["lookup_customer:allow", "escalate:ask", "escalate:deny", "submit_triage:allow"],
    entries: 27,
  },
};

describe("the recorded capstone sessions replay offline", () => {
  for (const name of CASE_NAMES) {
    test(`${name}: every model call in the log replays its recorded request and response`, async () => {
      await replay(loadCase(name));
    });

    test(`${name}: the eval row has the log's cost, tokens, steps, prompts, wall time and exit`, () => {
      const { entries } = loadCase(name);
      const row = toEvalRow(entries, {
        task: "triage-checkout-500",
        trial: 0,
        harness: "ours",
        ablation: "none",
        preambleTokens: 120,
        passed: true,
        tags: ["triage"],
      });
      assert.deepEqual(row, {
        task: "triage-checkout-500",
        trial: 0,
        costUsd: PRICE + PRICE + PRICE,
        tokens: {
          uncachedInput: 600,
          cacheRead: 0,
          cacheWrite: { "5m": 0, "1h": 0 },
          output: 150,
          reasoning: 0,
          raw: null,
        },
        passed: true,
        steps: 3,
        preambleTokens: 120,
        wallMs: Date.parse(entries.at(-1)?.timestamp ?? "") - Date.parse("2026-11-25T09:00:00.000Z"),
        prompts: 1,
        exit: "submitted",
        harness: "ours",
        tags: ["triage"],
        ablation: "none",
      });
      assert.equal(totalInput(row.tokens), 600);
    });

    test(`${name}: the log holds the entries the case's script implies`, () => {
      const { entries } = loadCase(name);
      const expected = EXPECTED[name];
      assert.equal(entries.length, expected.entries);
      assert.deepEqual(
        entries.flatMap((entry) => (entry.type === "tool_result" ? [entry.tool] : [])),
        expected.results,
      );
      assert.deepEqual(
        entries.flatMap((entry) => (entry.type === "permission_decision" ? [`${entry.tool}:${entry.decision}`] : [])),
        expected.decisions,
      );
      assert.deepEqual(
        entries.flatMap((entry) => (entry.type === "turn_end" ? [entry.stopReason] : [])),
        ["awaiting_approval", "done"],
      );
    });

    test(`${name}: the trajectory has instance_cost, api_calls and exit_status filled`, () => {
      const trajectory = toMiniSweTrajectory(loadCase(name).entries);
      assert.equal(trajectory.trajectory_format, "mini-swe-agent-1.1");
      assert.deepEqual(trajectory.info.model_stats, { instance_cost: PRICE + PRICE + PRICE, api_calls: 3 });
      assert.equal(trajectory.info.exit_status, "Submitted");
    });
  }
});

describe("the replay fails when an entry changes", () => {
  test("a changed tool result no longer matches the request the next call recorded", async () => {
    const edited = loadCase("approved", (log) => log.replace('\\"openTickets\\":2', '\\"openTickets\\":3'));
    await assert.rejects(() => replay(edited), /differs from the recording/);
  });

  test("a changed model block no longer matches the replayed response", async () => {
    const edited = loadCase("approved", (log) => log.replace("so I'll page", "so I will page"));
    await assert.rejects(() => replay(edited), /blocks/);
  });

  test("a changed usage entry no longer matches the replayed usage", async () => {
    const edited = loadCase("rejected", (log) => log.replace('"output":50', '"output":51'));
    await assert.rejects(() => replay(edited), /usage/);
  });
});
