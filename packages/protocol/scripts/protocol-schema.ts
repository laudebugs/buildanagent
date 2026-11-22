// The zod mirror of the protocol's messages, which `generate-schema.ts` turns into schema/protocol.schema.json. The
// hand-written types in src/messages.ts are the contract; this file only has to describe the same JSON. A type test
// (schema-check/protocol-types.ts) checks at compile time that the inferred type and `ProtocolMessage` accept the same
// values, and fixtures cover every message. Nothing in src/ imports this file, so the published package stays free of zod.
//
// One thing is mirrored loosely on purpose: an SDK `AgentEvent` in an `event` notification. The schema checks its `type`
// and the base fields every event has, and lets the other fields through, because the SDK owns the event contract and
// its 29 event types would be a second copy to keep in step. A test compares the schema's type list with the SDK's.
import { z } from "zod";
import { ContentBlock, ModelContent, SessionEntry } from "./session-entry-schema.js";

/** The SDK's event types, as `AGENT_EVENT_TYPES` lists them. A test checks this list against the SDK's own. */
export const AGENT_EVENT_TYPE_NAMES = [
  "run_start",
  "step_start",
  "model_call_start",
  "retry",
  "raw",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "warning",
  "model_call_end",
  "context_transformed",
  "hook_error",
  "steer_applied",
  "tool_call_start",
  "approval_request",
  "resolution_rejected",
  "tool_call_update",
  "tool_call_end",
  "step_end",
  "error",
  "abort",
  "agent_settled",
  "run_end",
] as const;

const Id = z.union([z.number(), z.string()]);
const rpc = z.literal("2.0");

const SignedPendingRequest = z.strictObject({
  id: z.string(),
  kind: z.enum(["approval", "clarification"]),
  callId: z.string(),
  tool: z.string(),
  inputHash: z.string(),
  policyVersion: z.string().optional(),
  appHash: z.string().optional(),
  question: z.string().optional(),
  reason: z.string().optional(),
  keyId: z.string(),
  signature: z.string(),
  createdAt: z.string(),
});

const Resolution = z.union([
  z.strictObject({
    requestId: z.string(),
    decision: z.enum(["allow", "deny"]),
    reason: z.string().optional(),
    by: z.string().optional(),
  }),
  z.strictObject({ requestId: z.string(), answer: z.string(), by: z.string().optional() }),
]);

const command = <M extends string, P extends z.ZodRawShape>(method: M | M[], params: P, extra: z.ZodRawShape = {}) =>
  z.strictObject({
    jsonrpc: rpc,
    id: Id,
    method: Array.isArray(method) ? z.enum(method as [M, ...M[]]) : z.literal(method),
    params: z.strictObject(params),
    ...extra,
  });

const Input = z.array(ContentBlock);

const ClientCommand = z.union([
  command("initialize", {
    clientInfo: z.strictObject({ name: z.string(), version: z.string() }),
    capabilities: z.array(z.string()),
  }),
  command(["session/create", "session/open"], { session: z.string().optional(), cwd: z.string() }),
  command("session/list", { cursor: z.string().optional() }),
  command("turn/start", { session: z.string(), input: Input }, { trace: z.string().optional() }),
  command(["turn/steer", "turn/followUp"], { session: z.string(), input: Input }),
  command("turn/interrupt", { session: z.string(), reason: z.string().optional() }),
  command("approval/list", { session: z.string() }),
  command(["session/checkout", "session/fork"], { session: z.string(), entryId: z.string() }),
  z.strictObject({ jsonrpc: rpc, method: z.literal("$/cancelRequest"), params: z.strictObject({ id: Id }) }),
]);

const Disposition = z.union([
  z.strictObject({ accepted: z.literal(true), turn: z.string() }),
  z.strictObject({ accepted: z.literal(false), reason: z.enum(["busy", "locked", "invalid"]) }),
]);

const InitializeResult = z.strictObject({
  serverInfo: z.strictObject({
    name: z.string(),
    version: z.string(),
    sdkVersion: z.string(),
    specVersion: z.literal("v1"),
  }),
  capabilities: z.array(z.string()),
  experimental: z.array(z.string()),
  pending: z.array(z.strictObject({ session: z.string(), request: SignedPendingRequest })),
});

const SessionOpened = z.strictObject({ session: z.string(), head: z.string().nullable() });
const SessionList = z.strictObject({
  sessions: z.array(
    z.strictObject({
      session: z.string(),
      startedAt: z.string(),
      lastEntryAt: z.string(),
      entryCount: z.number().int().min(0),
    }),
  ),
  nextCursor: z.string().optional(),
});
const InterruptResult = z.strictObject({ interrupted: z.boolean() });
const ApprovalList = z.strictObject({ pending: z.array(SignedPendingRequest) });
const BranchResult = z.strictObject({ session: z.string(), head: z.string() });

const ClientResult = z.union([
  InitializeResult,
  SessionOpened,
  SessionList,
  Disposition,
  InterruptResult,
  ApprovalList,
  BranchResult,
]);

const ServerResult = z.union([
  z.strictObject({ resolutions: z.array(Resolution) }),
  z.strictObject({ content: z.array(ModelContent), isError: z.boolean() }),
]);

const RpcError = z.strictObject({ code: z.number().int(), message: z.string(), data: z.unknown().optional() });

const response = <R extends z.ZodType>(result: R) =>
  z.union([
    z.strictObject({ jsonrpc: rpc, id: Id, result }),
    z.strictObject({ jsonrpc: rpc, id: Id.nullable(), error: RpcError }),
  ]);

const ServerRequest = z.union([
  z.strictObject({
    jsonrpc: rpc,
    id: z.string(),
    method: z.literal("approval/request"),
    params: z.strictObject({
      session: z.string(),
      request: SignedPendingRequest,
      group: z.array(z.string()).optional(),
    }),
  }),
  z.strictObject({
    jsonrpc: rpc,
    id: z.string(),
    method: z.literal("clarification/request"),
    params: z.strictObject({ session: z.string(), request: SignedPendingRequest }),
  }),
  z.strictObject({
    jsonrpc: rpc,
    id: z.string(),
    method: z.literal("tool/call"),
    params: z.strictObject({ session: z.string(), callId: z.string(), tool: z.string(), input: z.unknown() }),
  }),
]);

const HarnessEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("entry_appended"), entry: SessionEntry }),
  z.strictObject({ type: z.literal("budget_warning"), spentUsd: z.number(), capUsd: z.number() }),
  z.strictObject({ type: z.literal("context_fill"), tokens: z.number(), budget: z.number() }),
  z.strictObject({ type: z.literal("completion_check"), entry: SessionEntry }),
]);

const AgentEvent = z.looseObject({
  type: z.enum(AGENT_EVENT_TYPE_NAMES),
  runId: z.string(),
  seq: z.number().int().min(0),
  stepIndex: z.number().int().min(0),
  timestamp: z.string(),
});

const TurnResultSummary = z.strictObject({
  stopReason: z.enum([
    "done",
    "max_steps",
    "aborted",
    "no_progress",
    "budget",
    "error",
    "stopped",
    "awaiting_approval",
    "clarification_requested",
  ]),
  steps: z.number().int().min(0),
  costUsd: z.number().nullable(),
  error: z.strictObject({ kind: z.string(), message: z.string() }).optional(),
});

const ServerNotification = z.union([
  z.strictObject({
    jsonrpc: rpc,
    method: z.literal("event"),
    params: z.strictObject({
      session: z.string(),
      seq: z.number().int().min(0),
      event: z.union([HarnessEvent, AgentEvent]),
    }),
  }),
  z.strictObject({
    jsonrpc: rpc,
    method: z.literal("turn/settled"),
    params: z.strictObject({ session: z.string(), turn: z.string(), result: TurnResultSummary }),
  }),
]);

const ProtocolMessage = z.union([
  ClientCommand,
  response(ServerResult),
  response(ClientResult),
  ServerRequest,
  ServerNotification,
]);

/** What the zod mirror infers, for the type test that compares it with `ProtocolMessage`. */
export type MirroredMessage = z.infer<typeof ProtocolMessage>;

/** The JSON Schema (draft 2020-12) of one protocol message, as generated from the mirror. */
export function buildProtocolSchema(): Record<string, unknown> {
  // Shared shapes, such as a session entry, are defined once under `$defs` and referenced, so the file stays readable.
  const schema = z.toJSONSchema(ProtocolMessage, { target: "draft-2020-12", io: "output", reused: "ref" });
  return {
    ...schema,
    title: "ProtocolMessage",
    description:
      'One line of the buildanagent harness protocol: a JSON-RPC 2.0 message, in either direction. Every message carries "jsonrpc": "2.0". An SDK event in an "event" notification is checked for its type and base fields only.',
  };
}
