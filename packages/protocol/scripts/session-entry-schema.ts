// The zod mirror of the session entry union, which `generate-schema.ts` turns into schema/session-entry.schema.json.
// The hand-written types in src/entries.ts are the contract; this file only has to describe the same JSON. A type test
// in test/schema.test.ts checks, at compile time, that the inferred type and `SessionEntry` accept the same values,
// nested shapes included, so `pnpm typecheck` fails when either side changes alone. A runtime test compares each
// entry's top-level field names with the fixtures'. Nothing in src/ imports this file, so the published package stays
// free of zod.
import { z } from "zod";
import { TIMESTAMP_PATTERN } from "../src/entries.js";

const OpaqueToken = z.strictObject({ api: z.string(), provider: z.string(), model: z.string(), value: z.string() });

const TextBlock = z.strictObject({ type: z.literal("text"), text: z.string() });
const ImageBlock = z.strictObject({ type: z.literal("image"), mediaType: z.string(), data: z.string() });
export const ContentBlock = z.discriminatedUnion("type", [
  TextBlock,
  z.strictObject({ type: z.literal("reasoning"), text: z.string(), signature: OpaqueToken.optional() }),
  ImageBlock,
  z.strictObject({ type: z.literal("tool_call"), callId: z.string(), name: z.string(), input: z.unknown() }),
]);
export const ModelContent = z.discriminatedUnion("type", [TextBlock, ImageBlock]);

/** The SDK's signed pending request, which `approval_requested` stores and the protocol's messages carry. */
export const SignedPendingRequest = z.strictObject({
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

/** A person's answer to a pending request. */
export const Resolution = z.union([
  z.strictObject({
    requestId: z.string(),
    decision: z.enum(["allow", "deny"]),
    reason: z.string().optional(),
    by: z.string().optional(),
  }),
  z.strictObject({ requestId: z.string(), answer: z.string(), by: z.string().optional() }),
]);

const ModelRef = z.strictObject({ api: z.string(), provider: z.string(), id: z.string() });

const Usage = z.strictObject({
  uncachedInput: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.strictObject({ "5m": z.number(), "1h": z.number() }),
  output: z.number(),
  reasoning: z.number(),
  raw: z.unknown(),
  unreported: z.literal(true).optional(),
});

const Cost = z.strictObject({
  total: z.number().nullable(),
  basis: z.enum(["provider", "catalog", "unknown"]),
  currency: z.literal("USD"),
  catalogAsOf: z.string().optional(),
});

const ModelError = z.strictObject({
  kind: z.enum(["retryable", "overflow", "quota", "fatal"]),
  message: z.string(),
  status: z.number().optional(),
  code: z.literal("thinking_prefix_mismatch").optional(),
  retryAfterMs: z.number().optional(),
});

const base = {
  id: z.string().min(1),
  parentId: z.string().nullable(),
  seq: z.number().int().min(0),
  timestamp: z.string().regex(TIMESTAMP_PATTERN),
  origin: z.enum(["user", "operator", "model", "tool", "harness"]),
};

/** One entry type: the base fields and then the type's own. */
const entry = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ ...base, type: z.literal(type), ...shape });

export const SessionEntry = z.discriminatedUnion("type", [
  entry("session_header", {
    formatVersion: z.literal(1),
    harnessVersion: z.string(),
    sdkVersion: z.string(),
    defaultsHash: z.string(),
    capabilities: z.array(z.string()),
    ablationHash: z.string(),
    parent: z.strictObject({ session: z.string(), entryId: z.string() }).optional(),
    spawn: z.union([z.strictObject({ spawningCallId: z.string() }), z.strictObject({ stepId: z.string() })]).optional(),
    product: z.strictObject({ name: z.string(), version: z.string(), bundleHash: z.string() }).optional(),
  }),
  entry("turn_start", { runId: z.string(), mode: z.enum(["run", "continue"]), system: z.string() }),
  entry("message_block", {
    messageId: z.string(),
    role: z.enum(["user", "assistant"]),
    index: z.number().int().min(0),
    block: ContentBlock,
    delivery: z.enum(["input", "steer", "follow_up"]).optional(),
  }),
  entry("message_end", {
    messageId: z.string(),
    model: ModelRef,
    stopReason: z.enum(["stop", "length", "tool_calls", "error", "aborted"]),
    error: ModelError.optional(),
  }),
  entry("tool_result", {
    callId: z.string(),
    tool: z.string(),
    content: z.array(ModelContent),
    isError: z.boolean(),
    details: z.unknown().optional(),
    spill: z.strictObject({ path: z.string(), bytes: z.number().int().min(0) }).optional(),
    trust: z.enum(["trusted", "untrusted"]),
  }),
  entry("permission_decision", {
    callId: z.string(),
    tool: z.string(),
    decision: z.enum(["allow", "deny", "ask"]),
    rule: z.string().optional(),
    by: z.string().optional(),
    policyVersion: z.string(),
    inputHash: z.string(),
  }),
  entry("usage", {
    source: z.enum(["model_call", "summary", "judge"]),
    usage: Usage,
    lastAttemptUsage: Usage.optional(),
    cost: Cost,
  }),
  entry("turn_end", {
    runId: z.string(),
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
  }),
  entry("checkout", { headId: z.string() }),
  entry("compaction", {
    layer: z.enum(["summarize", "mid_turn", "overflow_retry"]),
    summary: z.string(),
    firstKeptEntryId: z.string(),
    tokensBefore: z.number().int().min(0),
    tokensAfter: z.number().int().min(0),
    model: ModelRef,
    promptVersion: z.string(),
    usageEntryId: z.string(),
    focus: z.string().optional(),
  }),
  entry("env_stamp", {
    cwd: z.string(),
    permissionMode: z.enum(["default", "accept_edits", "read_only", "bypass", "shadow"]),
    approvalPolicy: z.enum(["on-request", "granular", "never"]),
    sandbox: z.enum(["none", "os", "container", "gvisor", "microvm"]),
    model: ModelRef,
    effort: z.string().optional(),
  }),
  entry("loadout", { tools: z.array(z.string()), model: ModelRef.optional(), effort: z.string().optional() }),
  entry("completion_check", {
    checks: z.array(z.strictObject({ command: z.string(), exitCode: z.number().int() })),
    passed: z.boolean(),
    flagged: z.array(z.string()),
  }),
  entry("skill_loaded", { name: z.string(), path: z.string() }),
  entry("extension_loaded", {
    name: z.string(),
    tier: z.enum(["in_process", "mcp", "skill"]),
    contentHash: z.string(),
  }),
  entry("subagent_link", {
    childSession: z.string(),
    spawningCallId: z.string().optional(),
    stepId: z.string().optional(),
  }),
  entry("approval_requested", { request: SignedPendingRequest, input: z.unknown() }),
  entry("approval_resolved", {
    resolution: Resolution,
    sticky: z.enum(["run", "session"]).optional(),
    allowance: z
      .strictObject({
        tool: z.string(),
        inputHash: z.string().optional(),
        commandPrefix: z.array(z.string()).optional(),
      })
      .optional(),
    groupId: z.string().optional(),
  }),
  entry("shadow_call", { callId: z.string(), tool: z.string(), inputHash: z.string() }),
  entry("product_record", { name: z.string(), data: z.unknown() }),
]);

/** What the zod mirror infers, for the type test that compares it with `SessionEntry`. */
export type MirroredEntry = z.infer<typeof SessionEntry>;

/** The JSON Schema (draft 2020-12) of one session entry, as generated from the mirror. */
export function buildSessionEntrySchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(SessionEntry, { target: "draft-2020-12", io: "output", reused: "inline" });
  return {
    ...schema,
    title: "SessionEntry",
    description:
      "One line of a buildanagent session file. The format version of the file is the formatVersion of its session_header entry.",
  };
}
