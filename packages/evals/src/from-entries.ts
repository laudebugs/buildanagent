/**
 * What a session log says about one trial: its spend, its steps, its approval prompts and how it ended. `toEvalRow()`
 * and `toMiniSweTrajectory()` read the log the same way, so a row and a trajectory of one session agree.
 */
import { addUsage, emptyUsage, type Usage } from "@buildanagent/gateway";
import type { SessionEntry, TurnEndEntry, UsageEntry } from "@buildanagent/protocol";
import { EvalsError } from "./errors.js";
import { checkRow, type EvalExit, type EvalRow, type UnscoredReason } from "./row.js";

/** The agent's spend in a log: its calls, their tokens and their cost, `null` once any price is unknown. */
export interface Spend {
  readonly calls: number;
  readonly usage: Usage;
  readonly costUsd: number | null;
}

/**
 * The agent's own calls: model steps and context summaries. A `judge` call grades the trial and is not part of what
 * the agent spent, so a row compares with mini-swe-agent's `instance_cost`, which counts the agent's calls only.
 */
export const isAgentUsage = (entry: SessionEntry): entry is SessionEntry & UsageEntry =>
  entry.type === "usage" && entry.source !== "judge";

/** Sums the agent's usage entries. */
export function spendOf(entries: readonly SessionEntry[]): Spend {
  let usage = emptyUsage();
  let costUsd: number | null = 0;
  let calls = 0;
  for (const entry of entries) {
    if (!isAgentUsage(entry)) continue;
    calls++;
    usage = addUsage(usage, entry.usage);
    costUsd = costUsd === null || entry.cost.total === null ? null : costUsd + entry.cost.total;
  }
  return { calls, usage, costUsd };
}

/** The last `turn_end` of the log, or `undefined` when no turn has ended. */
export function lastTurnEnd(entries: readonly SessionEntry[]): (SessionEntry & TurnEndEntry) | undefined {
  return entries.findLast((entry): entry is SessionEntry & TurnEndEntry => entry.type === "turn_end");
}

/** How a turn's stop reason reads in an eval: a row's exit, or a turn that has not finished. */
export type StopClass = EvalExit | "unfinished";

/**
 * Classifies a run's stop reason, so a row's `exit` and a trajectory's `exit_status` always agree. `done` is
 * `submitted`. `max_steps`, `budget` and `no_progress` are the step, budget and progress limits. `aborted` is a
 * limit too: in an eval the runner aborts a trial only at its time limit. `stopped` is a limit as well, because a
 * host hook that stops the run, such as a spend guard, ends it as a limit would, before the agent hands anything
 * in. `error` is an infra error: a failed model call or hook says nothing about the agent's choices. A run paused
 * for an approval or an answer has not finished.
 */
export function classifyStop(stopReason: TurnEndEntry["stopReason"]): StopClass {
  switch (stopReason) {
    case "done":
      return "submitted";
    case "max_steps":
    case "budget":
    case "no_progress":
    case "aborted":
    case "stopped":
      return "limit";
    case "error":
      return "infra_error";
    case "awaiting_approval":
    case "clarification_requested":
      return "unfinished";
    default: {
      // A stop reason the SDK adds later fails the type check here until it is classified.
      const unknown: never = stopReason;
      throw new EvalsError("unfinished_session", `unknown stop reason ${String(unknown)}`);
    }
  }
}

function exitOf(end: TurnEndEntry | undefined): EvalExit {
  const kind = end === undefined ? "unfinished" : classifyStop(end.stopReason);
  if (kind === "unfinished") {
    throw new EvalsError(
      "unfinished_session",
      `the session's last turn ${end === undefined ? "never ended" : `ended ${end.stopReason}`}, so it has no outcome`,
    );
  }
  return kind;
}

/**
 * The time the agent's turns ran: from each `turn_start` to the `turn_end` of the same run, summed. A resumed
 * session's wait for a person's approval falls between two turns, so it is not counted, and a trial that paused
 * compares with one that did not.
 */
function turnTimeOf(entries: readonly SessionEntry[]): number {
  const started = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    if (entry.type === "turn_start") started.set(entry.runId, Date.parse(entry.timestamp));
    else if (entry.type === "turn_end") {
      const start = started.get(entry.runId);
      if (start !== undefined) total += Date.parse(entry.timestamp) - start;
    }
  }
  return total;
}

/** What a log cannot say about a trial: which task and trial it was, who ran it, and the grader's verdict. */
export interface EvalRowMeta {
  /** The task's id. */
  readonly task: string;
  /** Which attempt at the task this is, from 0. */
  readonly trial: number;
  /** Which harness ran it, such as `"ours"`. */
  readonly harness: string;
  /** The ablation it ran under, or `"none"`. */
  readonly ablation: string;
  /** The preamble's size in tokens, such as the tool registry's `preambleTokens()` for the run's system prompt. */
  readonly preambleTokens: number;
  /** The grader's verdict, or `null` when it could not decide; ignored when the run ended in an infra error. */
  readonly passed: boolean | null;
  /** Why `passed` is `null`. */
  readonly unscored?: UnscoredReason;
  /** The task's labels. */
  readonly tags?: readonly string[];
}

function gradeOf(meta: EvalRowMeta, exit: EvalExit): Pick<EvalRow, "passed" | "unscored"> {
  if (exit === "infra_error") return { passed: null, unscored: "infra_error" };
  return meta.unscored === undefined ? { passed: meta.passed } : { passed: meta.passed, unscored: meta.unscored };
}

/**
 * Builds the eval row of one trial from its session log and what the log cannot know. The log gives the cost and
 * tokens of the agent's model and summary calls (a judge's are left out), the steps of every turn, the approval
 * prompts and the wall time: each turn's time from its `turn_start` to its `turn_end`, summed, so time spent
 * waiting for a person between turns is left out. The last turn's stop reason gives `exit`: `done` is `"submitted"`,
 * `error` is `"infra_error"`, and `max_steps`, `budget`, `no_progress`, `aborted` and `stopped` are `"limit"`. A run
 * that ended in an infra error is ungraded whatever `meta.passed` says.
 *
 * Throws an `EvalsError`: `unfinished_session` when no turn has ended or the last one waits on a person, and
 * `invalid_row` when the row breaks a rule of `EvalRow`.
 */
export function toEvalRow(entries: readonly SessionEntry[], meta: EvalRowMeta): EvalRow {
  const end = lastTurnEnd(entries);
  const exit = exitOf(end);
  const spend = spendOf(entries);
  const row: EvalRow = {
    task: meta.task,
    trial: meta.trial,
    costUsd: spend.costUsd,
    tokens: spend.usage,
    ...gradeOf(meta, exit),
    steps: entries.reduce((sum, entry) => sum + (entry.type === "turn_end" ? entry.steps : 0), 0),
    preambleTokens: meta.preambleTokens,
    wallMs: turnTimeOf(entries),
    prompts: entries.filter((entry) => entry.type === "approval_requested").length,
    exit,
    harness: meta.harness,
    ...(meta.tags === undefined ? {} : { tags: meta.tags }),
    ablation: meta.ablation,
  };
  checkRow(row);
  return row;
}
