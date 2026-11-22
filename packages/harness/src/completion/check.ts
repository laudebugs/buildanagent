/**
 * The completion check: after a turn ends `done`, the harness runs the project's checks inside the sandbox and diffs the
 * workspace against the turn's start state. The result is recorded as a `completion_check` entry and never changes the
 * turn's stop reason, because the model's claim is checked in code but the person decides what a failure means.
 */
import type { CompletionCheckEntry } from "@buildanagent/protocol";
import type { Sandbox } from "../sandbox/types.js";
import {
  type CheckConfig,
  configChanges,
  type ResolvedChecks,
  readCheckConfig,
  resolveChecks,
  scriptNamesOf,
} from "./checks.js";
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

/**
 * What a turn recorded before the model ran. The checks are resolved here, so a turn that edits `.agents/harness.json`
 * can't change which commands run, and the check config is kept so an edit to it is flagged.
 */
export interface CompletionStart {
  /** The workspace, or `undefined` when it can't be diffed. */
  readonly workspace: WorkspaceSnapshot | undefined;
  /** The checks that will run, or `undefined` when they could not be resolved; `failures` then says why. */
  readonly checks: ResolvedChecks | undefined;
  /** The check config's text, or `undefined` when it could not be read. */
  readonly config: CheckConfig | undefined;
  /** One flag for each part of the start state that could not be taken. */
  readonly failures: readonly string[];
}

/** The flag for a completion check that could not do its work, for whatever reason `error` gives. */
export function completionFailure(error: unknown): string {
  return `completion check failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Takes the turn's start state, once, before the run: it resolves the checks, reads the check config and snapshots the
 * workspace. It never throws. What it could not take is recorded in `failures`, and the turn still runs.
 */
export async function snapshotStart(settings: CompletionSettings, signal: AbortSignal): Promise<CompletionStart> {
  const failures: string[] = [];
  let checks: ResolvedChecks | undefined;
  let config: CheckConfig | undefined;
  let workspace: WorkspaceSnapshot | undefined;
  try {
    checks = await resolveChecks(settings.sandbox);
  } catch (error) {
    failures.push(completionFailure(error));
  }
  try {
    config = await readCheckConfig(settings.sandbox, scriptNamesOf(checks?.commands ?? []));
  } catch (error) {
    failures.push(completionFailure(error));
  }
  try {
    workspace = await snapshotWorkspace(settings, signal);
  } catch (error) {
    failures.push(completionFailure(error));
  }
  return { workspace, checks, config, failures };
}

function abortedCheck(text: string, checks: CompletionOutcome["checks"], denials: string[]): void {
  checks.push({ command: text, exitCode: ABORTED_EXIT_CODE });
  denials.push(`check aborted before it finished: ${text}`);
}

/** Records one check's result. A check the signal aborted counts as aborted, whatever the sandbox returned for it. */
function recordResult(
  text: string,
  result: Awaited<ReturnType<Sandbox["exec"]>>,
  signal: AbortSignal,
  checks: CompletionOutcome["checks"],
  denials: string[],
): void {
  if (signal.aborted) abortedCheck(text, checks, denials);
  else if ("denied" in result) {
    checks.push({ command: text, exitCode: DENIED_EXIT_CODE });
    denials.push(`check refused by the sandbox: ${text}: ${result.denied.reason}`);
  } else {
    checks.push({ command: text, exitCode: result.exitCode });
  }
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
    // A check after the abort is recorded without being started, whatever the sandbox does with an aborted signal.
    if (signal.aborted) {
      abortedCheck(text, checks, denials);
      continue;
    }
    try {
      const result = await settings.sandbox.exec(command, {
        env: settings.env,
        signal,
        timeoutMs: settings.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
      });
      recordResult(text, result, signal, checks, denials);
    } catch (error) {
      if (!signal.aborted) throw error;
      abortedCheck(text, checks, denials);
    }
  }
  return { checks, denials };
}

/** The flags for what the turn changed in the check config, or a failure flag when it can't be read again. */
async function configFlags(sandbox: Sandbox, before: CheckConfig | undefined): Promise<string[]> {
  if (before === undefined) return [];
  try {
    return configChanges(before, await readCheckConfig(sandbox, [...before.scripts.keys()]));
  } catch (error) {
    return [completionFailure(error)];
  }
}

/** The diff flags against the start's workspace, none after an abort, or a failure flag when the end snapshot throws. */
async function diffFlags(settings: CompletionSettings, start: WorkspaceSnapshot | undefined, signal: AbortSignal) {
  if (start === undefined || signal.aborted) return [];
  try {
    const end = await snapshotWorkspace(settings, signal, start);
    return end === undefined ? [] : flagChanges(start, end);
  } catch (error) {
    return [completionFailure(error)];
  }
}

/**
 * Runs the checks `start` resolved before the turn, in the sandbox, one after another and all of them even when one
 * fails, and compares the workspace and the check config with `start`. `passed` is true when every check exited 0, and
 * so it is also true when the project has no checks; `checks` is then empty. `passed` is false when the checks could
 * not be resolved before the turn. A check that timed out has exit code 124, and one the sandbox's policy refused has
 * `DENIED_EXIT_CODE` and a flag that names the refusal. When `signal` aborts, the check running and each one after it
 * has `ABORTED_EXIT_CODE` and a flag, no diff is made, and the call still returns. `flagged` holds, in order, the
 * start's failures, the refusals and aborts, a `check config changed` flag for each part of the check config the turn
 * edited, and the diff patterns.
 *
 * With `start` `undefined`, the checks are resolved now and nothing is compared; that throws a `HarnessError` with code
 * `invalid_completion_config` when `.agents/harness.json` is unusable. A sandbox error from a check throws.
 */
export async function runCompletionCheck(
  settings: CompletionSettings,
  start: CompletionStart | undefined,
  signal: AbortSignal,
): Promise<CompletionOutcome> {
  const resolved = start === undefined ? await resolveChecks(settings.sandbox) : start.checks;
  const { checks, denials } =
    resolved === undefined ? { checks: [], denials: [] } : await runChecks(settings, resolved.commands, signal);
  // The checks ran first, so what they wrote (a build, a coverage report) is in the end state; git ignores most of it.
  const changed = await configFlags(settings.sandbox, start?.config);
  const diff = await diffFlags(settings, start?.workspace, signal);
  return {
    checks,
    passed: resolved !== undefined && checks.every((check) => check.exitCode === 0),
    flagged: [...(start?.failures ?? []), ...denials, ...changed, ...diff],
  };
}
