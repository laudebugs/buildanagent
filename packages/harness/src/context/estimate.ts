/** The token estimates the context layers use: the last response's usage when there is one, characters over four otherwise. */

import type { ContentBlock, Message, ModelContent } from "@buildanagent/gateway";
import { totalInput } from "@buildanagent/gateway";

const CHARS_PER_TOKEN = 4;

/** The characters in one message's content, counted as JSON. */
export const charsOf = (message: { content: readonly ContentBlock[] | readonly ModelContent[] }): number =>
  JSON.stringify(message.content).length;

/** Tokens for `chars` characters, rounded up. */
export const tokensOfChars = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

/** The usage of the last response, which tells how many tokens the context held then. */
export type LastUsage = Parameters<typeof totalInput>[0] & { output: number };

/**
 * The token estimate for a request view. With the last response's usage it is that call's input and output, plus a
 * character estimate of what the view added since; without it, a character estimate of the whole view.
 */
export function estimate(system: string, messages: readonly Message[], last?: LastUsage): number {
  if (last === undefined) {
    return tokensOfChars(messages.reduce((sum, message) => sum + charsOf(message), system.length));
  }
  const lastAssistant = messages.findLastIndex((message) => message.role === "assistant");
  const added = messages.slice(lastAssistant + 1).reduce((sum, message) => sum + charsOf(message), 0);
  return totalInput(last) + last.output + tokensOfChars(added);
}
