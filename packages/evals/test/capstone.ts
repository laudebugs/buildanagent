// The harness capstone's recorded sessions, read as offline replay fixtures. packages/harness/test/capstone.test.ts
// writes them (CAPSTONE_FIXTURES=write) and fails when a fresh recording differs from them, so the copy read here is
// always the one the harness produces today. They are data files, read by path rather than imported, so this package
// takes no dependency on the harness's test code; the dependency-cruiser rule covers imports only.
import { readFileSync } from "node:fs";
import type { PriceCatalog } from "@buildanagent/gateway";
import { parseEntry, type SessionEntry } from "@buildanagent/protocol";
import type { RecordedPair } from "@buildanagent/sdk/testing";

const FIXTURES = new URL("../../harness/test/fixtures/capstone/", import.meta.url);

/** The capstone's three cases. */
export const CASE_NAMES = ["approved", "rejected", "policy_changed"] as const;
export type CaseName = (typeof CASE_NAMES)[number];

/** The key the capstone writes its session under. */
export const KEY = { userId: "ada", sessionId: "triage" };

/**
 * The capstone's own price, copied from packages/harness/test/capstone/triage-fixture.ts: the replayed calls are
 * priced from it, so their cost must match the recorded `usage` entries.
 */
const PRICE_SOURCE = "https://provider.test/pricing";
export const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "triage-priced",
      rates: [
        { uncachedInput: 3, cacheRead: 0.3, cacheWrite: { "5m": 3.75, "1h": 6 }, output: 15, upToInputTokens: null },
      ],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: PRICE_SOURCE, contextWindow: PRICE_SOURCE, maxOutputTokens: PRICE_SOURCE },
    },
  ],
};

/** One recorded case: its session entries and the model calls of its first process and of the one that resumed it. */
export interface RecordedCase {
  readonly entries: SessionEntry[];
  readonly pairs: { readonly start: RecordedPair[]; readonly resume: RecordedPair[] };
}

/**
 * Reads one case from the fixture files. `edit` may change the log's text first, so a test can show that the
 * suite fails when an entry changes.
 */
export function loadCase(name: CaseName, edit: (log: string) => string = (log) => log): RecordedCase {
  const log = edit(readFileSync(new URL(`${name}.jsonl`, FIXTURES), "utf8"));
  const entries = log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseEntry(line));
  const recorded = JSON.parse(readFileSync(new URL(`${name}.pairs.json`, FIXTURES), "utf8")) as {
    start: RecordedPair[];
    resume: RecordedPair[];
  };
  return { entries, pairs: recorded };
}
