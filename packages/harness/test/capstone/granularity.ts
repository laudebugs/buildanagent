// HD1's settling test: three recorders of one run, at three granularities, and the code that plays each back. The
// package writes one entry per content block; these test-only observers write what a per-delta log and a per-message
// log would hold of the same run, so the three can be compared on file size, playback fidelity and resume code.
//
// Each recorder writes the model's output and each tool result, the part of the log HD1 decides on. Every line carries
// the same envelope (`seq`, `at`, `step`), the fields a log line needs to be placed and ordered. The decoders between
// the `decoder:` markers rebuild the transcript from a recorder's lines, and their line counts are the resume code
// each granularity needs.
import type { AssistantMessage, ContentBlock, Usage } from "@buildanagent/gateway";
import type { AgentEvent, Observer } from "@buildanagent/sdk";

type StopReason = AssistantMessage["stopReason"];

/** One line of a recorder's file. */
export type Line = { readonly t: string; readonly seq: number; readonly at: string; readonly step: number } & Record<
  string,
  unknown
>;

/** The transcript a playback rebuilds: each assistant message's blocks and stop reason, and each tool result. */
export type Played =
  | {
      readonly role: "assistant";
      readonly content: ContentBlock[];
      readonly stopReason: StopReason;
      readonly usage: Usage;
    }
  | { readonly role: "tool"; readonly callId: string; readonly content: unknown; readonly isError: boolean };

/** A recorder: an observer, and the lines it has written as one JSONL file. */
export interface Recorder {
  readonly observer: Observer;
  lines(): Line[];
  file(): string;
}

function recorder(lineOf: (event: AgentEvent) => Record<string, unknown>[] | undefined): Recorder {
  const lines: Line[] = [];
  return {
    observer: (event) => {
      for (const body of lineOf(event) ?? []) {
        lines.push({ ...body, seq: lines.length, at: event.timestamp, step: event.stepIndex } as Line);
      }
    },
    lines: () => lines,
    file: () => lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  };
}

/** The lines every granularity writes the same way: each tool result. */
function shared(event: AgentEvent): Record<string, unknown>[] | undefined {
  if (event.type !== "tool_call_end") return undefined;
  const { content, isError } = event.result;
  return [{ t: "tool_result", callId: event.callId, content, isError: isError === true }];
}

const messageEnd = (event: Extract<AgentEvent, { type: "model_call_end" }>) => ({
  t: "message_end",
  stopReason: event.message.stopReason,
  usage: event.message.usage,
});

/** Per delta: each block's start, every delta, and each tool call's id and name, which no delta carries. */
export function perDelta(): Recorder {
  return recorder((event) => {
    switch (event.type) {
      case "text_start":
      case "reasoning_start":
      case "tool_input_start":
        return [{ t: "start", kind: event.type.replace("_start", ""), index: event.index }];
      case "text_delta":
      case "reasoning_delta":
      case "tool_input_delta":
        return [{ t: "delta", index: event.index, delta: event.delta }];
      case "tool_input_end":
        return event.block.type === "tool_call"
          ? [{ t: "call", index: event.index, callId: event.block.callId, name: event.block.name }]
          : undefined;
      case "model_call_end":
        return [messageEnd(event)];
      default:
        return shared(event);
    }
  });
}

/** Per block: each completed block, from its end event, then the message's end. The package's own rule. */
export function perBlock(): Recorder {
  return recorder((event) => {
    switch (event.type) {
      case "text_end":
      case "reasoning_end":
      case "tool_input_end":
        return [{ t: "block", index: event.index, block: event.block }];
      case "model_call_end":
        return [messageEnd(event)];
      default:
        return shared(event);
    }
  });
}

/** Per message: each completed assistant message, whole. */
export function perMessage(): Recorder {
  return recorder((event) => {
    if (event.type !== "model_call_end") return shared(event);
    const { content, stopReason, usage } = event.message;
    return [{ t: "message", content, stopReason, usage }];
  });
}

const toolOf = (line: Line): Played => ({
  role: "tool",
  callId: line.callId as string,
  content: line.content,
  isError: line.isError as boolean,
});

// decoder:begin perDelta
export function playDeltas(lines: readonly Line[]): Played[] {
  const played: Played[] = [];
  let open = new Map<number, { kind: string; text: string; callId?: string; name?: string }>();
  for (const line of lines) {
    const index = line.index as number;
    if (line.t === "start") open.set(index, { kind: line.kind as string, text: "" });
    else if (line.t === "delta") (open.get(index) as { text: string }).text += line.delta as string;
    else if (line.t === "call") Object.assign(open.get(index) as object, { callId: line.callId, name: line.name });
    else if (line.t === "tool_result") played.push(toolOf(line));
    else if (line.t === "message_end") {
      const content = [...open.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, block]): ContentBlock => {
          if (block.kind === "text") return { type: "text", text: block.text };
          if (block.kind === "reasoning") return { type: "reasoning", text: block.text };
          const input = block.text === "" ? {} : JSON.parse(block.text);
          return { type: "tool_call", callId: block.callId as string, name: block.name as string, input };
        });
      played.push({
        role: "assistant",
        content,
        stopReason: line.stopReason as StopReason,
        usage: line.usage as Usage,
      });
      open = new Map();
    }
  }
  return played;
}
// decoder:end perDelta

// decoder:begin perBlock
export function playBlocks(lines: readonly Line[]): Played[] {
  const played: Played[] = [];
  let blocks: ContentBlock[] = [];
  for (const line of lines) {
    if (line.t === "block") blocks.push(line.block as ContentBlock);
    else if (line.t === "tool_result") played.push(toolOf(line));
    else if (line.t === "message_end") {
      played.push({
        role: "assistant",
        content: blocks,
        stopReason: line.stopReason as StopReason,
        usage: line.usage as Usage,
      });
      blocks = [];
    }
  }
  return played;
}
// decoder:end perBlock

// decoder:begin perMessage
export function playMessages(lines: readonly Line[]): Played[] {
  return lines.map((line) =>
    line.t === "tool_result"
      ? toolOf(line)
      : {
          role: "assistant",
          content: line.content as ContentBlock[],
          stopReason: line.stopReason as StopReason,
          usage: line.usage as Usage,
        },
  );
}
// decoder:end perMessage

/** The code lines between a decoder's markers, with blank lines and comments left out. */
export function decoderLines(source: string, name: string): number {
  const begin = source.indexOf(`// decoder:begin ${name}\n`);
  const end = source.indexOf(`// decoder:end ${name}\n`);
  if (begin < 0 || end < begin) throw new Error(`no decoder ${name}`);
  return source
    .slice(begin, end)
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length;
}
