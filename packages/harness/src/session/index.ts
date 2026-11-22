/**
 * `@buildanagent/harness/session`: the session log. The entry union lives in `@buildanagent/protocol`, so the protocol
 * never imports the harness, and this entry re-exports it for code that already imports the harness. It holds the
 * store interface, `memoryStore()` and the read-only `secretKeyStore()`, and nothing that needs Node. `jsonlStore()` is in
 * `@buildanagent/harness/session/jsonl`.
 */

export type {
  ApprovalPolicy,
  CheckoutEntry,
  CodeCallEntry,
  CompactionEntry,
  CompletionCheckEntry,
  EntryBase,
  EnvStampEntry,
  ExtensionLoadedEntry,
  LoadoutEntry,
  MessageBlockEntry,
  MessageEndEntry,
  Origin,
  PermissionDecisionEntry,
  PermissionMode,
  ProductRecordEntry,
  ProtocolErrorCode,
  SandboxTier,
  SessionEntry,
  SessionHeaderEntry,
  ShadowCallEntry,
  SkillLoadedEntry,
  SubagentLinkEntry,
  ToolResultEntry,
  TurnEndEntry,
  TurnStartEntry,
  UsageEntry,
} from "@buildanagent/protocol";
export {
  FORMAT_VERSION,
  isProtocolError,
  ProtocolError,
  parseEntry,
  SESSION_ENTRY_TYPES,
} from "@buildanagent/protocol";
export {
  ABORTED_EXIT_CODE,
  type CheckConfig,
  type CompletionOutcome,
  type CompletionSettings,
  type CompletionStart,
  DEFAULT_CHECK_TIMEOUT_MS,
  DENIED_EXIT_CODE,
  DISCOVERED_SCRIPTS,
  flagChanges,
  gitSnapshotter,
  HARNESS_CONFIG_PATH,
  isTestFile,
  MAX_FLAGS,
  MAX_SNAPSHOT_FILE_BYTES,
  MAX_SNAPSHOT_FILES,
  type ResolvedChecks,
  resolveChecks,
  runCompletionCheck,
  SNAPSHOT_TIMEOUT_MS,
  type SnapshotOptions,
  type Snapshotter,
  snapshotStart,
  type WorkspaceSnapshot,
} from "../completion/index.js";
export {
  type Approvals,
  type ApprovalsOptions,
  createApprovals,
  oneResolution,
  type QuorumPolicy,
  type QuorumVerdict,
  quorumOf,
  type ResolveOptions,
} from "./approvals.js";
export { effectScope } from "./effect-scope.js";
export { ConflictError, EntryTooLargeError } from "./errors.js";
export type { LockHandle, SessionLock } from "./lock.js";
export { type MemoryStoreOptions, memoryStore } from "./memory-store.js";
export { type MigrateOptions, type Migration, type MigrationResult, migrateSession } from "./migrate.js";
export { memoryIndex, type SessionIndex } from "./pointer.js";
export type { PendingApproval } from "./rebuild.js";
export {
  type ClientToolCall,
  type ClientToolRunner,
  rerunFrom,
  runTurn,
  type TurnOptions,
  type TurnResult,
} from "./runner.js";
export {
  type ProcessScheduler,
  type ProcessSchedulerOptions,
  processScheduler,
  type Scheduler,
  type WakeHandler,
} from "./scheduler.js";
export {
  DEFAULT_PLATFORM_HINT,
  type KeyChangeOptions,
  pruneKeys,
  rotateKeys,
  type SecretKeyStoreOptions,
  secretKeyStore,
} from "./secret-key-store.js";
export {
  type ChildLink,
  DERIVED,
  isDerivedFile,
  listSessions,
  type OpenSessionOptions,
  openSession,
  Session,
} from "./session.js";
export {
  type AppendOptions,
  DEFAULT_MAX_ENTRY_BYTES,
  type EntryInput,
  type LoadOptions,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
} from "./store.js";
