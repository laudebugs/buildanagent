/**
 * JSON-RPC 2.0 framing, strictly: `encode()` and `decode()` refuse a message without `"jsonrpc": "2.0"`. They check the
 * envelope only, because a method's params are the dispatcher's to check against the schema; a message that fails
 * throws a `ProtocolError` that carries the JSON-RPC code and the request's id, so a server can answer it.
 */
import { ProtocolError } from "./errors.js";
import type { Id, ProtocolMessage } from "./messages.js";

/** The JSON-RPC error codes the protocol uses: the standard ones, and three of its own in the server-error range. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The dispatcher's queue is full, so the command was not taken. */
  QueueFull: -32001,
  /** Another writer holds the session. */
  SessionLocked: -32002,
  /** The client used an experimental method it did not opt into. */
  NotOptedIn: -32003,
} as const;

/** The methods a client may call. `$/cancelRequest` is a notification, and the others are requests. */
export const CLIENT_METHODS = [
  "initialize",
  "session/create",
  "session/open",
  "session/list",
  "turn/start",
  "turn/steer",
  "turn/followUp",
  "turn/interrupt",
  "approval/list",
  "session/checkout",
  "session/fork",
  "$/cancelRequest",
] as const;

/** The requests the server sends. */
export const SERVER_REQUEST_METHODS = ["approval/request", "clarification/request", "tool/call"] as const;

/** The notifications the server sends. */
export const SERVER_NOTIFICATION_METHODS = ["event", "turn/settled"] as const;

/** The client methods that need an opt-in, because they may change before a client other than ours uses them. */
export const EXPERIMENTAL_METHODS = ["session/checkout", "session/fork"] as const;

/** A JSON-RPC message as `decode()` reads it: the envelope is checked, and `params` and `result` are not. */
export type JsonRpcMessage =
  | { jsonrpc: "2.0"; id: Id; method: string; params?: Record<string, unknown> }
  | { jsonrpc: "2.0"; method: string; params?: Record<string, unknown> }
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id | null; error: { code: number; message: string; data?: unknown } };

function invalid(why: string, id: Id | null = null): never {
  throw new ProtocolError("invalid_request", why, { rpcCode: ErrorCodes.InvalidRequest, requestId: id });
}

const isId = (value: unknown): value is Id =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

function checkError(error: unknown, id: Id | null): void {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isInteger(value.code) ||
    typeof value.message !== "string"
  ) {
    invalid("an error response needs an integer code and a string message", id);
  }
}

/** A request or notification has a method and no result or error; a response has exactly one of `result` and `error`. */
function checkShape(value: Record<string, unknown>, id: Id | null): void {
  // A member counts only when it has a value, because JSON.stringify drops one that is undefined.
  const has = (name: string) => value[name] !== undefined;
  const hasMethod = has("method");
  const answers = (has("result") ? 1 : 0) + (has("error") ? 1 : 0);
  if (hasMethod && answers > 0) invalid("a message with a method can't also carry a result or an error", id);
  if (!hasMethod && answers !== 1) invalid("a response must carry exactly one of result and error", id);
  if (hasMethod && (typeof value.method !== "string" || value.method === "")) invalid("a method must be a string", id);
  if (!hasMethod && value.id === undefined) invalid("a response needs an id", null);
  if (has("error")) checkError(value.error, value.id as Id | null);
}

function checkEnvelope(value: Record<string, unknown>): void {
  // The id is read first, so that every later refusal can name the request it is about.
  const id = isId(value.id) ? value.id : null;
  if (value.jsonrpc !== "2.0") invalid('a message must carry "jsonrpc": "2.0"', id);
  // Only an error response may have a null id, because the request it answers could not be read.
  if (value.id !== undefined && !isId(value.id) && !(value.id === null && value.error !== undefined)) {
    invalid("an id must be a number or a string", null);
  }
  checkShape(value, id);
  const { params } = value;
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
    invalid("params must be an object", id);
  }
}

/** The value as an object that can be an envelope, after the envelope check. */
function checkObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) invalid("a message must be a JSON object");
  if (Array.isArray(value)) invalid("a batch is not supported, so each message goes on its own line");
  checkEnvelope(value as Record<string, unknown>);
  return value as Record<string, unknown>;
}

/**
 * Reads one message from a line of JSON text or a parsed value, and checks its envelope. A batch (an array) is not
 * supported. Throws a `ProtocolError`: `invalid_json` with the parse-error code for text that is not JSON, and
 * `invalid_request` with the invalid-request code for anything else wrong, such as a missing `jsonrpc`.
 */
export function decode(input: unknown): JsonRpcMessage {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (cause) {
      throw new ProtocolError("invalid_json", "a line is not valid JSON", {
        cause,
        rpcCode: ErrorCodes.ParseError,
        requestId: null,
      });
    }
  }
  return checkObject(value) as unknown as JsonRpcMessage;
}

/**
 * Turns a message into one line of JSON ending in `\n`, after the same envelope check `decode()` makes. JSON text has no
 * raw newline in it, so the line can't be split by accident. U+2028 and U+2029 stay as they are, which is why a reader
 * must split on `\n` only.
 */
export function encode(message: ProtocolMessage | JsonRpcMessage): string {
  checkObject(message);
  try {
    const text = JSON.stringify(message);
    if (text === undefined) invalid("a message must be JSON");
    return `${text}\n`;
  } catch (cause) {
    if (cause instanceof ProtocolError) throw cause;
    // A bigint or a circular value in params or result. It is the sender's bug, so it is an internal error.
    throw new ProtocolError("invalid_request", "a message can't be written as JSON", {
      cause,
      rpcCode: ErrorCodes.InternalError,
      requestId: null,
    });
  }
}
