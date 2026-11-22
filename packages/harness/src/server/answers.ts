/**
 * Reads a client's answers to the server's requests. An answer is checked before it reaches the approvals or a tool
 * call, because it comes from outside the process: an approval answer must name the request it was asked about and
 * nothing else, and a tool result must have the shape the SDK takes.
 */
import type { Resolution, SignedPendingRequest, ToolResult } from "@buildanagent/sdk";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalText = (value: unknown): boolean => value === undefined || typeof value === "string";

/**
 * The one resolution an answer to `approval/request` or `clarification/request` gives for `request`, or `undefined` when
 * the answer is malformed, names another request, or gives more than one. An approval takes `allow` or `deny` with an
 * optional `reason`; a clarification takes an `answer`. Either may carry `by`.
 */
export function resolutionOf(result: unknown, request: SignedPendingRequest): Resolution | undefined {
  if (!isObject(result) || !Array.isArray(result.resolutions) || result.resolutions.length !== 1) return undefined;
  const [given] = result.resolutions as unknown[];
  if (!isObject(given) || given.requestId !== request.id || !optionalText(given.by)) return undefined;
  const by = given.by === undefined ? {} : { by: given.by as string };
  if (request.kind === "clarification") {
    return typeof given.answer === "string" && given.decision === undefined
      ? { requestId: request.id, answer: given.answer, ...by }
      : undefined;
  }
  if ((given.decision !== "allow" && given.decision !== "deny") || given.answer !== undefined) return undefined;
  if (!optionalText(given.reason)) return undefined;
  return {
    requestId: request.id,
    decision: given.decision,
    ...(given.reason === undefined ? {} : { reason: given.reason as string }),
    ...by,
  };
}

/** An error result the model reads, for a tool call the client could not run. */
export function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The tool result a client's answer to `tool/call` gives, or an error result when the answer is not one. */
export function toolResultOf(result: unknown, tool: string): ToolResult {
  if (!isObject(result) || !Array.isArray(result.content) || typeof result.isError !== "boolean") {
    return toolError(`the client's answer to the call to ${tool} is not a tool result`);
  }
  // The SDK checks each block, so a block of the wrong kind becomes an error result there.
  return { content: result.content as ToolResult["content"], isError: result.isError };
}
