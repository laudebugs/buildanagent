/**
 * `createContextPolicy()`: the cheap context layers, built once for a harness. Layer 1 caps each tool result at write
 * time and spills the full text to a file the model can name; layer 2 masks older tool results in the request view.
 * Neither changes a stored entry: the cap changes what the model reads, which is what the log stores, and the mask
 * changes only the view.
 */

import type { ContentBlock, ModelContent } from "@buildanagent/gateway";
import { totalInput } from "@buildanagent/gateway";
import { HarnessError } from "../errors.js";
import { maskMessages } from "./mask.js";
import type { ContextFill, ContextPolicy, ContextPolicyOptions, TurnContext, TurnContextOptions } from "./types.js";
import { byteLength, capNotice, ENTRY_RESERVE_BYTES, escapedBytes, fitHead, textOf } from "./write-cap.js";

const DEFAULT_CAP_BYTES = 64 * 1024;
const DEFAULT_MASK = { keepChars: 500, stepMessages: 8 };
const RESERVE_TOKENS = 16_384;
const MAX_BUDGET_TOKENS = 200_000;
const CHARS_PER_TOKEN = 4;

function checked(options: ContextPolicyOptions) {
  const cap = options.writeCapBytes ?? DEFAULT_CAP_BYTES;
  const mask = options.mask ?? DEFAULT_MASK;
  const bad = (why: string) => new HarnessError("invalid_context_options", why);
  if (!Number.isInteger(cap) || cap < 1) throw bad("writeCapBytes must be a positive whole number of bytes");
  if (!Number.isInteger(mask.keepChars) || mask.keepChars < 0)
    throw bad("mask.keepChars must be a whole number, 0 or more");
  if (!Number.isInteger(mask.stepMessages) || mask.stepMessages < 1)
    throw bad("mask.stepMessages must be a whole number, 1 or more");
  const writeCap = options.layers?.write_cap !== false;
  if (writeCap && options.spill === undefined) {
    throw bad(
      "the write_cap layer needs a spill store; pass `spill`, or turn the layer off with layers.write_cap: false",
    );
  }
  return { cap, mask, writeCap, masking: options.layers?.mask !== false };
}

/** The token estimate for a request view: the last response's usage when there is one, otherwise characters over four. */
function estimate(
  system: string,
  messages: readonly { content: readonly ContentBlock[] | readonly ModelContent[] }[],
  last?: Parameters<typeof totalInput>[0] & { output: number },
): number {
  if (last !== undefined) return totalInput(last) + last.output;
  const chars = messages.reduce((sum, message) => sum + JSON.stringify(message.content).length, system.length);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Creates a context policy. A layer left out of `layers` is on. */
export function createContextPolicy(options: ContextPolicyOptions = {}): ContextPolicy {
  const { cap, mask, writeCap, masking } = checked(options);
  return {
    forTurn({ session, model, onFill }: TurnContextOptions): TurnContext {
      const spills = new Map<string, { path: string; bytes: number }>();
      let loaded = false;
      const window = model.caps.contextWindow;
      const budget = options.budgetTokens ?? Math.min(window - RESERVE_TOKENS, MAX_BUDGET_TOKENS);
      let fill: ContextFill = { tokens: 0, budget, window };

      /** The spills of earlier turns, read from the log once, so a masked result can name its file. */
      async function learn(): Promise<void> {
        if (loaded) return;
        loaded = true;
        for (const entry of await session.path()) {
          if (entry.type === "tool_result" && entry.spill !== undefined && !spills.has(entry.callId)) {
            spills.set(entry.callId, entry.spill);
          }
        }
      }

      const afterToolCall: NonNullable<TurnContext["interceptors"]["afterToolCall"]> = async (event) => {
        if (!writeCap) return undefined;
        const text = textOf(event.result.content);
        // The cap counts the log's bytes plus room for the entry's own fields, so a capped entry always fits the store.
        const room = cap - Math.min(ENTRY_RESERVE_BYTES, cap >> 2);
        if (escapedBytes(text) <= room) return undefined;
        const bytes = byteLength(text);
        const path = await (options.spill as NonNullable<typeof options.spill>).write(session.key, event.callId, text);
        spills.set(event.callId, { path, bytes });
        const noticeBytes = escapedBytes(capNotice(room, bytes, path)) + 1;
        const head = fitHead(text, room - noticeBytes);
        const images = event.result.content.filter((block) => block.type === "image");
        const notice = capNotice(byteLength(head), bytes, path);
        return { content: [{ type: "text", text: `${head}\n${notice}` }, ...images] };
      };

      const transformContext: NonNullable<TurnContext["interceptors"]["transformContext"]> = async (event) => {
        await learn();
        const where = (callId: string) => {
          const spill = spills.get(callId);
          return spill === undefined
            ? `the full text is in the session log, call ${callId}`
            : `the full text is in ${spill.path}`;
        };
        const view = masking ? maskMessages(event.messages, mask, where) : event.messages;
        fill = { tokens: estimate(event.system, view, event.lastUsage), budget, window };
        onFill?.(fill);
        return view;
      };

      return {
        interceptors: { afterToolCall, transformContext },
        spillOf: (callId) => spills.get(callId),
        fill: () => fill,
      };
    },
  };
}
