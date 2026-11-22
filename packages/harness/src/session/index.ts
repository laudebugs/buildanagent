/**
 * `@buildanagent/harness/session`: the session log. The entry union lives in `@buildanagent/protocol`, so the protocol
 * never imports the harness, and this entry re-exports it for code that already imports the harness.
 */
export type {
  ApprovalPolicy,
  CheckoutEntry,
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
