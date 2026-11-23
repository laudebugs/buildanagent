// A chat that outgrows its context budget. At the start of the next turn the context policy asks the model for a
// summary of the older messages and writes it as a `compaction` entry. The next request reads the summary and the
// newest messages instead of the whole chat, and the log keeps every original entry.
import type { Model } from "@buildanagent/gateway";
import { createContextPolicy, type SpillStore } from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import {
  openSession,
  runTurn,
  type Session,
  type SessionIndex,
  type SessionKey,
  type SessionLock,
  type SessionStore,
} from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";

// A small budget, so two long questions fill it. A real agent keeps the default, which is the model's window less
// 16,384 tokens, at most 200,000.
const BUDGET_TOKENS = 2_000;
const TAIL_TOKENS = 300;

/** Where a session's log lives. */
export interface Log {
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly lock: SessionLock;
}

/**
 * What the summary replaced. `replacedEntries` counts the log entries of every type (headers, turn starts, messages,
 * usage records) that come before the first kept one; they stay in the log, but the next request no longer reads them.
 */
export interface CompactionReport {
  readonly summary: string;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly replacedEntries: number;
  readonly logEntries: number;
}

// #region report
async function reportOn(session: Session): Promise<CompactionReport | undefined> {
  const entries = [];
  for await (const entry of session.playback()) entries.push(entry);
  // The latest compaction is the one the next request reads; an earlier one is already folded into its summary.
  const compaction = entries.findLast((entry) => entry.type === "compaction");
  if (compaction === undefined) return undefined;
  const { summary, tokensBefore, tokensAfter, firstKeptEntryId } = compaction;
  const replacedEntries = entries.findIndex((entry) => entry.id === firstKeptEntryId);
  if (replacedEntries === -1) throw new Error(`The compaction keeps entry ${firstKeptEntryId}, which the log lacks.`);
  return { summary, tokensBefore, tokensAfter, replacedEntries, logEntries: entries.length };
}
// #endregion

/**
 * Asks each question in one session, and reports the latest compaction that the longer chat caused, if one happened.
 */
export async function chatWithCompaction(
  log: Log,
  model: Model,
  spill: SpillStore,
  key: SessionKey,
  questions: readonly string[],
): Promise<CompactionReport | undefined> {
  // #region policy
  const context = createContextPolicy({
    spill,
    budgetTokens: BUDGET_TOKENS,
    summarize: { tailTokens: TAIL_TOKENS, focus: "file names and error messages" },
  });
  const harness = createHarness({ registry: createToolRegistry(), model, system: "You help.", context });
  // #endregion
  // #region run
  const session = await openSession({ ...log, key });
  try {
    for (const input of questions) await runTurn(session, harness, { input });
    return await reportOn(session);
  } finally {
    await session.close();
  }
  // #endregion
}
