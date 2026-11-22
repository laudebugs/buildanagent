/**
 * Settles what a crash left open, before a turn goes on. A message whose blocks were written without its end is ended
 * as aborted. A tool call whose result never reached the log must not get an ordinary error: for a write, or a tool
 * this harness doesn't know, the call may have taken effect, so its result says the outcome is unknown and tells the
 * model to check before any retry. A read-only call has changed nothing, so it gets an error the model may retry. A
 * turn with no end gets a `turn_end` that says it was aborted. Calls a turn left waiting for an approval or an answer
 * are not a crash: they stay open for the approval that resolves them.
 */
import { renderOutcome, writeOutcome } from "@buildanagent/agent-safety";
import type { SessionEntry, ToolResultEntry } from "@buildanagent/protocol";
import type { Harness } from "../harness.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistributiveOmit<SessionEntry, "id" | "parentId" | "timestamp" | "origin" | "seq">;

/** Writes one entry with the origin it names, after the entries before it. */
export type WriteEntry = (origin: "harness" | "model" | "tool", body: Body) => Promise<unknown>;

const READ_ONLY_TEXT = "The tool call was interrupted before a result was recorded.";

/** The result of a call that may have taken effect: `unknown`, to be checked before any retry. */
function interruptedWrite(tool: string): Pick<ToolResultEntry, "content" | "isError" | "details"> {
  const rendered = renderOutcome(
    writeOutcome({
      kind: "unknown",
      operation: tool,
      retry: "reconcile_first",
      reason: "WRITE_INTERRUPTED",
      currentState: "The call stopped before it recorded a result, so it may have taken effect.",
      next: "Check whether it took effect before you do anything else, and tell the user if you cannot.",
    }),
  );
  return {
    content: [
      { type: "text", text: rendered.text },
      { type: "text", text: JSON.stringify({ outcome: rendered.payload }) },
    ],
    isError: rendered.isError,
    details: { outcome: rendered.payload },
  };
}

/** Ends each assistant message that has blocks and no end, as aborted, so its calls are part of the context. */
async function endDanglingMessages<H>(
  path: readonly SessionEntry[],
  harness: Harness<H>,
  write: WriteEntry,
): Promise<number> {
  const ended = new Set(path.flatMap((entry) => (entry.type === "message_end" ? [entry.messageId] : [])));
  const dangling = new Set<string>();
  for (const entry of path) {
    if (entry.type === "message_block" && entry.role === "assistant" && !ended.has(entry.messageId)) {
      dangling.add(entry.messageId);
    }
  }
  const model = path.findLast((entry) => entry.type === "loadout" && entry.model !== undefined);
  const ref = model?.type === "loadout" && model.model !== undefined ? model.model : harness.model.ref;
  for (const messageId of dangling) {
    await write("model", { type: "message_end", messageId, model: ref, stopReason: "aborted" });
  }
  return dangling.size;
}

const PAUSES = new Set(["awaiting_approval", "clarification_requested"]);

/**
 * The calls the path's assistant blocks make that no `tool_result` answers, in the order the model made them. A turn
 * that ended waiting for an approval or an answer leaves its calls open on purpose, so they are left out unless
 * `includePaused` is set.
 */
export function unansweredCalls(
  path: readonly SessionEntry[],
  includePaused = false,
): { callId: string; name: string }[] {
  const answered = new Set(path.flatMap((entry) => (entry.type === "tool_result" ? [entry.callId] : [])));
  const calls: { callId: string; name: string; turn: number }[] = [];
  const paused = new Set<number>();
  let turn = -1;
  for (const entry of path) {
    if (entry.type === "turn_start") turn += 1;
    else if (entry.type === "turn_end" && PAUSES.has(entry.stopReason)) paused.add(turn);
    else if (entry.type === "message_block" && entry.role === "assistant" && entry.block.type === "tool_call") {
      if (!answered.has(entry.block.callId)) calls.push({ callId: entry.block.callId, name: entry.block.name, turn });
    }
  }
  return calls.filter((call) => includePaused || !paused.has(call.turn));
}

/**
 * Settles what a crash left open and returns whether it wrote anything. `closeTurns` is false when HEAD was moved by
 * a checkout, because a turn that has no end on the branch left behind was not interrupted.
 */
export async function settleOpenCalls<H>(
  path: readonly SessionEntry[],
  harness: Harness<H>,
  write: WriteEntry,
  closeTurns: boolean,
): Promise<boolean> {
  if (path.length === 0) return false;
  const calls = unansweredCalls(path);
  const dangling = await endDanglingMessages(path, harness, write);
  for (const call of calls) {
    const tool = harness.registry.get(call.name);
    // A tool the registry no longer has may have been a write, so its call is as uncertain as a write's.
    const mayHaveWritten = tool === undefined || tool.definition.effect?.kind === "write";
    await write("tool", {
      type: "tool_result",
      callId: call.callId,
      tool: call.name,
      ...(mayHaveWritten
        ? interruptedWrite(call.name)
        : { content: [{ type: "text", text: READ_ONLY_TEXT }], isError: true }),
      trust: tool?.outputTrust ?? "untrusted",
    } as Body);
  }
  const closed = closeTurns ? await closeTurn(path, write, dangling) : false;
  return dangling > 0 || calls.length > 0 || closed;
}

async function closeTurn(path: readonly SessionEntry[], write: WriteEntry, justEnded: number): Promise<boolean> {
  const start = path.findLast((entry) => entry.type === "turn_start");
  if (start?.type !== "turn_start") return false;
  const after = path.slice(path.indexOf(start));
  if (after.some((entry) => entry.type === "turn_end")) return false;
  await write("harness", {
    type: "turn_end",
    runId: start.runId,
    stopReason: "aborted",
    steps: after.filter((entry) => entry.type === "message_end").length + justEnded,
  });
  return true;
}
