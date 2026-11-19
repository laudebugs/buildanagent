/**
 * The replay pass that makes a transcript recorded on one model safe to send to another (SDK plan §3.2; guide §2;
 * HD3 rule 1). It runs before every request, so it must be pure, deterministic and idempotent: the view it builds of
 * an earlier message never changes as the transcript grows, which keeps Anthropic's thinking prefix check passing.
 */
import type { ContentBlock, Message, ModelCaps, ModelContent, ModelRef } from "./types.ts";

type Block<T extends ContentBlock["type"]> = Extract<ContentBlock, { type: T }>;
type ToolMessage = Extract<Message, { role: "tool" }>;

// The canonical tool-call id rule. A per-provider table may narrow it later; until then every target gets this one.
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOOL_CALL_ID_INVALID_CHARS = /[^A-Za-z0-9_-]/g;
const TOOL_CALL_ID_MAX_LENGTH = 64;

// Anthropic accepts thinking signed by any of its models and drops, without billing, the blocks it cannot read.
const ANTHROPIC_API = "anthropic-messages";

const IMAGE_PLACEHOLDER = "(image omitted: this model does not accept images)";
const MISSING_RESULT_TEXT = "No result was recorded for this tool call.";

/**
 * Prepares a transcript for one target model, so a conversation recorded on any provider can be sent to it. The
 * pass returns a new array and never changes `messages`; the result may share unchanged blocks with the input.
 *
 * It applies five rules:
 *
 * 1. It skips assistant turns that ended in an error or an abort, so a resumed call issues them again.
 * 2. It drops reasoning written by another provider, and strips a signature the target cannot verify. An Anthropic
 *    target keeps every Anthropic-signed block unchanged, even one whose text is empty. When reasoning must go, the
 *    pass also drops every older reasoning block, so the blocks it keeps are the newest unbroken run.
 * 3. It replaces each image with a short text note when `caps.images` is false.
 * 4. It rewrites tool-call ids that are not 1–64 letters, digits, `_` or `-`, or that repeat an earlier id, and
 *    updates each matching tool result.
 * 5. It moves each tool result next to its call, drops results that answer no call, and gives every call that lacks
 *    a result a synthetic error result. An assistant message left with no content is dropped.
 *
 * Running the pass on its own output returns the same transcript.
 */
export function transformMessages(messages: readonly Message[], target: ModelRef, caps: ModelCaps): Message[] {
  const completed = messages.filter((message) => !isFailedTurn(message));
  const reasoned = applyReasoningRules(completed, target);
  const pictured = caps.images ? reasoned : reasoned.map(withoutImages);
  return pairToolCalls(pictured);
}

function isFailedTurn(message: Message): boolean {
  return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

// Reasoning ----------------------------------------------------------------------------------------------------------

/**
 * Judges every reasoning block, then drops each one at or before the newest dropped block. A view may leave out the
 * oldest run of thinking blocks, never one in the middle (HD3 rule 1), and keeping the newest run is the choice that
 * stays stable as the transcript grows: a later drop only ever removes blocks older than itself.
 */
function applyReasoningRules(messages: readonly Message[], target: ModelRef): Message[] {
  const verdicts: Array<Block<"reasoning"> | undefined> = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    const source = message.role === "assistant" ? message.model : undefined;
    for (const block of message.content) {
      if (block.type === "reasoning") verdicts.push(judgeReasoning(block, source, target));
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
    if (message.role === "tool") return message;
    const content = message.content.flatMap((block): ContentBlock[] => {
      if (block.type !== "reasoning") return [block];
      const kept = keep();
      return kept === undefined ? [] : [kept];
    });
    return { ...message, content };
  });
}

/** The block to send, or `undefined` to drop it. Reasoning in a user message has no model to vouch for it. */
function judgeReasoning(
  block: Block<"reasoning">,
  source: ModelRef | undefined,
  target: ModelRef,
): Block<"reasoning"> | undefined {
  if (source === undefined || source.api !== target.api || source.provider !== target.provider) return undefined;
  if (block.signature === undefined || signatureFits(block.signature, target)) return block;
  return block.text === "" ? undefined : { type: "reasoning", text: block.text };
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
  answered: boolean;
}

/**
 * One assistant turn's calls, the results that answer them, and the other messages that arrive before the next turn.
 * The messages before the first assistant turn form a segment with no calls.
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
  for (const message of messages) {
    if (message.role === "assistant") {
      closeSegment(segment, output);
      const next: Segment = { calls: [], results: [], held: [] };
      segment = next;
      if (message.content.length === 0) continue;
      output.push({ ...message, content: message.content.map((block) => remapCall(block, next, allocateId)) });
    } else if (message.role === "tool") {
      answer(segment, message);
    } else {
      segment.held.push(message);
    }
  }
  closeSegment(segment, output);
  return output;
}

function remapCall(block: ContentBlock, segment: Segment, allocateId: (id: string) => string): ContentBlock {
  if (block.type !== "tool_call") return block;
  const id = allocateId(block.callId);
  segment.calls.push({ original: block.callId, id, answered: false });
  return id === block.callId ? block : { ...block, callId: id };
}

/** Matches a result to the first unanswered call with its id, so a repeated id pairs its results in order. */
function answer(segment: Segment, result: ToolMessage): void {
  const call = segment.calls.find((pending) => !pending.answered && pending.original === result.callId);
  if (call === undefined) return;
  call.answered = true;
  segment.results.push(call.id === result.callId ? result : { ...result, callId: call.id });
}

function closeSegment(segment: Segment, output: Message[]): void {
  output.push(...segment.results);
  for (const call of segment.calls) {
    if (!call.answered) output.push(syntheticResult(call.id));
  }
  output.push(...segment.held);
}

function syntheticResult(callId: string): ToolMessage {
  const content: ModelContent[] = [{ type: "text", text: MISSING_RESULT_TEXT }];
  return { role: "tool", callId, content, isError: true };
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
