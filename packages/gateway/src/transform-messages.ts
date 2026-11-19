/**
 * The replay pass that makes a transcript recorded on one model safe to send to another (SDK plan §3.2; guide §2;
 * HD3 rule 1). It runs before every request, so it must be pure, deterministic and idempotent. As the transcript
 * grows, the thinking it sends for older turns only ever loses a leading run, which Anthropic's prefix check allows.
 */
import type { ContentBlock, Message, ModelCaps, ModelContent, ModelRef } from "./types.ts";

type Block<T extends ContentBlock["type"]> = Extract<ContentBlock, { type: T }>;
type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolMessage = Extract<Message, { role: "tool" }>;
type UserMessage = Extract<Message, { role: "user" }>;

// The canonical tool-call id rule. A per-provider table may narrow it later; until then every target gets this one.
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOOL_CALL_ID_INVALID_CHARS = /[^A-Za-z0-9_-]/g;
const TOOL_CALL_ID_MAX_LENGTH = 64;

// Anthropic accepts thinking signed by any of its models and drops, without billing, the blocks it cannot read, but
// it rejects a thinking block that has no signature.
const ANTHROPIC_API = "anthropic-messages";

const IMAGE_PLACEHOLDER = "(image omitted: this model does not accept images)";
const MISSING_RESULT_TEXT = "No result was recorded for this tool call.";

/**
 * Prepares a transcript for one target model, so a conversation recorded on any provider can be sent to it. The
 * pass returns a new array and never changes `messages`; the result may share unchanged blocks with the input.
 *
 * It applies five rules:
 *
 * 1. It skips assistant turns that ended in an error or an abort, together with the tool results that answer their
 *    calls, so a resumed call issues them again.
 * 2. It drops reasoning written by another provider, and strips a signature the target cannot verify. An Anthropic
 *    target keeps every Anthropic-signed block unchanged, even one whose text is empty, and drops every block it
 *    cannot send signed. Any other target keeps the text of a block it cannot verify, unless the text is empty. When
 *    reasoning must go, the pass also drops every older reasoning block, so the blocks it keeps are the newest
 *    unbroken run.
 * 3. It replaces each image with a short text note when `caps.images` is false.
 * 4. It rewrites tool-call ids that are not 1–64 letters, digits, `_` or `-`, or that repeat an earlier id, and
 *    updates each matching tool result.
 * 5. It moves each tool result next to its call, drops results that answer no call, and gives every call that lacks
 *    a result a synthetic error result.
 *
 * It also keeps each message to the shape both providers accept: a user message carries no reasoning or tool calls,
 * a message left with no content is dropped, and user messages that end up adjacent are merged into one.
 *
 * Running the pass on its own output returns the same transcript.
 */
export function transformMessages(messages: readonly Message[], target: ModelRef, caps: ModelCaps): Message[] {
  const cleaned = messages.map(withoutAssistantBlocks);
  const reasoned = applyReasoningRules(cleaned, target);
  const pictured = caps.images ? reasoned : reasoned.map(withoutImages);
  return mergeUserMessages(pairToolCalls(pictured));
}

function isFailedTurn(message: Message): boolean {
  return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

/** Removes reasoning and tool calls from a user message: neither provider accepts them there. */
function withoutAssistantBlocks(message: Message): Message {
  if (message.role !== "user") return message;
  if (!message.content.some(isAssistantOnly)) return message;
  return { ...message, content: message.content.filter((block) => !isAssistantOnly(block)) };
}

function isAssistantOnly(block: ContentBlock): boolean {
  return block.type === "reasoning" || block.type === "tool_call";
}

// Reasoning ----------------------------------------------------------------------------------------------------------

/**
 * Judges every reasoning block in a completed assistant turn, then drops each one at or before the newest dropped
 * block. A view may leave out the oldest run of thinking blocks, never one in the middle (HD3 rule 1). Keeping the
 * newest run means a later drop only ever removes blocks older than itself, so older thinking leaves as a leading run.
 * Failed turns are skipped later, so their reasoning is not judged and does not count as a drop.
 */
function applyReasoningRules(messages: readonly Message[], target: ModelRef): Message[] {
  const verdicts: Array<Block<"reasoning"> | undefined> = [];
  for (const message of messages) {
    if (message.role !== "assistant" || isFailedTurn(message)) continue;
    for (const block of message.content) {
      if (block.type === "reasoning") verdicts.push(judgeReasoning(block, message.model, target));
    }
  }
  const lastDropped = verdicts.lastIndexOf(undefined);
  let position = 0;
  const keep = (): Block<"reasoning"> | undefined => {
    const verdict = verdicts[position];
    position += 1;
    return position - 1 > lastDropped ? verdict : undefined;
  };
  return messages.map((message) => {
    if (message.role !== "assistant" || isFailedTurn(message)) return message;
    const content = message.content.flatMap((block): ContentBlock[] => {
      if (block.type !== "reasoning") return [block];
      const kept = keep();
      return kept === undefined ? [] : [kept];
    });
    return { ...message, content };
  });
}

/** The block to send, or `undefined` to drop it. */
function judgeReasoning(block: Block<"reasoning">, source: ModelRef, target: ModelRef): Block<"reasoning"> | undefined {
  if (source.api !== target.api || source.provider !== target.provider) return undefined;
  if (block.signature !== undefined && signatureFits(block.signature, target)) return block;
  if (target.api === ANTHROPIC_API || block.text === "") return undefined;
  return block.signature === undefined ? block : { type: "reasoning", text: block.text };
}

function signatureFits(signature: NonNullable<Block<"reasoning">["signature"]>, target: ModelRef): boolean {
  if (signature.api !== target.api || signature.provider !== target.provider) return false;
  return target.api === ANTHROPIC_API || signature.model === target.id;
}

// Images -------------------------------------------------------------------------------------------------------------

function withoutImages(message: Message): Message {
  if (message.role === "tool") return { ...message, content: message.content.map(imageToText) };
  return { ...message, content: message.content.map(imageToText) };
}

function imageToText<T extends ContentBlock>(block: T): T | Block<"text"> {
  return block.type === "image" ? { type: "text", text: IMAGE_PLACEHOLDER } : block;
}

// Tool calls and results ---------------------------------------------------------------------------------------------

interface PendingCall {
  readonly original: string;
  readonly id: string;
  /** Counts assistant turns, so a result can prefer the newest turn that made a call with its id. */
  readonly turn: number;
  /** True for a call from a failed turn: a result that answers it is dropped with the turn. */
  readonly skipped: boolean;
  answered: boolean;
}

/**
 * One assistant turn's calls, the results that answer them, and the other messages that arrive before the next turn.
 * Failed turns and assistant messages left with no content add no turn of their own; a failed turn's calls join the
 * open segment only to absorb their results. The messages before the first assistant turn form a segment with no
 * calls of its own.
 */
interface Segment {
  readonly calls: PendingCall[];
  readonly results: ToolMessage[];
  readonly held: Message[];
}

function pairToolCalls(messages: readonly Message[]): Message[] {
  const allocateId = idAllocator();
  const output: Message[] = [];
  let segment: Segment = { calls: [], results: [], held: [] };
  let turn = 0;
  for (const message of messages) {
    if (message.role === "assistant") {
      turn += 1;
      if (isFailedTurn(message)) {
        absorbFailedTurn(message, segment, turn);
      } else if (message.content.length > 0) {
        // An emptied message never reaches this branch, so it leaves the segment open for the previous turn's results.
        closeSegment(segment, output);
        segment = { calls: [], results: [], held: [] };
        output.push(openTurn(message, segment, turn, allocateId));
      }
    } else if (message.role === "tool") {
      answer(segment, message);
    } else if (message.content.length > 0) {
      segment.held.push(message);
    }
  }
  closeSegment(segment, output);
  return output;
}

/** Adds a failed turn's calls to the open segment, so the results that answer them are dropped with the turn. */
function absorbFailedTurn(message: AssistantMessage, segment: Segment, turn: number): void {
  for (const block of message.content) {
    if (block.type !== "tool_call") continue;
    segment.calls.push({ original: block.callId, id: block.callId, turn, skipped: true, answered: false });
  }
}

function openTurn(
  message: AssistantMessage,
  segment: Segment,
  turn: number,
  allocateId: (id: string) => string,
): AssistantMessage {
  return { ...message, content: message.content.map((block) => remapCall(block, segment, turn, allocateId)) };
}

function remapCall(
  block: ContentBlock,
  segment: Segment,
  turn: number,
  allocateId: (id: string) => string,
): ContentBlock {
  if (block.type !== "tool_call") return block;
  const id = allocateId(block.callId);
  segment.calls.push({ original: block.callId, id, turn, skipped: false, answered: false });
  return id === block.callId ? block : { ...block, callId: id };
}

/**
 * Matches a result to an unanswered call with its id, preferring the newest turn and, within it, the first call, so
 * a repeated id pairs its results in order and a failed turn's result never answers an earlier call.
 */
function answer(segment: Segment, result: ToolMessage): void {
  let call: PendingCall | undefined;
  for (const pending of segment.calls) {
    if (pending.answered || pending.original !== result.callId) continue;
    if (call === undefined || pending.turn > call.turn) call = pending;
  }
  if (call === undefined) return;
  call.answered = true;
  if (call.skipped) return;
  segment.results.push(call.id === result.callId ? result : { ...result, callId: call.id });
}

function closeSegment(segment: Segment, output: Message[]): void {
  output.push(...segment.results);
  for (const call of segment.calls) {
    if (!call.answered && !call.skipped) output.push(syntheticResult(call.id));
  }
  output.push(...segment.held);
}

function syntheticResult(callId: string): ToolMessage {
  const content: ModelContent[] = [{ type: "text", text: MISSING_RESULT_TEXT }];
  return { role: "tool", callId, content, isError: true };
}

/** Concatenates the content of adjacent user messages, so the output never holds two user messages in a row. */
function mergeUserMessages(messages: readonly Message[]): Message[] {
  const output: Message[] = [];
  for (const message of messages) {
    const last = output.at(-1);
    if (message.role === "user" && last?.role === "user") {
      const merged: UserMessage = { role: "user", content: [...last.content, ...message.content] };
      output[output.length - 1] = merged;
    } else {
      output.push(message);
    }
  }
  return output;
}

/**
 * Returns a function that maps each tool-call id, in transcript order, to a valid id no earlier call uses. A valid,
 * unused id is kept, so a second pass changes nothing.
 */
function idAllocator(): (original: string) => string {
  const taken = new Set<string>();
  return (original) => {
    const base = TOOL_CALL_ID_PATTERN.test(original) ? original : sanitizeId(original);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) {
      const suffix = `_${n}`;
      id = base.slice(0, TOOL_CALL_ID_MAX_LENGTH - suffix.length) + suffix;
    }
    taken.add(id);
    return id;
  };
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(TOOL_CALL_ID_INVALID_CHARS, "_").slice(0, TOOL_CALL_ID_MAX_LENGTH);
  return cleaned === "" ? "call" : cleaned;
}
