/** Why a session entry was refused: its `type` or base fields are wrong, or it is from a format this reader lacks. */
export type ProtocolErrorCode = "invalid_entry" | "unsupported_format_version";

/** The error every `@buildanagent/protocol` function throws. Read `code` to tell the causes apart. */
export class ProtocolError extends Error {
  override readonly name: string = "ProtocolError";
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, PROTOCOL_ERROR, { value: true });
  }
}

// A symbol marker, as the SDK's error class uses, so a copy of this package from another bundle still matches.
const PROTOCOL_ERROR = Symbol.for("@buildanagent/protocol/ProtocolError");

/** True for a `ProtocolError`, including one from another copy of the package. */
export function isProtocolError(error: unknown): error is ProtocolError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[PROTOCOL_ERROR] === true;
}
