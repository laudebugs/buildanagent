/** `@buildanagent/protocol`, the wire types of the buildanagent harness: the session entry union, the client and server messages and their JSONL framing. */
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
} from "./entries.js";
export { FORMAT_VERSION, parseEntry, SESSION_ENTRY_TYPES } from "./entries.js";
export type { ProtocolErrorCode } from "./errors.js";
export { isProtocolError, ProtocolError } from "./errors.js";

/** The package's name. */
export const PACKAGE_NAME = "@buildanagent/protocol";
