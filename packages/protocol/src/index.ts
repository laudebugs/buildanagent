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
  McpServerRecord,
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
export type { ProtocolErrorCode, ProtocolErrorOptions } from "./errors.js";
export { isProtocolError, ProtocolError } from "./errors.js";

export type { FramedMessage, JsonlFramerOptions } from "./framer.js";
export { DEFAULT_MAX_LINE_BYTES, JsonlFramer } from "./framer.js";
export type { JsonRpcMessage } from "./jsonrpc.js";
export {
  CLIENT_METHODS,
  decode,
  ErrorCodes,
  EXPERIMENTAL_METHODS,
  encode,
  SERVER_NOTIFICATION_METHODS,
  SERVER_REQUEST_METHODS,
} from "./jsonrpc.js";
export type {
  ApprovalList,
  BranchResult,
  ClientCommand,
  ClientInfo,
  ClientMessage,
  ClientResultMap,
  Disposition,
  HarnessEvent,
  Id,
  InitializeResult,
  InterruptResult,
  ProtocolMessage,
  ResponseMessage,
  RpcError,
  ServerMessage,
  ServerNotification,
  ServerRequest,
  ServerResultMap,
  SessionList,
  SessionListItem,
  SessionOpened,
  TurnResultSummary,
} from "./messages.js";

/** The package's name. */
export const PACKAGE_NAME = "@buildanagent/protocol";
