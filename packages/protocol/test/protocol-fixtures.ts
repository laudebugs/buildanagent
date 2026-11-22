// One valid message of every kind in the protocol, in both directions. `satisfies` makes the compiler check each against
// its type, and test/protocol-schema.test.ts validates each against the generated JSON Schema, so the two cannot drift.
import type {
  ClientCommand,
  ClientResultMap,
  HarnessEvent,
  ProtocolMessage,
  ServerNotification,
  ServerRequest,
  ServerResultMap,
} from "@buildanagent/protocol";
import type { AgentEvent, SignedPendingRequest } from "@buildanagent/sdk";
import { FIXTURES as ENTRIES } from "./fixtures.js";

export const PENDING = {
  id: "req-1",
  kind: "approval",
  callId: "call-1",
  tool: "escalate",
  inputHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  policyVersion: "p1",
  reason: "Escalating a ticket tells the customer.",
  keyId: "k1",
  signature: "c2lnbmF0dXJl",
  createdAt: "2026-11-22T03:00:00.000Z",
} satisfies SignedPendingRequest;

const INPUT = [{ type: "text", text: "Triage ticket 4471." }] as const;

/** Every client command, including each shared-params method under each of its names. */
export const COMMANDS = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "cli", version: "0.1.0" }, capabilities: ["steering_v1"] },
  },
  { jsonrpc: "2.0", id: 2, method: "session/create", params: { cwd: "/work" } },
  { jsonrpc: "2.0", id: "open-1", method: "session/open", params: { session: "s1", cwd: "/work" } },
  { jsonrpc: "2.0", id: 3, method: "session/list", params: {} },
  { jsonrpc: "2.0", id: 4, method: "session/list", params: { cursor: "c2" } },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "turn/start",
    params: { session: "s1", input: [...INPUT] },
    trace: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  },
  { jsonrpc: "2.0", id: 6, method: "turn/start", params: { session: "s1", input: [...INPUT] } },
  { jsonrpc: "2.0", id: 7, method: "turn/steer", params: { session: "s1", input: [...INPUT] } },
  { jsonrpc: "2.0", id: 8, method: "turn/followUp", params: { session: "s1", input: [...INPUT] } },
  { jsonrpc: "2.0", id: 9, method: "turn/interrupt", params: { session: "s1", reason: "the person cut in" } },
  { jsonrpc: "2.0", id: 10, method: "approval/list", params: { session: "s1" } },
  { jsonrpc: "2.0", id: 11, method: "session/checkout", params: { session: "s1", entryId: "e3" } },
  { jsonrpc: "2.0", id: 12, method: "session/fork", params: { session: "s1", entryId: "e3" } },
  { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 5 } },
] as const satisfies readonly ClientCommand[];

/** The result of each client method, each with its response envelope. */
export const RESULTS = {
  initialize: {
    serverInfo: { name: "buildanagent", version: "0.1.0", sdkVersion: "0.1.0-alpha.24", specVersion: "v1" },
    capabilities: ["steering_v1", "toolSearch"],
    experimental: ["session/checkout", "session/fork"],
    pending: [{ session: "s1", request: PENDING }],
  },
  "session/create": { session: "s1", head: null },
  "session/open": { session: "s1", head: "e5" },
  "session/list": {
    sessions: [
      { session: "s1", startedAt: "2026-11-22T03:00:00.000Z", lastEntryAt: "2026-11-22T03:05:00.000Z", entryCount: 12 },
    ],
    nextCursor: "c2",
  },
  "turn/start": { accepted: true, turn: "t1" },
  "turn/steer": { accepted: false, reason: "busy" },
  "turn/followUp": { accepted: false, reason: "locked" },
  "turn/interrupt": { interrupted: true },
  "approval/list": { pending: [PENDING] },
  "session/checkout": { session: "s1", head: "e3" },
  "session/fork": { session: "s2", head: "e3" },
} as const satisfies ClientResultMap;

/** The answer a client gives to each server request. */
export const SERVER_RESULTS = {
  "approval/request": { resolutions: [{ requestId: "req-1", decision: "allow", by: "ada" }] },
  "clarification/request": { resolutions: [{ requestId: "req-2", answer: "Customer 88." }] },
  "tool/call": { content: [{ type: "text", text: "file contents" }], isError: false },
} as const satisfies ServerResultMap;

export const SERVER_REQUESTS = [
  { jsonrpc: "2.0", id: "sr-1", method: "approval/request", params: { session: "s1", request: PENDING } },
  {
    jsonrpc: "2.0",
    id: "sr-2",
    method: "approval/request",
    params: { session: "s1", request: PENDING, group: ["req-1", "req-3"] },
  },
  {
    jsonrpc: "2.0",
    id: "sr-3",
    method: "clarification/request",
    params: { session: "s1", request: { ...PENDING, id: "req-2", kind: "clarification", question: "Which customer?" } },
  },
  {
    jsonrpc: "2.0",
    id: "sr-4",
    method: "tool/call",
    params: { session: "s1", callId: "call-9", tool: "read_file", input: { path: "a.txt" } },
  },
] as const satisfies readonly ServerRequest[];

export const HARNESS_EVENTS = [
  { type: "entry_appended", entry: ENTRIES[1] },
  { type: "budget_warning", spentUsd: 0.8, capUsd: 1 },
  { type: "context_fill", tokens: 90_000, budget: 150_000 },
  { type: "completion_check", entry: ENTRIES.find((entry) => entry.type === "completion_check") ?? ENTRIES[0] },
] as const satisfies readonly HarnessEvent[];

/** A real SDK event, so the loose mirror is shown to accept what the SDK emits. */
export const AGENT_EVENTS = [
  { runId: "run-1", seq: 0, stepIndex: 0, timestamp: "2026-11-22T03:00:00.000Z", type: "step_start" },
  {
    runId: "run-1",
    seq: 3,
    stepIndex: 0,
    timestamp: "2026-11-22T03:00:01.000Z",
    type: "text_delta",
    index: 0,
    delta: "Hel",
  },
  { runId: "run-1", seq: 9, stepIndex: 0, timestamp: "2026-11-22T03:00:02.000Z", type: "agent_settled" },
] as const satisfies readonly AgentEvent[];

export const NOTIFICATIONS = [
  ...HARNESS_EVENTS.map(
    (event, index) => ({ jsonrpc: "2.0", method: "event", params: { session: "s1", seq: index, event } }) as const,
  ),
  ...AGENT_EVENTS.map(
    (event, index) => ({ jsonrpc: "2.0", method: "event", params: { session: "s1", seq: 10 + index, event } }) as const,
  ),
  {
    jsonrpc: "2.0",
    method: "turn/settled",
    params: { session: "s1", turn: "t1", result: { stopReason: "done", steps: 3, costUsd: 0.0123 } },
  },
  {
    jsonrpc: "2.0",
    method: "turn/settled",
    params: {
      session: "s1",
      turn: "t2",
      result: {
        stopReason: "error",
        steps: 1,
        costUsd: null,
        error: { kind: "fatal", message: "the provider refused" },
      },
    },
  },
] as const satisfies readonly ServerNotification[];

/** Responses of every shape: a result for each method, an error, and an error whose request could not be read. */
export const RESPONSES = [
  ...Object.values(RESULTS).map((result, index) => ({ jsonrpc: "2.0", id: index, result }) as const),
  ...Object.values(SERVER_RESULTS).map((result, index) => ({ jsonrpc: "2.0", id: `sr-${index}`, result }) as const),
  { jsonrpc: "2.0", id: 5, error: { code: -32001, message: "the queue is full" } },
  {
    jsonrpc: "2.0",
    id: "x",
    error: { code: -32002, message: "another writer holds the session", data: { session: "s1" } },
  },
  { jsonrpc: "2.0", id: null, error: { code: -32700, message: "a line is not valid JSON" } },
] as const satisfies readonly ProtocolMessage[];

/** Every message above. */
export const MESSAGES: readonly ProtocolMessage[] = [...COMMANDS, ...SERVER_REQUESTS, ...NOTIFICATIONS, ...RESPONSES];
