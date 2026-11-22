/**
 * The completion check: after a turn ends `done`, the harness runs the project's checks inside the sandbox and diffs the
 * workspace against the turn's start state. The result is recorded as a `completion_check` entry and never changes the
 * turn's stop reason, because the model's claim is checked in code but the person decides what a failure means.
 */
import type { CompletionCheckEntry } from "@buildanagent/protocol";
import type { Sandbox } from "../sandbox/types.js";
import { resolveChecks } from "./checks.js";
import { flagChanges, type WorkspaceSnapshot } from "./flags.js";
import { gitSnapshotter, type Snapshotter } from "./snapshot.js";

/** How long one check may run before it is stopped with exit code 124. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/** The exit code recorded for a check that the sandbox's policy refused to run. */
export const DENIED_EXIT_CODE = 126;

/** The exit code recorded for a check that never finished because the turn's signal aborted (130, as for SIGINT). */
export const ABORTED_EXIT_CODE = 130;

/** What a turn needs to check its own completion. */
export interface CompletionSettings {
  /** The session's sandbox: the checks run in it, and its files are diffed. */
  readonly sandbox: Sandbox;
  /** The whole environment of each check, built with `spawnEnv()`. */
  readonly env: Readonly<Record<string, string>>;
  /** The longest one check may run, in milliseconds. Default 10 minutes. */
  readonly timeoutMs?: number;
  /** How the workspace is snapshotted for the diff. Default `gitSnapshotter`. */
  readonly snapshotter?: Snapshotter;
}

/** What a check found: the body of the `completion_check` entry. */
export type CompletionOutcome = Omit<CompletionCheckEntry, "type">;

/**
 * Takes a snapshot. `undefined` means the workspace can't be diffed, which also covers a signal that aborted the
 * snapshot, because a completion check must never throw for an abort. `earlier` is the start state when this is the end.
 */
async function snapshotWorkspace(
  settings: CompletionSettings,
  signal: AbortSignal,
  earlier?: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot | undefined> {
  const snapshotter = settings.snapshotter ?? gitSnapshotter;
  try {
    return await snapshotter(settings.sandbox, {
      env: settings.env,
      signal,
      ...(earlier === undefined ? {} : { known: new Set(earlier.files.keys()), skipped: earlier.skipped }),
    });
  } catch (error) {
    if (signal.aborted) return undefined;
    throw error;
  }
}

/** Takes the turn's start state, once, before the run. `undefined` means the workspace can't be diffed. */
export function snapshotStart(
  settings: CompletionSettings,
  signal: AbortSignal,
): Promise<WorkspaceSnapshot | undefined> {
  return snapshotWorkspace(settings, signal);
}

async function runChecks(
  settings: CompletionSettings,
  commands: readonly (readonly string[])[],
  signal: AbortSignal,
): Promise<{ checks: CompletionOutcome["checks"]; denials: string[] }> {
  const checks: CompletionOutcome["checks"] = [];
  const denials: string[] = [];
  for (const command of commands) {
    const text = command.join(" ");
    let result: Awaited<ReturnType<Sandbox["exec"]>>;
    try {
      result = await settings.sandbox.exec(command, {
        env: settings.env,
        signal,
        timeoutMs: settings.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
      });
    } catch (error) {
      if (!signal.aborted) throw error;
      // An abort rejects the running check and every one after it. Each is recorded, so the entry shows what never ran.
      checks.push({ command: text, exitCode: ABORTED_EXIT_CODE });
      denials.push(`check aborted before it finished: ${text}`);
      continue;
    }
    if ("denied" in result) {
      checks.push({ command: text, exitCode: DENIED_EXIT_CODE });
      denials.push(`check refused by the sandbox: ${text}: ${result.denied.reason}`);
    } else {
      checks.push({ command: text, exitCode: result.exitCode });
    }
  }
  return { checks, denials };
}

/**
 * Runs the project's checks in the sandbox, one after another and all of them even when one fails, and compares the
 * workspace with `start`, the snapshot taken before the turn. `passed` is true when every check exited 0, and so it is
 * also true when the project has no checks; `checks` is then empty. A check that timed out has exit code 124, and one the
 * sandbox's policy refused has `DENIED_EXIT_CODE` and a flag that names the refusal. When `signal` aborts, the check
 * running and each one after it has `ABORTED_EXIT_CODE` and a flag, no diff is made, and the call still returns. `flagged` holds the diff patterns
 * and is empty when `start` is `undefined`.
 * Throws a `HarnessError` with code `invalid_completion_config` when `.agents/harness.json` is unusable.
 */
export async function runCompletionCheck(
  settings: CompletionSettings,
  start: WorkspaceSnapshot | undefined,
  signal: AbortSignal,
): Promise<CompletionOutcome> {
  const { commands } = await resolveChecks(settings.sandbox);
  const { checks, denials } = await runChecks(settings, commands, signal);
  // The checks ran first, so what they wrote (a build, a coverage report) is in the end state; git ignores most of it.
  const end = start === undefined ? undefined : await snapshotWorkspace(settings, signal, start);
  const flagged = start === undefined || end === undefined ? [] : flagChanges(start, end);
  return {
    checks,
    passed: checks.every((check) => check.exitCode === 0),
    flagged: [...denials, ...flagged],
  };
}
