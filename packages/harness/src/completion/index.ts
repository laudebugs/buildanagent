/**
 * The completion check: after a turn ends `done`, run the project's configured or discovered checks in the sandbox,
 * flag diff patterns that game them, and record both as a `completion_check` entry. It never changes the stop reason.
 */
export {
  ABORTED_EXIT_CODE,
  type CompletionOutcome,
  type CompletionSettings,
  type CompletionStart,
  DEFAULT_CHECK_TIMEOUT_MS,
  DENIED_EXIT_CODE,
  runCompletionCheck,
  snapshotStart,
} from "./check.js";
export {
  type CheckConfig,
  DISCOVERED_SCRIPTS,
  HARNESS_CONFIG_PATH,
  type ResolvedChecks,
  resolveChecks,
} from "./checks.js";
export { flagChanges, isTestFile, MAX_FLAGS, type WorkspaceSnapshot } from "./flags.js";
export {
  gitSnapshotter,
  MAX_SNAPSHOT_FILE_BYTES,
  MAX_SNAPSHOT_FILES,
  SNAPSHOT_TIMEOUT_MS,
  type SnapshotOptions,
  type Snapshotter,
} from "./snapshot.js";
