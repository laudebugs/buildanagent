/**
 * Rebuilds the SDK's `Context` from a session's entries, so the log is the only state: any process can read the log
 * and go on with `continueRun()`. A message is the `message_block` entries that share a `messageId`, in `index` order;
 * an assistant message is closed by its `message_end` and takes its usage and cost from the `usage` entry right after
 * it. A `usage` entry anywhere else belongs to a call whose message was superseded, and builds no message. A code
 * call is the host's, not the model's, so its entries build no message either.
 */

import type { AssistantMessage, ContentBlock, Message } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import type { Context, SignedPendingRequest } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import { ESCALATION_TOOL } from "./escalation-log.js";

type Block = Extract<SessionEntry, { type: "message_block" }>;
type Pending = { role: "user" | "assistant"; id: string; blocks: Block[]; firstId: string };

const ordered = (blocks: readonly Block[]): ContentBlock[] =>
  [...blocks].sort((a, b) => a.index - b.index).map((entry) => entry.block);

/** Builds messages from entries one at a time, keeping a message open until the entry that ends it arrives. */
class MessageBuilder {
  readonly messages: Message[] = [];
  /** The id of the first entry of each message, in step with `messages`. */
  readonly starts: string[] = [];
  #open: Pending | undefined;
  readonly #dropEmpty: ReadonlySet<string>;
  #ended: Extract<SessionEntry, { type: "message_end" }> | undefined;

  constructor(dropEmpty: ReadonlySet<string> = new Set()) {
    this.#dropEmpty = dropEmpty;
  }

  /** Closes the user message being built, if there is one. */
  #closeUser(): void {
    if (this.#open?.role !== "user") return;
    this.messages.push({ role: "user", content: ordered(this.#open.blocks) });
    this.starts.push(this.#open.firstId);
    this.#open = undefined;
  }

  block(entry: Block): void {
    this.#settleEnded(undefined);
    if (this.#open === undefined || this.#open.id !== entry.messageId || this.#open.role !== entry.role) {
      this.#closeUser();
      this.#open = { role: entry.role, id: entry.messageId, blocks: [], firstId: entry.id };
    }
    this.#open.blocks.push(entry);
  }

  /** An assistant message with no usage entry after it still counts, with unknown cost. */
  #settleEnded(usage: Extract<SessionEntry, { type: "usage" }> | undefined): void {
    const end = this.#ended;
    const open = this.#open;
    if (end === undefined || open === undefined) return;
    this.#ended = undefined;
    this.#open = undefined;
    // A message whose signed reasoning was left out and that has nothing else would be an empty assistant turn.
    if (open.blocks.length === 0 && this.#dropEmpty.has(open.id)) return;
    const message: AssistantMessage = {
      role: "assistant",
      content: ordered(open.blocks),
      model: end.model,
      stopReason: end.stopReason,
      ...(end.error === undefined ? {} : { error: end.error }),
      usage: usage?.usage ?? EMPTY_USAGE,
      ...(usage?.lastAttemptUsage === undefined ? {} : { lastAttemptUsage: usage.lastAttemptUsage }),
      cost: usage?.cost ?? EMPTY_COST,
    };
    this.messages.push(message);
    this.starts.push(open.firstId);
  }

  end(entry: Extract<SessionEntry, { type: "message_end" }>): void {
    this.#settleEnded(undefined);
    if (this.#open?.role !== "assistant" || this.#open.id !== entry.messageId) {
      // A message with no blocks has no open message to close.
      this.#closeUser();
      this.#open = { role: "assistant", id: entry.messageId, blocks: [], firstId: entry.id };
    }
    this.#ended = entry;
  }

  usage(entry: Extract<SessionEntry, { type: "usage" }>): void {
    if (entry.source === "model_call" && this.#ended !== undefined) this.#settleEnded(entry);
  }

  toolResult(entry: Extract<SessionEntry, { type: "tool_result" }>): void {
    this.#settleEnded(undefined);
    this.#closeUser();
    this.messages.push({ role: "tool", callId: entry.callId, content: entry.content, isError: entry.isError });
    this.starts.push(entry.id);
  }

  finish(): Message[] {
    this.#settleEnded(undefined);
    this.#closeUser();
    return this.messages;
  }
}

// A message with no usage entry, which a crash between the two writes leaves, has no usage anyone knows.
const EMPTY_USAGE: AssistantMessage["usage"] = {
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: { "5m": 0, "1h": 0 },
  output: 0,
  reasoning: 0,
  raw: null,
};
const EMPTY_COST: AssistantMessage["cost"] = { total: null, basis: "unknown", currency: "USD" };

/** A request that waits for a person, with the input its call would run with once approved. */
export interface PendingApproval {
  readonly request: SignedPendingRequest;
  readonly input: unknown;
}

/**
 * The requests on `path` that still wait: the latest request for each call of the last assistant message, while the call
 * has no result. A resolution does not end a wait, because the run that applies it may refuse it or never finish: only
 * the call's result does. A resume that started and died before the result is a crash, which `crashedResumes()` names,
 * and its requests do not wait.
 */
export function pendingApprovals(path: readonly SessionEntry[]): PendingApproval[] {
  const answered = new Set<string>();
  const latest = new Map<string, PendingApproval>();
  let lastMessage: string | undefined;
  let lastCalls = new Set<string>();
  for (const entry of path) {
    if (entry.type === "tool_result") answered.add(entry.callId);
    if (entry.type === "approval_requested")
      latest.set(entry.request.callId, { request: entry.request, input: entry.input });
    if (entry.type === "message_block" && entry.role === "assistant") {
      if (entry.messageId !== lastMessage) lastCalls = new Set();
      lastMessage = entry.messageId;
      if (entry.block.type === "tool_call") lastCalls.add(entry.block.callId);
    }
  }
  const crashed = crashedResumes(path);
  return [...latest.values()].filter(
    (entry) =>
      lastCalls.has(entry.request.callId) && !answered.has(entry.request.callId) && !crashed.has(entry.request.id),
  );
}

/**
 * The ids of the requests whose resume started and died: the log ends in a `continue` turn that has no end, after
 * allows were written for it. An approved call may have run, so it is settled as a crash and not asked again, even
 * when the run died before it reached that call.
 */
export function crashedResumes(path: readonly SessionEntry[]): Set<string> {
  const start = path.findLastIndex((entry) => entry.type === "turn_start");
  const turn = path[start];
  if (turn?.type !== "turn_start" || turn.mode !== "continue") return new Set();
  if (path.slice(start).some((entry) => entry.type === "turn_end")) return new Set();
  // Only the allows this run was given: a deny or an answer runs nothing, and an earlier run's answers are its own.
  const since = path.slice(0, start).findLastIndex((entry) => entry.type === "turn_end");
  return new Set(
    path.slice(since + 1, start).flatMap((entry) => {
      const answer = entry.type === "approval_resolved" && entry.quorum === undefined ? entry.resolution : undefined;
      return answer !== undefined && "decision" in answer && answer.decision === "allow" ? [answer.requestId] : [];
    }),
  );
}

const isSignedReasoning = (entry: SessionEntry): boolean =>
  entry.type === "message_block" && entry.block.type === "reasoning" && entry.block.signature !== undefined;

/** The user message that stands for the summarised span, so the model reads the summary where the span was. */
export function summaryMessage(summary: string): Message {
  return {
    role: "user",
    content: [
      { type: "text", text: `The earlier part of this conversation was summarized to save space:\n\n${summary}` },
    ],
  };
}

/**
 * The entries a context is built from, and whether a compaction applies. The latest `compaction` on the path replaces
 * everything before its `firstKeptEntryId`. The kept tail loses its signed reasoning, because a block that follows the
 * edited span would carry a signature the summary made stale; blocks written after the compaction are untouched.
 */
export function entriesAfterCompaction(path: readonly SessionEntry[]): {
  readonly entries: readonly SessionEntry[];
  readonly summary: string | undefined;
  /** The ids of messages that lost a signed reasoning block. */
  readonly stripped: ReadonlySet<string>;
} {
  const at = path.findLastIndex((entry) => entry.type === "compaction");
  const compaction = path[at];
  if (compaction?.type !== "compaction") return { entries: path, summary: undefined, stripped: new Set() };
  const kept = path.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  if (kept < 0) {
    throw new HarnessError(
      "entry_not_found",
      `the compaction ${compaction.id} keeps from entry ${compaction.firstKeptEntryId}, which is not on this path`,
    );
  }
  // The messages that lose a block here are the only ones an empty result may drop.
  const stripped = new Set<string>();
  const entries = path.slice(kept).filter((entry, i) => {
    const drop = kept + i < at && isSignedReasoning(entry);
    if (drop && entry.type === "message_block") stripped.add(entry.messageId);
    return !drop;
  });
  return { entries: entries.filter((entry) => entry.type !== "compaction"), summary: compaction.summary, stripped };
}

/**
 * The context a path of entries stands for, with the id of the entry each message starts at (`null` for a summary).
 * `path` is a session's `path()`: the root to a HEAD, without `checkout` entries. The system prompt is the latest
 * `turn_start`'s, byte for byte, so a harness whose prompt changed later still rebuilds the conversation the model
 * saw. The latest compaction applies: its summary stands first, then the kept tail and what followed it.
 */
export function contextWithStarts(path: readonly SessionEntry[]): {
  readonly context: Context;
  readonly starts: readonly (string | null)[];
} {
  const { entries, summary, stripped } = entriesAfterCompaction(path);
  const builder = new MessageBuilder(stripped);
  let system = "";
  for (const entry of path) if (entry.type === "turn_start") system = entry.system;
  // A code call's or a sandbox escalation's result answers no call the model made, so the model never reads it. Both
  // are known by their call ids, never by the result's tool name: the model can call a tool named `sandbox.escalation`,
  // and its error result must stay, or the rebuilt context would hold a tool call with no result.
  const hostCalls = new Set(
    path.flatMap((entry) => {
      if (entry.type === "code_call") return [entry.callId];
      if (entry.type === "approval_requested" && entry.request.tool === ESCALATION_TOOL) return [entry.request.callId];
      return [];
    }),
  );
  for (const entry of entries) {
    if (entry.type === "tool_result" && hostCalls.has(entry.callId)) continue;
    switch (entry.type) {
      case "message_block":
        builder.block(entry);
        break;
      case "message_end":
        builder.end(entry);
        break;
      case "usage":
        builder.usage(entry);
        break;
      case "tool_result":
        builder.toolResult(entry);
        break;
      default:
    }
  }
  const built = builder.finish();
  const messages = summary === undefined ? built : [summaryMessage(summary), ...built];
  const starts = summary === undefined ? builder.starts : [null, ...builder.starts];
  const waiting = pendingApprovals(path);
  if (waiting.length === 0) return { context: { system, messages }, starts };
  return {
    context: {
      system,
      messages,
      pending: waiting.map((entry) => entry.request),
      pendingInputs: Object.fromEntries(waiting.map((entry) => [entry.request.id, entry.input])),
    },
    starts,
  };
}

/** The context a path of entries stands for. See `contextWithStarts()`. */
export function contextOf(path: readonly SessionEntry[]): Context {
  return contextWithStarts(path).context;
}
