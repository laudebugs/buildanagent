/**
 * How a session reads in a terminal. A live turn streams the model's text to standard output as it arrives and
 * reports each tool call on standard error; a replay or `sessions show` prints the same conversation from the log's
 * entries, so the two read alike. Every text the model, a tool or the log supplied goes through `visible()` or
 * `visibleBlock()`, so an escape sequence or a `\r` in it can't move the cursor or overwrite what was printed.
 */
import type { HarnessEvent, SessionEntry } from "@buildanagent/protocol";
import type { AgentEvent } from "@buildanagent/sdk";
import { chainedCommands, commandOf } from "./command-lines.js";
import type { CliIo } from "./io.js";
import { visible, visibleBlock } from "./visible.js";

const MAX_INPUT_CHARS = 200;

/**
 * A call's input on one line: a command as its chained commands, anything else as compact JSON, with control
 * characters escaped and cut at 200 characters.
 */
export function inputText(input: unknown): string {
  const command = commandOf(input);
  const text = visible(
    command === undefined
      ? (JSON.stringify(input) ?? "")
      : chainedCommands(command)
          .map((part) => `${part.operator} ${part.command}`.trim())
          .join(" "),
  );
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}…` : text;
}

/** The first line of a tool result's text, or a note that it held none. */
function resultText(entry: Extract<SessionEntry, { type: "tool_result" }>): string {
  const text = entry.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
  const first = text.split("\n")[0] ?? "";
  return `${first === "" ? "(no text)" : visible(first)}${entry.isError ? " (error)" : ""}`;
}

/** Prints a live turn's events: the answer to standard output, tool calls and results to standard error. */
export function liveRenderer(io: CliIo): (event: AgentEvent | HarnessEvent) => void {
  return (event) => {
    if (event.type === "text_delta") io.write(visibleBlock(event.delta));
    else if (event.type === "text_end") io.write("\n");
    else if (event.type === "tool_call_start") io.error(`· ${visible(event.tool)} ${inputText(event.input)}\n`);
    else if (event.type === "entry_appended" && event.entry.type === "tool_result") {
      io.error(`  ${visible(event.entry.tool)} → ${resultText(event.entry)}\n`);
    }
  };
}

/** One entry as a line of the conversation, or `undefined` for an entry a reader doesn't need. */
export function entryLine(entry: SessionEntry): string | undefined {
  switch (entry.type) {
    case "message_block": {
      const who = entry.role === "user" ? "you" : "assistant";
      if (entry.block.type === "text") return `${who}: ${visibleBlock(entry.block.text)}`;
      if (entry.block.type === "tool_call") return `· ${visible(entry.block.name)} ${inputText(entry.block.input)}`;
      return undefined;
    }
    case "tool_result":
      return `  ${visible(entry.tool)} → ${resultText(entry)}`;
    case "approval_requested":
      return `? ${visible(entry.request.tool)} waited for ${entry.request.kind === "clarification" ? "an answer" : "approval"}`;
    case "approval_resolved": {
      const { resolution } = entry;
      const answer =
        "answer" in resolution ? `answered ${visible(JSON.stringify(resolution.answer))}` : resolution.decision;
      return `  ${answer}${resolution.by === undefined ? "" : ` by ${visible(resolution.by)}`}`;
    }
    case "compaction":
      return `[earlier turns summarised: ${entry.tokensBefore} → ${entry.tokensAfter} tokens]`;
    case "turn_end":
      return `[turn ended: ${entry.stopReason} after ${entry.steps} step${entry.steps === 1 ? "" : "s"}]`;
    default:
      return undefined;
  }
}
