/**
 * Layer 2: mask older tool results in the request view, in steps. Only the view changes; the log keeps every result. The
 * cutoff moves once every `stepMessages` messages, so the view's prefix stays byte-identical in between and a provider's
 * prompt cache keeps hitting it.
 */
import type { AssistantMessage, Message, ModelContent } from "@buildanagent/gateway";
import { textOf } from "./write-cap.js";

/** The settings masking uses. */
export interface MaskSettings {
  readonly keepChars: number;
  readonly stepMessages: number;
}

/** The message index before which tool results are masked: it moves forward in whole steps as the transcript grows. */
export function cutoffFor(length: number, stepMessages: number): number {
  return Math.max(0, Math.floor((length - stepMessages) / stepMessages) * stepMessages);
}

const pointerLine = (chars: number, where: string): string =>
  `[older tool result masked: ${chars} characters, ${where}]`;

/** The first `keepChars` UTF-16 units of `text`, backing off one when the cut would leave half of a surrogate pair. */
function headChars(text: string, keepChars: number): string {
  const last = text.charCodeAt(keepChars - 1);
  const cut = keepChars > 0 && last >= 0xd800 && last <= 0xdbff ? keepChars - 1 : keepChars;
  return text.slice(0, cut);
}

/** One masked tool message, or `undefined` when the result is already short enough to keep. */
function maskedResult(
  message: Extract<Message, { role: "tool" }>,
  keepChars: number,
  where: string,
): Extract<Message, { role: "tool" }> | undefined {
  const text = textOf(message.content);
  const hasImage = message.content.some((block) => block.type === "image");
  if (text.length <= keepChars && !hasImage) return undefined;
  const content: ModelContent[] = [
    { type: "text", text: `${headChars(text, keepChars)}\n${pointerLine(text.length, where)}` },
  ];
  return { ...message, content };
}

/** An assistant message without its signed reasoning, or `undefined` when nothing remains to send. */
export function withoutSignedReasoning(message: AssistantMessage): AssistantMessage | undefined {
  const content = message.content.filter((block) => !(block.type === "reasoning" && block.signature !== undefined));
  if (content.length === message.content.length) return message;
  return content.length === 0 ? undefined : { ...message, content };
}

const isSigned = (message: Message): boolean =>
  message.role === "assistant" &&
  message.content.some((block) => block.type === "reasoning" && block.signature !== undefined);

/**
 * The messages with every tool result before the cutoff masked, and where the cutoff stands. `where` says where the full
 * text of a call is: it gets the call's id and which of the transcript's results with that id this is, because a
 * provider may reuse an id.
 *
 * A model that checks signed thinking against the earlier request rejects a block that follows an edited message, and
 * a model that thinks in a tool loop needs the loop's own thinking blocks back. So the cutoff moves only where that
 * costs nothing: while the tool loop in progress holds signed thinking (it follows the last user message), the cutoff
 * stays where the loop started, so the blocks the loop generated stay valid. Signed reasoning in the messages before the
 * loop, after the first edited result, is dropped from the view.
 */
export function maskMessages(
  messages: readonly Message[],
  settings: MaskSettings,
  where: (callId: string, occurrence: number) => string,
): readonly Message[] {
  const loopStart = messages.findLastIndex((message) => message.role === "user");
  const inLoop = messages.slice(loopStart + 1).some(isSigned);
  const cutoff = cutoffFor(inLoop ? loopStart + 1 : messages.length, settings.stepMessages);
  const seen = new Map<string, number>();
  let firstEdit = -1;
  const masked = messages.map((message, index) => {
    if (message.role !== "tool") return message;
    const occurrence = seen.get(message.callId) ?? 0;
    seen.set(message.callId, occurrence + 1);
    if (index >= cutoff) return message;
    const edited = maskedResult(message, settings.keepChars, where(message.callId, occurrence));
    if (edited !== undefined && firstEdit < 0) firstEdit = index;
    return edited ?? message;
  });
  if (firstEdit < 0) return messages;
  return masked.flatMap((message, index) => {
    if (index <= firstEdit || index > loopStart || message.role !== "assistant") return [message];
    const trimmed = withoutSignedReasoning(message);
    return trimmed === undefined ? [] : [trimmed];
  });
}
