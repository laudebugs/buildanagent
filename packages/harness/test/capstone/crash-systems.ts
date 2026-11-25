// The outside systems of the capstone's crash test, kept in files so they outlive a killed process: the effects ledger
// and a fake pager. The pager accepts a page by appending its effect key to a file, and a reconcile reads the file
// back. Only one process uses the files at a time (the test waits for the killed child before it resumes), so a read
// followed by a write is atomic enough here; a real store must make each method one atomic step.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  type EffectRecord,
  type EffectStore,
  guardedWrite,
  type WriteOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";
import type { Harness } from "@buildanagent/harness/server";
import { effectScope, type Session } from "@buildanagent/harness/session";
import type { TriageDeps } from "../../examples/triage-tools.js";

/** An `EffectStore` in one JSON file. */
export function fileEffectStore(path: string): EffectStore {
  const read = (): Record<string, EffectRecord> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, EffectRecord>) : {};
  const write = (records: Record<string, EffectRecord>) => writeFileSync(path, JSON.stringify(records));
  return {
    async begin(record) {
      const records = read();
      const existing = records[record.key];
      if (existing !== undefined) return { existing };
      write({ ...records, [record.key]: record });
      return "started";
    },
    async takeOver(record) {
      const records = read();
      const stored = records[record.key];
      if (stored !== undefined && stored.attempt !== record.attempt - 1) return { existing: stored };
      write({ ...records, [record.key]: record });
      return "started";
    },
    async settle(record) {
      const records = read();
      const stored = records[record.key];
      if (stored?.state !== "started" || stored.attempt !== record.attempt) return false;
      write({ ...records, [record.key]: record });
      return true;
    },
    async get(key) {
      return read()[key];
    },
  };
}

/** The effect keys the pager has accepted, one per page. */
export const pagesIn = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];

const applied = (key: string): WriteOutcome =>
  writeOutcome({ kind: "applied", operation: "escalate", effectKey: key, retry: "never", next: "Tell the customer." });

/** How long an attempt counts as live. The resume starts after it, so it takes the crashed attempt over. */
export const LEASE_MS = 200;

/**
 * The escalate dependency over the files: a guarded write whose key comes from the session, the harness and the call,
 * and whose reconcile asks the pager whether it already holds the key. `onAccepted` runs once the pager has the page,
 * before the write's record is settled, which is where the test kills the process.
 */
export function guardedPager(options: {
  readonly target: { session?: Session; harness?: Harness<never> };
  readonly effects: string;
  readonly pager: string;
  readonly onAccepted?: () => Promise<void>;
}): TriageDeps["escalate"] {
  const store = fileEffectStore(options.effects);
  return async (reason, callId) => {
    const scope = effectScope(options.target.session as Session, options.target.harness as never, callId);
    const outcome = await guardedWrite({
      store,
      scope,
      businessKey: `escalate:${reason}`,
      operation: "escalate",
      input: { reason },
      dedupe: "reconcile",
      leaseMs: LEASE_MS,
      async run(key) {
        appendFileSync(options.pager, `${key}\n`);
        await options.onAccepted?.();
        return key;
      },
      toOutcome: (_result, key) => applied(key),
      reconcile: async (key) => (pagesIn(options.pager).includes(key) ? applied(key) : "not_found"),
    });
    return { text: `escalation ${outcome.kind}`, receipt: { outcome } };
  };
}
