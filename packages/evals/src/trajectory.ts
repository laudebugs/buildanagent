/**
 * `toMiniSweTrajectory()`: a session log as a mini-swe-agent trajectory, so one script reads our runs and the
 * baseline's (harness guide §10).
 *
 * The shape follows what mini-swe-agent v2.4.6 writes: `DefaultAgent.serialize()` in
 * `src/minisweagent/agents/default.py`, lines 159-180, at tag v2.4.6 (commit a83fcae), builds `info.model_stats`
 * (`instance_cost`, `api_calls`), `info.exit_status`, `info.submission`, `messages` and `trajectory_format`. The
 * assistant message is litellm's `message.model_dump()` plus `extra.cost` and `extra.timestamp`
 * (`models/litellm_model.py`, lines 99-106), a tool result is `{ role: "tool", tool_call_id, content }`
 * (`models/utils/actions_toolcall.py`, lines 95-109), and the last message has role `exit` with `extra.exit_status`
 * and `extra.submission` (`agents/default.py`, lines 104-147; `environments/local.py`, lines 46-54).
 */
import type { ContentBlock, ModelContent } from "@buildanagent/gateway";
import type { MessageBlockEntry, SessionEntry, ToolResultEntry, TurnEndEntry } from "@buildanagent/protocol";
import { classifyStop, isAgentUsage, lastTurnEnd, spendOf } from "./from-entries.js";

/** The format name mini-swe-agent 2.4.6 writes in `trajectory_format`. */
export const MINI_SWE_TRAJECTORY_FORMAT = "mini-swe-agent-1.1";

/** A tool call on an assistant message, in the OpenAI shape that litellm's `model_dump()` gives. */
export interface MiniSweToolCall {
  /** The call's id, which the tool message's `tool_call_id` names. */
  readonly id: string;
  /** Always `"function"`. */
  readonly type: "function";
  /** The tool's name and its input as a JSON string. */
  readonly function: { readonly name: string; readonly arguments: string };
}

/** The system prompt, or a user message: the task or a later instruction. */
export interface MiniSweTextMessage {
  /** Who wrote it. */
  readonly role: "system" | "user";
  /** Its text blocks, joined by newlines. */
  readonly content: string;
}

/** One model response. */
export interface MiniSweAssistantMessage {
  /** Always `"assistant"`. */
  readonly role: "assistant";
  /** Its text blocks joined by newlines, or `null` when it holds only tool calls. Reasoning blocks are left out. */
  readonly content: string | null;
  /** Its tool calls, when it made any. */
  readonly tool_calls?: readonly MiniSweToolCall[];
  /** The call's cost in US dollars, `null` when its price is unknown, and when it ended, in seconds since 1970. */
  readonly extra: { readonly cost: number | null; readonly timestamp: number };
}

/** What a tool call returned. */
export interface MiniSweToolMessage {
  /** Always `"tool"`. */
  readonly role: "tool";
  /** The id of the call this answers. */
  readonly tool_call_id: string;
  /** Its text content, joined by newlines. */
  readonly content: string;
}

/** The last message: how the run ended and what it handed in. */
export interface MiniSweExitMessage {
  /** Always `"exit"`. */
  readonly role: "exit";
  /** The submission when the run submitted one, and otherwise the exit status, as mini-swe-agent writes it. */
  readonly content: string;
  /** The same exit status and submission as `info`. */
  readonly extra: { readonly exit_status: string; readonly submission: string };
}

/** One message of a trajectory. */
export type MiniSweMessage = MiniSweTextMessage | MiniSweAssistantMessage | MiniSweToolMessage | MiniSweExitMessage;

/**
 * A trajectory in the `mini-swe-agent-1.1` format. mini-swe-agent's `info` also holds `config` and `mini_version`,
 * which describe its own agent and are left out here. One field departs from it: `instance_cost` is `null` when any
 * call's price is unknown, where mini-swe-agent stops with an error by default.
 */
export interface MiniSweTrajectoryV1_1 {
  /** Always `"mini-swe-agent-1.1"`. */
  readonly trajectory_format: typeof MINI_SWE_TRAJECTORY_FORMAT;
  /** What the run cost, how it ended and what it handed in. */
  readonly info: {
    /** The agent's spend: the dollars of every call, or `null` once one is unknown, and how many calls it made. */
    readonly model_stats: { readonly instance_cost: number | null; readonly api_calls: number };
    /**
     * How the run ended: `"Submitted"`, `"LimitsExceeded"`, `"error"` for an infra error, or `""` while no turn has
     * finished.
     */
    readonly exit_status: string;
    /** What the run handed in, or `""`. */
    readonly submission: string;
  };
  /** The system prompt, the conversation and, once the run ended, an exit message. */
  readonly messages: readonly MiniSweMessage[];
}

/** What `toMiniSweTrajectory()` takes besides the entries. */
export interface MiniSweTrajectoryOptions {
  /** What the run handed in, such as a patch. The log does not record one, so it is `""` unless given. */
  readonly submission?: string;
}

const textOf = (blocks: readonly (ContentBlock | ModelContent)[]) =>
  blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

/**
 * mini-swe-agent's exit status for a turn's stop reason, from the same classification as a row's `exit`, so the two
 * always agree: `"Submitted"` and `"LimitsExceeded"` for a submission and a limit, the stop reason itself for an
 * infra error, and `""` for a turn that has not finished, as mini-swe-agent writes before its exit message.
 */
function exitStatusOf(end: TurnEndEntry | undefined): string {
  if (end === undefined) return "";
  const kind = classifyStop(end.stopReason);
  if (kind === "unfinished") return "";
  if (kind === "infra_error") return end.stopReason;
  return kind === "submitted" ? "Submitted" : "LimitsExceeded";
}

/** Collects one message's blocks, written as separate entries, until the message is turned into a trajectory line. */
interface OpenMessage {
  readonly role: "user" | "assistant";
  readonly blocks: ContentBlock[];
  timestamp: number;
  cost: number | null;
}

function lineOf(message: OpenMessage): MiniSweMessage {
  if (message.role === "user") return { role: "user", content: textOf(message.blocks) };
  const calls = message.blocks.flatMap((block): MiniSweToolCall[] =>
    block.type === "tool_call"
      ? [{ id: block.callId, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } }]
      : [],
  );
  const text = textOf(message.blocks);
  return {
    role: "assistant",
    content: text === "" ? null : text,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
    extra: { cost: message.cost, timestamp: message.timestamp },
  };
}

/** The log's conversation, in order: one entry per block, so the blocks of a message are gathered by its id. */
function conversationOf(entries: readonly SessionEntry[]): (OpenMessage | MiniSweMessage)[] {
  const lines: (OpenMessage | MiniSweMessage)[] = [];
  const open = new Map<string, OpenMessage>();
  let system: string | undefined;
  let lastAssistant: OpenMessage | undefined;
  const seconds = (entry: SessionEntry) => Date.parse(entry.timestamp) / 1000;
  const addBlock = (entry: SessionEntry & MessageBlockEntry) => {
    let message = open.get(entry.messageId);
    if (message === undefined) {
      message = { role: entry.role, blocks: [], timestamp: seconds(entry), cost: null };
      open.set(entry.messageId, message);
      lines.push(message);
    }
    message.blocks.push(entry.block);
    if (entry.role === "assistant") lastAssistant = message;
  };
  const addResult = (entry: ToolResultEntry) =>
    lines.push({ role: "tool", tool_call_id: entry.callId, content: textOf(entry.content) });
  for (const entry of entries) {
    if (entry.type === "turn_start" && entry.system !== system) {
      // The log writes a turn's input before its turn_start, and mini-swe-agent's first message is the system prompt.
      const line = { role: "system", content: entry.system } as const;
      if (system === undefined) lines.unshift(line);
      else lines.push(line);
      system = entry.system;
    } else if (entry.type === "message_block") addBlock(entry);
    else if (entry.type === "message_end" && lastAssistant !== undefined) lastAssistant.timestamp = seconds(entry);
    else if (entry.type === "tool_result") addResult(entry);
    else if (isAgentUsage(entry) && entry.source === "model_call" && lastAssistant !== undefined) {
      lastAssistant.cost = entry.cost.total;
    }
  }
  return lines;
}

const isOpen = (line: OpenMessage | MiniSweMessage): line is OpenMessage => "blocks" in line;

/**
 * Converts a session log to a `mini-swe-agent-1.1` trajectory. `instance_cost` sums the cost of the agent's model
 * and summary calls, and is `null` when any price is unknown; `api_calls` counts those calls; a judge's call is in
 * neither. `exit_status` comes from the last turn's stop reason, classified as `toEvalRow()` classifies its `exit`:
 * `done` is `"Submitted"`; `max_steps`, `budget`, `no_progress`, `aborted` and `stopped` are `"LimitsExceeded"`;
 * `error` stays `"error"`; and a turn paused for a person gives `""` and no exit message. The messages are the first
 * system prompt (and any later one that differs), each user and assistant message, each tool result and, once the
 * last turn has finished, an exit message. Images and reasoning blocks are left out, because the format's content is text.
 */
export function toMiniSweTrajectory(
  entries: readonly SessionEntry[],
  options: MiniSweTrajectoryOptions = {},
): MiniSweTrajectoryV1_1 {
  const spend = spendOf(entries);
  const exitStatus = exitStatusOf(lastTurnEnd(entries));
  const submission = options.submission ?? "";
  const messages = conversationOf(entries).map((line) => (isOpen(line) ? lineOf(line) : line));
  if (exitStatus !== "") {
    const content = exitStatus === "Submitted" ? submission : exitStatus;
    messages.push({ role: "exit", content, extra: { exit_status: exitStatus, submission } });
  }
  return {
    trajectory_format: MINI_SWE_TRAJECTORY_FORMAT,
    info: {
      model_stats: { instance_cost: spend.costUsd, api_calls: spend.calls },
      exit_status: exitStatus,
      submission,
    },
    messages,
  };
}
