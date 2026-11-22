/**
 * Writing a code call's `tool_result`. The tool has already run when this is called, so the entry must land: an entry
 * the store refuses would leave a call that was let run with no result, and the next code call would settle it as a
 * write that may have taken effect although it finished. The harness's context policy caps the result first, as it caps
 * a model call's, and a result still over the store's bound is cut to fit, keeping the write outcome at its front.
 */
import type { ModelContent } from "@buildanagent/gateway";
import type { CodeCallEntry, SessionEntry, ToolResultEntry } from "@buildanagent/protocol";
import type { ToolResult } from "@buildanagent/sdk";
import { capResult } from "../context/cap.js";
import type { Harness } from "../harness.js";
import type { RegisteredTool } from "../tools/types.js";
import { EntryTooLargeError } from "./errors.js";
import type { Session } from "./session.js";

/** What a `tool_result` entry stores of a result. */
interface Stored {
  readonly content: readonly ModelContent[];
  readonly details: unknown;
  readonly spill?: { readonly path: string; readonly bytes: number };
}

/** What writing the result needs: the session, the clock's time, the signal and the writer of one entry. */
export interface ResultWriter {
  readonly session: Session;
  readonly now: () => string;
  readonly signal: AbortSignal;
  readonly write: (body: ToolResultEntry) => Promise<SessionEntry>;
}

/**
 * The result as the context policy's write cap leaves it, with the spill that holds its full text. A cap that fails
 * leaves the result whole, and the store's bound still holds it to size when it is written.
 */
async function cappedByContext<H>(
  harness: Harness<H>,
  writer: ResultWriter,
  call: CodeCallEntry,
  result: ToolResult<unknown>,
): Promise<Stored> {
  const whole: Stored = { content: result.content, details: result.details };
  // The call's history is not a turn's, so the policy is told not to compact in the middle of it.
  const turn = harness.context?.forTurn({ session: writer.session, model: harness.model, ownHistory: true });
  const hook = turn?.interceptors.afterToolCall;
  if (turn === undefined || hook === undefined) return whole;
  try {
    const patch = await hook({
      runId: call.callId,
      stepIndex: 0,
      callId: call.callId,
      signal: writer.signal,
      timestamp: writer.now(),
      tool: call.tool,
      input: call.input,
      result: result as ToolResult,
    });
    const spill = turn.spillOf(call.callId);
    return {
      content: patch?.content ?? whole.content,
      details: patch !== undefined && "details" in patch ? patch.details : whole.details,
      ...(spill === undefined ? {} : { spill }),
    };
  } catch {
    return whole;
  }
}

/** The stored result cut to fit `cap` bytes, or `undefined` when its content already fits that cap. */
async function cut(stored: Stored, call: CodeCallEntry, cap: number): Promise<Stored | undefined> {
  const capped = await capResult({
    content: stored.content,
    details: stored.details,
    cap,
    name: call.callId,
    // The context policy's spill store is its own, so what is cut here is not kept; the host's result still holds it.
    write: () => Promise.reject(new Error("no spill store for a code call's result")),
  });
  if (capped === undefined) return undefined;
  return {
    content: capped.patch.content ?? stored.content,
    details: "details" in capped.patch ? capped.patch.details : stored.details,
    ...(stored.spill === undefined ? {} : { spill: stored.spill }),
  };
}

/**
 * Writes the call's `tool_result` from what the tool returned. A result over the store's bound is cut to fit and
 * written again, once at the bound and once at a quarter of it, so the call keeps its result and its outcome. Any other
 * failure of the store is thrown: the call then has no result, and the next code call settles it as one that may have
 * taken effect.
 */
export async function writeCodeCallResult<H>(
  harness: Harness<H>,
  writer: ResultWriter,
  tool: RegisteredTool,
  call: CodeCallEntry,
  result: ToolResult<unknown>,
): Promise<SessionEntry> {
  const entry = (stored: Stored) =>
    writer.write({
      type: "tool_result",
      callId: call.callId,
      tool: call.tool,
      content: [...stored.content],
      isError: result.isError === true,
      ...(stored.details === undefined ? {} : { details: stored.details }),
      ...(stored.spill === undefined ? {} : { spill: stored.spill }),
      trust: tool.outputTrust,
    });
  const stored = await cappedByContext(harness, writer, call, result);
  let refused: EntryTooLargeError;
  try {
    return await entry(stored);
  } catch (error) {
    if (!(error instanceof EntryTooLargeError)) throw error;
    refused = error;
  }
  for (const cap of [refused.maxBytes, refused.maxBytes >> 2]) {
    const fitted = await cut(stored, call, cap);
    if (fitted === undefined) continue;
    try {
      return await entry(fitted);
    } catch (error) {
      if (!(error instanceof EntryTooLargeError)) throw error;
    }
  }
  throw refused;
}
