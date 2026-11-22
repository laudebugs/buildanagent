/**
 * The replay pass that makes a transcript recorded on one model safe to send to another (SDK plan §3.2; guide §2;
 * HD3 rule 1). It runs before every request, so it must be pure, deterministic and idempotent. As the transcript
 * grows, an Anthropic target loses older turns' thinking only as a leading run, which Anthropic's rule on omitted
 * thinking allows.
 */
import { GatewayError } from "./errors.js";
import { isCanonicalName } from "./names.js";
import type { ContentBlock, Message, ModelCaps, ModelContent, ModelRef } from "./types.js";

type Block<T extends ContentBlock["type"]> = Extract<ContentBlock, { type: T }>;
type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolMessage = Extract<Message, { role: "tool" }>;
type UserMessage = Extract<Message, { role: "user" }>;

// Every target gets tool-call ids that meet the canonical tool-name rule (names.ts). These two constants rebuild an id
// that breaks it, so they must stay in step with that rule.
const TOOL_CALL_ID_INVALID_CHARS = /[^A-Za-z0-9_-]/g;
const TOOL_CALL_ID_MAX_LENGTH = 64;

// Anthropic drops, without billing, the thinking blocks the target model cannot read, and verifies each block by its
// signature. Outside tool use, a request may omit earlier turns' thinking, but not a block between two kept blocks.
const ANTHROPIC_API = "anthropic-messages";

const IMAGE_PLACEHOLDER = "(image omitted: this model does not accept images)";
const MISSING_RESULT_TEXT = "No result was recorded for this tool call.";
// Anthropic requires the first message to come from the user, so an emptied opening user message leaves this note.
const CONTINUED_TEXT = "(continued)";

/**
 * Prepares a transcript for one target model, so a conversation recorded on any provider can be sent to it. The
 * pass returns a new array and never changes `messages`; the result may share unchanged blocks with the input.
 *
 * It applies five rules:
 *
 * 1. It skips assistant turns that ended in an error or an abort, together with the tool results that answer their
 *    calls, so a resumed request asks the model again.
 * 2. It drops every reasoning block when `caps.reasoning` is false. Otherwise it drops reasoning written by another
 *    provider, and strips a signature the target cannot verify. An Anthropic target keeps every Anthropic-signed
 *    block unchanged, even one whose text is empty, and drops every block it cannot send signed. When one block must
 *    go, every older reasoning block goes with it, because Anthropic lets a request omit earlier thinking but not a
 *    block between two kept blocks. Any other target keeps the text of a block it cannot verify, unless the text is
 *    empty.
 * 3. It replaces each image with a short text note when `caps.images` is false.
 * 4. It rewrites tool-call ids that are not 1–64 letters, digits, `_` or `-`, or that repeat an earlier id, and
 *    updates each matching tool result.
 * 5. It moves each tool result next to its call, however much later the result appears, drops results that answer
 *    no call, and gives every call that lacks a result a synthetic error result. A result answers the newest earlier
 *    call with its id from a completed turn, and answers a skipped turn's call only when no such call is waiting.
 *
 * It also keeps each message to the shape both providers accept. A user message carries no reasoning or tool calls,
 * no message carries an empty text block, and a message left with no content is dropped. Adjacent user messages are
 * merged into one, and so are adjacent assistant messages: the merged message takes the later one's stop reason,
 * usage and cost, and drops the later one's reasoning if the earlier one has text or tool calls, so reasoning never
 * follows a block it did not follow before. If the input holds a user message, the output starts with one, using a
 * short placeholder note when the opening user message was emptied. An input left with nothing to send returns `[]`.
 *
 * Running the pass on its own output returns the same transcript.
 *
 * @throws {GatewayError} with code `invalid_message` when a message's role is not `user`, `assistant` or `tool`, such
 * as a `system` message cast into the transcript. System text belongs in `ModelContext.system`.
 */
export function transformMessages(messages: readonly Message[], target: ModelRef, caps: ModelCaps): Message[] {
  assertKnownRoles(messages);
  const cleaned = messages.map((message) => withSendableBlocks(message, caps));
  const reasoned = caps.reasoning ? applyReasoningRules(cleaned, target) : cleaned;
  const merged = mergeAdjacentMessages(pairToolCalls(reasoned), target);
  return startWithUser(
    merged,
    messages.some((message) => message.role === "user"),
  );
}

// Message has no system role, so a cast one would otherwise match no rule below and vanish without a trace.
function assertKnownRoles(messages: readonly Message[]): void {
  messages.forEach((message, index) => {
    const role: string = message.role;
    if (role === "user" || role === "assistant" || role === "tool") return;
    const hint = role === "system" ? " Put system text in ModelContext.system." : "";
    throw new GatewayError(
      "invalid_message",
      `transformMessages(): message ${index} has role "${role}", but a transcript holds only user, assistant and tool messages.${hint}`,
    );
  });
}

function isFailedTurn(message: Message): boolean {
  return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

// Blocks -------------------------------------------------------------------------------------------------------------

/**
 * Removes the blocks no target accepts in this message: reasoning and tool calls in a user message, empty text, and
 * reasoning when the target does not reason. Replaces images when the target takes none.
 */
function withSendableBlocks(message: Message, caps: ModelCaps): Message {
  if (message.role === "tool") return caps.images ? message : { ...message, content: message.content.map(imageToText) };
  const content = message.content.flatMap((block) => sendableBlock(block, message.role === "user", caps));
  return { ...message, content };
}

function sendableBlock(block: ContentBlock, inUserMessage: boolean, caps: ModelCaps): ContentBlock[] {
  if (block.type === "text") return block.text === "" ? [] : [block];
  if (block.type === "image") return [caps.images ? block : imageToText(block)];
  if (block.type === "tool_call") return inUserMessage ? [] : [block];
  return inUserMessage || !caps.reasoning ? [] : [block];
}

function imageToText<T extends ContentBlock>(block: T): T | Block<"text"> {
  return block.type === "image" ? { type: "text", text: IMAGE_PLACEHOLDER } : block;
}

// Reasoning ----------------------------------------------------------------------------------------------------------

/**
 * Judges every reasoning block in a completed assistant turn. For an Anthropic target it then drops each one at or
 * before the newest dropped block, because a request may omit the oldest run of thinking blocks, never one in the
 * middle (HD3 rule 1). Keeping the newest run means a later drop only ever removes blocks older than itself, so older
 * thinking leaves as a leading run. Other targets check no such order, so they lose only the blocks judged unsendable.
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
  const lastDropped = target.api === ANTHROPIC_API ? verdicts.lastIndexOf(undefined) : -1;
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

// Tool calls and results ---------------------------------------------------------------------------------------------

interface Call {
  readonly original: string;
  readonly id: string;
  /** The index of the assistant message that made the call, so a result can prefer the newest turn. */
  readonly turn: number;
  /** True for a call from a failed turn: a result that answers it is dropped with the turn. */
  readonly skipped: boolean;
  answered: boolean;
  result?: ToolMessage;
}

/** A completed assistant turn with its calls in order, each of which later gets its result. */
interface Turn {
  readonly message: AssistantMessage;
  readonly calls: readonly Call[];
}

/**
 * Pairs every result with a call made before it, across the whole transcript, then writes each completed turn
 * followed by its calls' results in call order. User messages keep their place; a tool result appears only after the
 * turn it answers.
 */
function pairToolCalls(messages: readonly Message[]): Message[] {
  const allocateId = idAllocator();
  const calls: Call[] = [];
  const turns = new Map<number, Turn>();
  messages.forEach((message, index) => {
    if (message.role === "tool") {
      answer(calls, message);
    } else if (message.role === "assistant" && isFailedTurn(message)) {
      for (const block of message.content) {
        if (block.type !== "tool_call") continue;
        calls.push({ original: block.callId, id: block.callId, turn: index, skipped: true, answered: false });
      }
    } else if (message.role === "assistant" && message.content.length > 0) {
      const turn = openTurn(message, index, allocateId);
      calls.push(...turn.calls);
      turns.set(index, turn);
    }
  });
  const output: Message[] = [];
  messages.forEach((message, index) => {
    const turn = turns.get(index);
    if (turn !== undefined) {
      output.push(turn.message, ...turn.calls.map((call) => call.result ?? syntheticResult(call.id)));
    } else if (message.role === "user" && message.content.length > 0) {
      output.push(message);
    }
  });
  return output;
}

function openTurn(message: AssistantMessage, index: number, allocateId: (id: string) => string): Turn {
  const calls: Call[] = [];
  const content = message.content.map((block): ContentBlock => {
    if (block.type !== "tool_call") return block;
    const id = allocateId(block.callId);
    calls.push({ original: block.callId, id, turn: index, skipped: false, answered: false });
    return id === block.callId ? block : { ...block, callId: id };
  });
  return { message: { ...message, content }, calls };
}

/**
 * Gives a result to an unanswered earlier call with its id. A completed turn's call beats a skipped one, so a failed
 * turn never takes a result a completed turn is waiting for; then the newest turn wins and, within it, the first
 * call, so a repeated id pairs its results in order.
 */
function answer(calls: readonly Call[], result: ToolMessage): void {
  let best: Call | undefined;
  for (const call of calls) {
    if (call.answered || call.original !== result.callId) continue;
    if (best === undefined || outranks(call, best)) best = call;
  }
  if (best === undefined) return;
  best.answered = true;
  if (!best.skipped) best.result = best.id === result.callId ? result : { ...result, callId: best.id };
}

function outranks(call: Call, best: Call): boolean {
  if (call.skipped !== best.skipped) return !call.skipped;
  return call.turn > best.turn;
}

function syntheticResult(callId: string): ToolMessage {
  const content: ModelContent[] = [{ type: "text", text: MISSING_RESULT_TEXT }];
  return { role: "tool", callId, content, isError: true };
}

// Message shape ------------------------------------------------------------------------------------------------------

/**
 * Merges adjacent messages of the same role. When a merge drops reasoning and the target is Anthropic, every older
 * reasoning block goes too, as in the reasoning rule, and a second merge joins the messages that leaves adjacent.
 * That merge drops no reasoning, because none is left at or before the first merge's drop.
 */
function mergeAdjacentMessages(messages: readonly Message[], target: ModelRef): Message[] {
  const first = mergeOnce(messages);
  if (first.droppedThrough < 0 || target.api !== ANTHROPIC_API) return first.merged;
  return mergeOnce(withoutReasoningThrough(first.merged, first.droppedThrough)).merged;
}

interface MergeResult {
  readonly merged: Message[];
  /** The index of the newest merged message that lost reasoning, or -1. */
  readonly droppedThrough: number;
}

/** Joins each run of adjacent user or assistant messages into one, and drops messages left with no content. */
function mergeOnce(messages: readonly Message[]): MergeResult {
  const merged: Message[] = [];
  let droppedThrough = -1;
  for (const message of messages) {
    if (message.role !== "tool" && message.content.length === 0) continue;
    const last = merged.at(-1);
    if (message.role === "user" && last?.role === "user") {
      const joined: UserMessage = { role: "user", content: [...last.content, ...message.content] };
      merged[merged.length - 1] = joined;
    } else if (message.role === "assistant" && last?.role === "assistant") {
      const { joined, dropped } = joinAssistant(last, message);
      merged[merged.length - 1] = joined;
      if (dropped) droppedThrough = merged.length - 1;
    } else {
      merged.push(message);
    }
  }
  return { merged, droppedThrough };
}

/**
 * Appends a later assistant message to an earlier one. The later reasoning is dropped when the earlier message has
 * text or tool calls, since it would otherwise follow them. Kept reasoning was judged against its own message's
 * model, so the merged message keeps the earlier model when the earlier message carries reasoning.
 */
function joinAssistant(
  earlier: AssistantMessage,
  later: AssistantMessage,
): { joined: AssistantMessage; dropped: boolean } {
  const hasBody = earlier.content.some((block) => block.type !== "reasoning");
  const appended = hasBody ? later.content.filter((block) => block.type !== "reasoning") : later.content;
  const model = earlier.content.some((block) => block.type === "reasoning") ? earlier.model : later.model;
  const joined: AssistantMessage = { ...later, model, content: [...earlier.content, ...appended] };
  return { joined, dropped: appended.length < later.content.length };
}

function withoutReasoningThrough(messages: readonly Message[], through: number): Message[] {
  return messages.map((message, index) => {
    if (index > through || message.role !== "assistant") return message;
    return { ...message, content: message.content.filter((block) => block.type !== "reasoning") };
  });
}

function startWithUser(messages: Message[], inputHadUser: boolean): Message[] {
  if (!inputHadUser || messages.length === 0 || messages[0]?.role === "user") return messages;
  return [{ role: "user", content: [{ type: "text", text: CONTINUED_TEXT }] }, ...messages];
}

/**
 * Returns a function that maps each tool-call id, in transcript order, to a valid id no earlier call uses. A valid,
 * unused id is kept, so a second pass changes nothing.
 */
function idAllocator(): (original: string) => string {
  const taken = new Set<string>();
  return (original) => {
    const base = isCanonicalName(original) ? original : sanitizeId(original);
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
