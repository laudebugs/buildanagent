/**
 * `repairInterruptedWrite()`: an interrupted write tool part as an `unknown` outcome. Cloudflare `AIChatAgent`
 * (`@cloudflare/ai-chat` 0.12.2) repairs a tool part left without a result, such as one whose `execute()` died with an
 * evicted isolate, before each turn. Its default `repairInterruptedToolPart` turns the part into an `output-error`
 * that reads "The tool call was interrupted before a result was recorded.", which the model takes as a failure it may
 * retry. For a write, the honest result is `unknown`: the call may have taken effect. The `ai` import is type-only.
 */
import type { UIMessage } from "ai";
import { type WriteOutcome, writeOutcome } from "../outcome.js";

type Part = UIMessage["parts"][number];

function toolName(part: Part): string | undefined {
  const tool = part as { type: string; toolName?: unknown; toolCallId?: unknown };
  if (typeof tool.toolCallId !== "string") return undefined;
  if (tool.type === "dynamic-tool") return typeof tool.toolName === "string" ? tool.toolName : undefined;
  return tool.type.startsWith("tool-") ? tool.type.slice("tool-".length) : undefined;
}

/** The outcome an interrupted call of `operation` reports: `unknown`, to be checked before any retry. */
function interrupted(operation: string): WriteOutcome {
  return writeOutcome({
    kind: "unknown",
    operation,
    retry: "reconcile_first",
    reason: "WRITE_INTERRUPTED",
    currentState: "The call stopped before it recorded a result, so it may have taken effect.",
    next: "Check whether it took effect before you do anything else, and tell the user if you cannot.",
  });
}

/**
 * Returns `part` settled as `output-available` with an `unknown` write outcome as its output, if its tool is one of
 * `writes` and `execute` may have started, or `undefined` for any other tool or a part still streaming its input or
 * awaiting approval, so the caller keeps the default repair for those. Use it in an
 * `AIChatAgent`'s `repairInterruptedToolPart` override, and convert the stored messages with the agent's tools, so a
 * tool whose `toModelOutput` calls `toAiToolResult()` hands the model the outcome as an `error-json` result.
 *
 * The outcome carries no effect key, because the repair runs synchronously and the key's hash is async. A tool wrapped
 * in `guardedWrite()` finds its own record again when the model calls it for the same business key.
 *
 * @example
 * ```ts
 * protected override repairInterruptedToolPart(part: UIMessage["parts"][number]) {
 *   return repairInterruptedWrite(part, WRITE_TOOLS) ?? super.repairInterruptedToolPart(part);
 * }
 * ```
 */
export function repairInterruptedWrite<PART extends Part>(part: PART, writes: ReadonlySet<string>): PART | undefined {
  const name = toolName(part);
  if (name === undefined || !writes.has(name)) return undefined;
  // `execute` starts only once the input is complete and any approval is granted, so a part in an earlier state never
  // ran; the default repair, which reports a failure the model may retry, is the honest one for it.
  const state = (part as { state?: unknown }).state;
  if (state === "input-streaming" || state === "approval-requested") return undefined;
  // `ai` 7.0.173's UI message validator takes an `output-available` tool part with any output and no error text; an
  // approval the part keeps is a granted one, because the agent settles a denied part as `output-denied` first.
  const { errorText: _dropped, ...rest } = part as Part & { errorText?: unknown };
  return { ...rest, state: "output-available", output: interrupted(name) } as unknown as PART;
}
