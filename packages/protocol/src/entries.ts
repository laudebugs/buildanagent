/**
 * The session log's entry union: every line of a session file is one `SessionEntry`. The log is an append-only tree,
 * so each entry names its parent. `EntryBase`, the entry type names and `formatVersion` are the stable surface that a
 * tool you write may rely on; every other field is documented but may change with a `formatVersion` bump, which ships
 * with a migration that writes a new file. The JSON Schema of the union is `schema/session-entry.schema.json`.
 */
import type { AssistantMessage, ContentBlock, Cost, ModelContent, ModelRef, Usage } from "@buildanagent/gateway";
import type { Resolution, RunResult, SignedPendingRequest } from "@buildanagent/sdk";
import { ProtocolError } from "./errors.js";

/** The format version of every entry this package writes and reads. A session file's header carries it. */
export const FORMAT_VERSION = 1;

/** Who produced an entry's content. One label per entry, so one block of a message has one origin. */
export type Origin = "user" | "operator" | "model" | "tool" | "harness";

/** How tool calls are decided: `shadow` records what would have happened without doing it. */
export type PermissionMode = "default" | "accept_edits" | "read_only" | "bypass" | "shadow";

/** When a sandboxed call may ask a person: on request, by granular rule, or never. */
export type ApprovalPolicy = "on-request" | "granular" | "never";

/** How strongly a sandbox isolates a run, from none to a micro-VM. */
export type SandboxTier = "none" | "os" | "container" | "gvisor" | "microvm";

/** The fields every entry has, with its `type`. All six are stable, and each carries a `@stable` tag. */
export interface EntryBase {
  /** The entry's id, unique within its session. Appending the same id twice changes nothing. @stable */
  id: string;
  /** The entry this one follows, or `null` for the first entry of a session. @stable */
  parentId: string | null;
  /** Position in the file, from 0 and rising by 1. @stable */
  seq: number;
  /** When the entry was written, as an ISO 8601 string. @stable */
  timestamp: string;
  /** Who produced the content. @stable */
  origin: Origin;
}

/** The first entry of a session file: what ran the session, and which session it came from. */
export interface SessionHeaderEntry {
  /** The entry type name. @stable */
  type: "session_header";
  /** `FORMAT_VERSION`. A reader refuses a file with another value. @stable */
  formatVersion: 1;
  harnessVersion: string;
  sdkVersion: string;
  /** The SDK's `DEFAULTS_HASH` for the run, so a change in behavior shows whether defaults moved. */
  defaultsHash: string;
  /** The SDK's capability strings. */
  capabilities: string[];
  /** A hash of the ablation switches this session ran with. */
  ablationHash: string;
  /**
   * The session and entry this one was forked from, or, when `spawn` is present, the session and `subagent_link` entry
   * that started it. A forked session continues its parent's log up to that entry, and a spawned one does not.
   */
  parent?: { session: string; entryId: string };
  /** Set on the log of a subagent or a workflow step: the tool call or the step that started it, never both. */
  spawn?: { spawningCallId: string; stepId?: never } | { stepId: string; spawningCallId?: never };
  /** The product that owns the session, when one does. Outside the stable surface. */
  product?: { name: string; version: string; bundleHash: string };
}

/** A turn began. `system` is the frozen system prompt, byte for byte, so a rebuilt context carries it. */
export interface TurnStartEntry {
  /** The entry type name. @stable */
  type: "turn_start";
  runId: string;
  mode: "run" | "continue";
  system: string;
}

/** One content block of a message. A message is several of these, in `index` order, closed by a `message_end`. */
export interface MessageBlockEntry {
  /** The entry type name. @stable */
  type: "message_block";
  messageId: string;
  role: "user" | "assistant";
  index: number;
  block: ContentBlock;
  /** How a user message reached the run, when it did not start it. */
  delivery?: "input" | "steer" | "follow_up";
}

/** A message is complete: which model wrote it and why it stopped. */
export interface MessageEndEntry {
  /** The entry type name. @stable */
  type: "message_end";
  messageId: string;
  model: ModelRef;
  stopReason: AssistantMessage["stopReason"];
  error?: AssistantMessage["error"];
}

/** What a tool call returned to the model. */
export interface ToolResultEntry {
  /** The entry type name. @stable */
  type: "tool_result";
  callId: string;
  tool: string;
  content: ModelContent[];
  isError: boolean;
  details?: unknown;
  /** Where the full output went when it was too large to keep in the entry. */
  spill?: { path: string; bytes: number };
  /** Whether the tool's output may carry instructions an attacker wrote. */
  trust: "trusted" | "untrusted";
}

/**
 * A tool call that the host's own code chose to make, with no model step. It is written before the permission pipeline
 * decides the call, and its id is the call's id, so the call's effect key can be derived from it before the tool runs.
 * The model never reads a code call or its result.
 */
export interface CodeCallEntry {
  /** The entry type name. @stable */
  type: "code_call";
  /** The call's id, which the call's `permission_decision`, `approval_requested` and `tool_result` entries name. */
  callId: string;
  /** The tool's canonical name. */
  tool: string;
  /** The input the call runs with. */
  input: unknown;
  /** `canonicalInputHash()` of `input`, which a resume checks before the call runs. */
  inputHash: string;
  /** The id of the earlier code call this one compensates, when it undoes one. */
  compensates?: string;
}

/** The permission pipeline's decision on one tool call, written for every decision. */
export interface PermissionDecisionEntry {
  /** The entry type name. @stable */
  type: "permission_decision";
  callId: string;
  tool: string;
  decision: "allow" | "deny" | "ask";
  /** The rule that decided, when one did. */
  rule?: string;
  /** Who decided, when a person or a hook did. */
  by?: string;
  policyVersion: string;
  /** The hash of the input the decision covers. */
  inputHash: string;
}

/** The tokens and cost of one model call, a summary or a judge call. `cost.total` is `null` when the price is unknown. */
export interface UsageEntry {
  /** The entry type name. @stable */
  type: "usage";
  source: "model_call" | "summary" | "judge";
  usage: Usage;
  /** The usage of the last attempt alone, when a retry made `usage` a sum. A rebuilt message carries it back. */
  lastAttemptUsage?: Usage;
  cost: Cost;
}

/** A turn ended, with the stop reason of its run. */
export interface TurnEndEntry {
  /** The entry type name. @stable */
  type: "turn_end";
  runId: string;
  stopReason: RunResult<unknown>["stopReason"];
  steps: number;
}

/** HEAD moved to another entry. The log persists HEAD as an entry, so a restart finds it. */
export interface CheckoutEntry {
  /** The entry type name. @stable */
  type: "checkout";
  headId: string;
}

/** A summary replaced older entries in the context a rebuilt run sends. */
export interface CompactionEntry {
  /** The entry type name. @stable */
  type: "compaction";
  layer: "summarize" | "mid_turn" | "overflow_retry";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  tokensAfter: number;
  model: ModelRef;
  promptVersion: string;
  /** The `usage` entry that records the summary call's cost. */
  usageEntryId: string;
  focus?: string;
}

/** The environment a session ran in. */
export interface EnvStampEntry {
  /** The entry type name. @stable */
  type: "env_stamp";
  cwd: string;
  permissionMode: PermissionMode;
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxTier;
  model: ModelRef;
  effort?: string;
}

/** The tools and model in force changed. */
export interface LoadoutEntry {
  /** The entry type name. @stable */
  type: "loadout";
  tools: string[];
  model?: ModelRef;
  effort?: string;
}

/** The commands that checked a finished task, and whether they passed. */
export interface CompletionCheckEntry {
  /** The entry type name. @stable */
  type: "completion_check";
  checks: Array<{ command: string; exitCode: number }>;
  passed: boolean;
  flagged: string[];
}

/** A skill's instructions entered the context. */
export interface SkillLoadedEntry {
  /** The entry type name. @stable */
  type: "skill_loaded";
  name: string;
  path: string;
}

/**
 * What an `extension_loaded` entry of tier `mcp` records about the server that connected. It holds hashes, never the
 * command's arguments or any environment value, because either can carry a secret.
 */
export interface McpServerRecord {
  /** How the harness reached the server. */
  transport: "stdio" | "in_process";
  /**
   * For a stdio server: `sha256:` and the hex digest of the canonical JSON (RFC 8785) of `[command, ...args]`. It is not
   * salted, so a reader of the log can confirm a guessed argument by hashing it; a secret never belongs in the args.
   */
  commandHash?: string;
  /** The protocol era the server negotiated. */
  era: "2026-07-28" | "legacy";
  /**
   * `sha256:` and the hex digest of the canonical JSON of the registered tools, sorted by name, each as
   * `{ name, description, inputSchema }`.
   */
  toolsHash: string;
}

/** An extension was loaded, with the hash of what ran. */
export interface ExtensionLoadedEntry {
  /** The entry type name. @stable */
  type: "extension_loaded";
  /** The extension's name, or the MCP server's name for tier `mcp`. */
  name: string;
  tier: "in_process" | "mcp" | "skill";
  /** `sha256:` and a hex digest. For tier `mcp`, the digest of the canonical JSON of `mcp`. */
  contentHash: string;
  /** Set for tier `mcp` only. */
  mcp?: McpServerRecord;
}

/** A child session exists. It names the tool call or workflow step that started it, one of the two. */
export interface SubagentLinkEntry {
  /** The entry type name. @stable */
  type: "subagent_link";
  childSession: string;
  spawningCallId?: string;
  stepId?: string;
}

/**
 * A tool call waits for a person. `request` is the SDK's signed record, unchanged, and `input` is the input the call
 * would run with once approved, which the approver is shown and the resume passes back with the signature. The harness
 * writes this entry before its own observers see the request. It holds no key bytes: the signature names the key by id.
 */
export interface ApprovalRequestedEntry {
  /** The entry type name. @stable */
  type: "approval_requested";
  request: SignedPendingRequest;
  input: unknown;
}

/** A person's answer to a pending request, written before the run that applies it starts. */
export interface ApprovalResolvedEntry {
  /** The entry type name. @stable */
  type: "approval_resolved";
  resolution: Resolution;
  /** Set on an allow that also covers the same call later: for this run (the turn and its resumes) or this session. */
  sticky?: "run" | "session";
  /** What a sticky allowance matches: the tool and the call's input hash, or a command prefix for a shell tool. */
  allowance?: { tool: string; inputHash?: string; commandPrefix?: string[]; policyVersion?: string };
  /** Set when one answer covered several requests of one step that share a tool and an input. */
  groupId?: string;
  /** Set on an answer that a quorum still waits on, which no run has been given yet. */
  quorum?: "pending";
}

/** A call that shadow mode recorded and did not run. */
export interface ShadowCallEntry {
  /** The entry type name. @stable */
  type: "shadow_call";
  callId: string;
  tool: string;
  inputHash: string;
}

/** A record that the product owns. `name` is namespaced, such as `triage.record`. Outside the stable surface. */
export interface ProductRecordEntry {
  /** The entry type name. @stable */
  type: "product_record";
  name: string;
  data: unknown;
}

/** One line of a session file. */
export type SessionEntry = EntryBase &
  (
    | SessionHeaderEntry
    | TurnStartEntry
    | MessageBlockEntry
    | MessageEndEntry
    | ToolResultEntry
    | CodeCallEntry
    | PermissionDecisionEntry
    | UsageEntry
    | TurnEndEntry
    | CheckoutEntry
    | CompactionEntry
    | EnvStampEntry
    | LoadoutEntry
    | CompletionCheckEntry
    | SkillLoadedEntry
    | ExtensionLoadedEntry
    | SubagentLinkEntry
    | ApprovalRequestedEntry
    | ApprovalResolvedEntry
    | ShadowCallEntry
    | ProductRecordEntry
  );

/** The `type` of every entry in the union, in the order the union lists them. */
export const SESSION_ENTRY_TYPES = [
  "session_header",
  "turn_start",
  "message_block",
  "message_end",
  "tool_result",
  "code_call",
  "permission_decision",
  "usage",
  "turn_end",
  "checkout",
  "compaction",
  "env_stamp",
  "loadout",
  "completion_check",
  "skill_loaded",
  "extension_loaded",
  "subagent_link",
  "approval_requested",
  "approval_resolved",
  "shadow_call",
  "product_record",
] as const satisfies readonly SessionEntry["type"][];

/**
 * The shape of an ISO 8601 date and time with a zone, such as `2026-11-22T03:00:00.000Z`: what `timestamp` holds. The
 * schema checks only this shape; `parseEntry()` also refuses a date that does not exist.
 */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const ORIGINS: readonly string[] = ["user", "operator", "model", "tool", "harness"];

function reject(message: string): never {
  throw new ProtocolError("invalid_entry", message);
}

function checkBase(value: Record<string, unknown>): void {
  if (typeof value.id !== "string" || value.id === "") reject("an entry needs a non-empty string id");
  if (value.parentId !== null && typeof value.parentId !== "string") reject("parentId must be a string or null");
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0)
    reject("seq must be a safe whole number, 0 or more");
  if (
    typeof value.timestamp !== "string" ||
    !TIMESTAMP_PATTERN.test(value.timestamp) ||
    Number.isNaN(Date.parse(value.timestamp))
  ) {
    reject("timestamp must be an ISO 8601 date and time with a zone");
  }
  if (typeof value.origin !== "string" || !ORIGINS.includes(value.origin))
    reject(`origin must be one of ${ORIGINS.join(", ")}`);
}

/**
 * Reads one session entry from a JSON line or an already parsed value, and checks what every reader relies on: it
 * is an object with valid base fields, its `type` is in the union, and a `session_header` has this package's
 * `formatVersion`. It does not check each type's own fields; validate those against
 * `schema/session-entry.schema.json`.
 *
 * Throws a `ProtocolError` with code `unsupported_format_version` for a header from another format, so a reader never
 * misreads a newer file, and with code `invalid_entry` for text that is not JSON, a value that is not an object, a
 * bad base field or an unknown `type`.
 */
export function parseEntry(input: unknown): SessionEntry {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (cause) {
      throw new ProtocolError("invalid_entry", "an entry line is not valid JSON", { cause });
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject("an entry must be a JSON object");
  const entry = value as Record<string, unknown>;
  if (entry.type === "session_header" && entry.formatVersion !== FORMAT_VERSION) {
    throw new ProtocolError(
      "unsupported_format_version",
      `this reader supports formatVersion ${FORMAT_VERSION}, and the session header says ${String(entry.formatVersion)}`,
    );
  }
  if (!(SESSION_ENTRY_TYPES as readonly unknown[]).includes(entry.type))
    reject(`unknown entry type ${String(entry.type)}`);
  checkBase(entry);
  return entry as unknown as SessionEntry;
}
