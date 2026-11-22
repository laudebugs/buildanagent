/**
 * Why something was refused. `invalid_entry`: a session entry's `type` or base fields are wrong. `unsupported_format_version`:
 * an entry is from a format this reader lacks. `invalid_json`: a line is not valid UTF-8 JSON. `invalid_request`: a
 * JSON value is not a JSON-RPC 2.0 message. `line_too_long`: a line went over the framer's bound. `unterminated_line`:
 * the stream ended in the middle of a line.
 */
export type ProtocolErrorCode =
  | "invalid_entry"
  | "unsupported_format_version"
  | "invalid_json"
  | "invalid_request"
  | "line_too_long"
  | "unterminated_line";

/** What a `ProtocolError` carries when it is also a JSON-RPC error a peer can be answered with. */
export interface ProtocolErrorOptions extends ErrorOptions {
  /** The JSON-RPC error code to reply with, such as -32600 for an invalid request. */
  readonly rpcCode?: number;
  /** The id of the message that failed, when it could be read, or `null` when it could not. */
  readonly requestId?: number | string | null;
}

/** The error every `@buildanagent/protocol` function throws. Read `code` to tell the causes apart. */
export class ProtocolError extends Error {
  override readonly name: string = "ProtocolError";
  readonly code: ProtocolErrorCode;
  readonly rpcCode: number | undefined;
  readonly requestId: number | string | null | undefined;

  constructor(code: ProtocolErrorCode, message: string, options?: ProtocolErrorOptions) {
    super(message, options);
    this.code = code;
    this.rpcCode = options?.rpcCode;
    this.requestId = options?.requestId;
    Object.defineProperty(this, PROTOCOL_ERROR, { value: true });
  }
}

// A symbol marker, as the SDK's error class uses, so a copy of this package from another bundle still matches.
const PROTOCOL_ERROR = Symbol.for("@buildanagent/protocol/ProtocolError");

/** True for a `ProtocolError`, including one from another copy of the package. */
export function isProtocolError(error: unknown): error is ProtocolError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[PROTOCOL_ERROR] === true;
}
