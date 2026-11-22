/**
 * Settles what a crash left open, before a turn goes on. A tool call whose result never reached the log must not get
 * an ordinary error: for a write, the call may have taken effect, so its result says the outcome is unknown and tells
 * the model to check before any retry. A read-only call has changed nothing, so it gets an error the model may retry.
 * A turn with no end gets a `turn_end` that says it was aborted.
 */
import { renderOutcome, writeOutcome } from "@buildanagent/agent-safety";
import type { SessionEntry, ToolResultEntry } from "@buildanagent/protocol";
import type { Harness } from "../harness.js";
import { contextOf } from "./rebuild.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistributiveOmit<SessionEntry, "id" | "parentId" | "timestamp" | "origin" | "seq">;

/** Writes one entry with the origin it names, after the entries before it. */
export type WriteEntry = (origin: "harness" | "tool", body: Body) => Promise<unknown>;

const READ_ONLY_TEXT = "The tool call was interrupted before a result was recorded.";

/** The result of a write whose call has no result: `unknown`, to be checked before any retry. */
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

/**
 * Writes a result for every call of the rebuilt context that has none, and a `turn_end` for a turn that has none. It
 * does nothing for a log that ended cleanly.
 */
export async function settleOpenCalls<H>(
  path: readonly SessionEntry[],
  harness: Harness<H>,
  write: WriteEntry,
): Promise<void> {
  const answered = new Set<string>();
  const open: { callId: string; name: string }[] = [];
  for (const message of contextOf(path).messages) {
    if (message.role === "tool") answered.add(message.callId);
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "tool_call") open.push({ callId: block.callId, name: block.name });
    }
  }
  for (const call of open.filter((entry) => !answered.has(entry.callId))) {
    const tool = harness.registry.get(call.name);
    const isWrite = tool?.definition.effect?.kind === "write";
    await write("tool", {
      type: "tool_result",
      callId: call.callId,
      tool: call.name,
      ...(isWrite ? interruptedWrite(call.name) : { content: [{ type: "text", text: READ_ONLY_TEXT }], isError: true }),
      trust: tool?.outputTrust ?? "untrusted",
    } as Body);
  }
  await closeTurn(path, write);
}

async function closeTurn(path: readonly SessionEntry[], write: WriteEntry): Promise<void> {
  const start = path.findLast((entry) => entry.type === "turn_start");
  if (start?.type !== "turn_start") return;
  const after = path.slice(path.indexOf(start));
  if (after.some((entry) => entry.type === "turn_end")) return;
  await write("harness", {
    type: "turn_end",
    runId: start.runId,
    stopReason: "aborted",
    steps: after.filter((entry) => entry.type === "message_end").length,
  });
}
