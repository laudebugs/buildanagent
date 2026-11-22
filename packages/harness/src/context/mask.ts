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
    { type: "text", text: `${text.slice(0, keepChars)}\n${pointerLine(text.length, where)}` },
  ];
  return { ...message, content };
}

/** An assistant message without its signed reasoning, or `undefined` when nothing remains to send. */
function withoutSignedReasoning(message: AssistantMessage): AssistantMessage | undefined {
  const content = message.content.filter((block) => !(block.type === "reasoning" && block.signature !== undefined));
  if (content.length === message.content.length) return message;
  return content.length === 0 ? undefined : { ...message, content };
}

/**
 * The messages with every tool result before the cutoff masked. A model that checks signed thinking against the
 * earlier request would reject a block that follows an edit, so every signed reasoning block after the first edited
 * message is dropped from the view. `where` says where the full text of a call is.
 */
export function maskMessages(
  messages: readonly Message[],
  settings: MaskSettings,
  where: (callId: string) => string,
): readonly Message[] {
  const cutoff = cutoffFor(messages.length, settings.stepMessages);
  let firstEdit = -1;
  const masked = messages.map((message, index) => {
    if (index >= cutoff || message.role !== "tool") return message;
    const edited = maskedResult(message, settings.keepChars, where(message.callId));
    if (edited !== undefined && firstEdit < 0) firstEdit = index;
    return edited ?? message;
  });
  if (firstEdit < 0) return messages;
  return masked.flatMap((message, index) => {
    if (index <= firstEdit || message.role !== "assistant") return [message];
    const trimmed = withoutSignedReasoning(message);
    return trimmed === undefined ? [] : [trimmed];
  });
}
