// The offline replay suite (build-harness.md §5.5). Each recorded capstone case runs again on its recorded model
// pairs through `replayPairs()`, with no model and no network: the triage agent pauses at the page, a second harness
// answers it, and every entry the rerun writes must deep-equal the fixture's, the header's release fields aside. A
// request that differs from the recording fails inside the rerun, and a change to any entry of the fixture fails the
// comparison. The eval row and the trajectory of each fixture are checked beside it.
import assert from "node:assert/strict";
import { toEvalRow, toMiniSweTrajectory } from "@buildanagent/evals";
import { totalInput } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { CASE_NAMES, type CaseName, loadCase, type RecordedCase } from "./capstone.js";
import { rerun } from "./triage.js";

/**
 * The entries with the header's release fields blanked, as the harness's capstone test blanks them, so a version
 * bump or a new SDK capability alone does not fail the replay.
 */
const unreleased = (entries: readonly SessionEntry[]) =>
  entries.map((entry) =>
    entry.type === "session_header" ? { ...entry, sdkVersion: "*", defaultsHash: "*", capabilities: ["*"] } : entry,
  );

/** Runs the case again on its pairs and compares every entry with the fixture's. */
async function replay(name: CaseName, recorded: RecordedCase): Promise<void> {
  const written = await rerun(name, recorded.pairs);
  assert.deepEqual(unreleased(written), unreleased(recorded.entries), `${name}: the rerun's entries`);
}

const PRICE = 0.00135; // 200 input tokens at $3 and 50 output tokens at $15 per million

/** What each case's row and log must say, worked out from the capstone's script. */
// wallMs sums each turn's time, from its turn_start to its turn_end: 09:00:01.500 to 09:00:18.750 is 17,250 ms, and the
// resumed turn from 09:00:19.500 to 09:00:30.750 is 11,250 ms (to 09:00:30.500, 11,000 ms, when rejected, which
// writes one entry fewer).
const EXPECTED: Record<CaseName, { results: string[]; decisions: string[]; entries: number; wallMs: number }> = {
  approved: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    // The resume decides the escalation again, and the rule still asks; the approval in the log lets it run.
    decisions: ["lookup_customer:allow", "escalate:ask", "escalate:ask", "submit_triage:allow"],
    entries: 27,
    wallMs: 28_500,
  },
  rejected: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    decisions: ["lookup_customer:allow", "escalate:ask", "submit_triage:allow"],
    entries: 26,
    wallMs: 28_250,
  },
  policy_changed: {
    results: ["lookup_customer", "escalate", "submit_triage"],
    decisions: ["lookup_customer:allow", "escalate:ask", "escalate:deny", "submit_triage:allow"],
    entries: 27,
    wallMs: 28_500,
  },
};

describe("the recorded capstone sessions replay offline", () => {
  for (const name of CASE_NAMES) {
    test(`${name}: a rerun on the recorded pairs writes every entry of the fixture`, async () => {
      await replay(name, loadCase(name));
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
        wallMs: EXPECTED[name].wallMs,
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

describe("the replay fails when any entry changes", () => {
  /** Replays the case with `from` replaced by `to` in its log, after checking the log holds `from` exactly once. */
  const fails = async (name: CaseName, from: string, to: string) => {
    const edited = loadCase(name, (log) => {
      assert.equal(log.split(from).length, 2, `${name}'s log holds ${from} once`);
      return log.replace(from, to);
    });
    await assert.rejects(() => replay(name, edited), /the rerun's entries/);
  };

  test("a changed tool result", () => fails("approved", '\\"openTickets\\":2', '\\"openTickets\\":3'));

  test("a changed model block", () => fails("approved", "so I'll page", "so I will page"));

  test("a changed usage entry", () =>
    fails(
      "rejected",
      '"total":0.00135,"basis":"catalog","currency":"USD","catalogAsOf":"2026-11-01"},"id":"t-11"',
      '"total":0.00136,"basis":"catalog","currency":"USD","catalogAsOf":"2026-11-01"},"id":"t-11"',
    ));

  test("a changed last tool result, which no model call reads", () =>
    fails("rejected", '"text":"triage recorded"', '"text":"triage filed"'));

  test("a changed approval reason, which no model call reads", () =>
    fails("rejected", '"reason":"not an outage"', '"reason":"not urgent"'));
});
