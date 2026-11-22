/**
 * The completion check: after a turn ends `done`, run the project's configured or discovered checks in the sandbox,
 * flag diff patterns that game them, and record both as a `completion_check` entry. It never changes the stop reason.
 */
export {
  type CompletionOutcome,
  type CompletionSettings,
  DEFAULT_CHECK_TIMEOUT_MS,
  DENIED_EXIT_CODE,
  runCompletionCheck,
  snapshotStart,
} from "./check.js";
export { DISCOVERED_SCRIPTS, HARNESS_CONFIG_PATH, type ResolvedChecks, resolveChecks } from "./checks.js";
export { flagChanges, isTestFile, MAX_FLAGS, type WorkspaceSnapshot } from "./flags.js";
export {
  gitSnapshotter,
  MAX_SNAPSHOT_FILE_BYTES,
  MAX_SNAPSHOT_FILES,
  type SnapshotOptions,
  type Snapshotter,
} from "./snapshot.js";
