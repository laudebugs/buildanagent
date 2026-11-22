// The zod mirror of the protocol's messages, which `generate-schema.ts` turns into schema/protocol.schema.json. The
// hand-written types in src/messages.ts are the contract; this file only has to describe the same JSON. A type test
// (schema-check/protocol-types.ts) checks at compile time that the inferred type and `ProtocolMessage` accept the same
// values, and fixtures cover every message. Nothing in src/ imports this file, so the published package stays free of zod.
//
// One thing is mirrored loosely on purpose: an SDK `AgentEvent` in an `event` notification. The schema checks its `type`
// and the base fields every event has, and lets the other fields through, because the SDK owns the event contract and
// its 29 event types would be a second copy to keep in step. A test compares the schema's type list with the SDK's.
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ContentBlock as Content,
  SessionEntry as Entry,
  ModelContent as ModelPart,
  Resolution as ResolutionShape,
  SignedPendingRequest as SignedPendingRequestShape,
} from "./session-entry-schema.js";

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

// Shapes the schema uses more than once get a name of their own, so each is defined once under `$defs` and its name
// doesn't change when another shape is added.
const ContentBlock = Content.meta({ id: "ContentBlock" });
const ModelContent = ModelPart.meta({ id: "ModelContent" });
const SessionEntry = Entry.meta({ id: "SessionEntry" });

const Id = z.union([z.number(), z.string()]).meta({ id: "Id" });
const rpc = z.literal("2.0");

const SignedPendingRequest = SignedPendingRequestShape.meta({ id: "SignedPendingRequest" });
const Resolution = ResolutionShape.meta({ id: "Resolution" });

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

const RpcError = z
  .strictObject({ code: z.number().int(), message: z.string(), data: z.unknown().optional() })
  .meta({ id: "RpcError" });

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

const AUTO_NAME = /^__schema\d+$/;

/** The `$ref` names a JSON value mentions. */
function refsOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) refsOf(item, found);
  else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") found.add(child.replace("#/$defs/", ""));
      else refsOf(child, found);
    }
  }
  return found;
}

const renameRefs = (value: unknown, names: ReadonlyMap<string, string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => renameRefs(item, names));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const renamed =
        key === "$ref" && typeof child === "string" ? names.get(child.replace("#/$defs/", "")) : undefined;
      return [key, renamed === undefined ? renameRefs(child, names) : `#/$defs/${renamed}`];
    }),
  );
};

/**
 * Renames the shapes zod numbers in order (`__schema7`) after a hash of their content, so adding a shape doesn't renumber
 * the others and a `$ref` a client pinned keeps its meaning. A shape is named once every shape it refers to has been.
 */
function stabilizeNames(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  const pending = Object.keys(defs).filter((name) => AUTO_NAME.test(name));
  while (pending.length > 0) {
    const ready = pending.filter((name) =>
      [...refsOf(defs[name])].every((ref) => !AUTO_NAME.test(ref) || names.has(ref)),
    );
    if (ready.length === 0) throw new Error("the schema's shared shapes refer to each other in a cycle");
    for (const name of ready) {
      const text = JSON.stringify(renameRefs(defs[name], names));
      names.set(name, `shape-${createHash("sha256").update(text).digest("hex").slice(0, 10)}`);
      pending.splice(pending.indexOf(name), 1);
    }
  }
  const renamedDefs = Object.fromEntries(
    Object.entries(defs).map(([name, def]) => [names.get(name) ?? name, renameRefs(def, names)]),
  );
  return { ...(renameRefs({ ...schema, $defs: undefined }, names) as Record<string, unknown>), $defs: renamedDefs };
}

/** The JSON Schema (draft 2020-12) of one protocol message, as generated from the mirror. */
export function buildProtocolSchema(): Record<string, unknown> {
  // Shared shapes, such as a session entry, are defined once under `$defs` and referenced, so the file stays readable.
  const schema = z.toJSONSchema(ProtocolMessage, { target: "draft-2020-12", io: "output", reused: "ref" });
  return {
    ...stabilizeNames(schema as Record<string, unknown>),
    title: "ProtocolMessage",
    description:
      'One line of the buildanagent harness protocol: a JSON-RPC 2.0 message, in either direction. Every message carries "jsonrpc": "2.0". An SDK event in an "event" notification is checked for its type and base fields only.',
  };
}
