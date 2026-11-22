/**
 * `createContextPolicy()`: the cheap context layers, built once for a harness. Layer 1 caps each tool result at write
 * time and spills the full text to a file the model can name; layer 2 masks older tool results in the request view.
 * Neither changes a stored entry: the cap changes what the model reads, which is what the log stores, and the mask
 * changes only the view.
 */

import type { ContentBlock, Message, ModelContent } from "@buildanagent/gateway";
import { totalInput } from "@buildanagent/gateway";
import { HarnessError } from "../errors.js";
import { capResult } from "./cap.js";
import { maskMessages } from "./mask.js";
import type { ContextFill, ContextPolicy, ContextPolicyOptions, TurnContext, TurnContextOptions } from "./types.js";

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
  if (options.budgetTokens !== undefined && (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 1)) {
    throw bad("budgetTokens must be a positive whole number");
  }
  const writeCap = options.layers?.write_cap !== false;
  if (writeCap && options.spill === undefined) {
    throw bad(
      "the write_cap layer needs a spill store; pass `spill`, or turn the layer off with layers.write_cap: false",
    );
  }
  return { cap, mask, writeCap, masking: options.layers?.mask !== false };
}

const charsOf = (message: { content: readonly ContentBlock[] | readonly ModelContent[] }): number =>
  JSON.stringify(message.content).length;

/**
 * The token estimate for a request view. With the last response's usage it is that call's input and output, plus a
 * character estimate of what the view added since; without it, a character estimate of the whole view.
 */
function estimate(
  system: string,
  messages: readonly Message[],
  last?: Parameters<typeof totalInput>[0] & { output: number },
): number {
  if (last === undefined) {
    return Math.ceil(messages.reduce((sum, message) => sum + charsOf(message), system.length) / CHARS_PER_TOKEN);
  }
  const lastAssistant = messages.findLastIndex((message) => message.role === "assistant");
  const added = messages.slice(lastAssistant + 1).reduce((sum, message) => sum + charsOf(message), 0);
  return totalInput(last) + last.output + Math.ceil(added / CHARS_PER_TOKEN);
}

type Spill = { path: string; bytes: number };
const NO_SPILL: Spill = { path: "", bytes: 0 };

/** Creates a context policy. A layer left out of `layers` is on. */
export function createContextPolicy(options: ContextPolicyOptions = {}): ContextPolicy {
  const { cap, mask, writeCap, masking } = checked(options);
  return {
    forTurn({ session, model, onFill }: TurnContextOptions): TurnContext {
      // Every spill of a call id, in log order: a provider may reuse an id, so a masked result is told apart by its place.
      const spills = new Map<string, Spill[]>();
      const remember = (callId: string, spill: Spill) => spills.set(callId, [...(spills.get(callId) ?? []), spill]);
      let loading: Promise<void> | undefined;
      const window = model.caps.contextWindow;
      const budget = options.budgetTokens ?? Math.max(1, Math.min(window - RESERVE_TOKENS, MAX_BUDGET_TOKENS));
      let fill: ContextFill = { tokens: 0, budget, window };

      /** The spills of earlier turns, read from the log once, so a masked result can name its file. */
      async function read(): Promise<void> {
        for (const entry of await session.path()) {
          if (entry.type !== "tool_result") continue;
          // A result with no spill still takes its place in the list, so the nth result of an id finds its own spill.
          remember(entry.callId, entry.spill ?? NO_SPILL);
        }
      }
      // One shared promise, so parallel callers all wait for the read, and a failed read is tried again by the next.
      const learn = (): Promise<void> => {
        loading ??= read().catch((error: unknown) => {
          loading = undefined;
          throw error;
        });
        return loading;
      };

      let spilled = 0;
      const afterToolCall: NonNullable<TurnContext["interceptors"]["afterToolCall"]> = async (event) => {
        // Read the earlier turns' spills first, so this result takes its place after them in the list.
        await learn();
        const capped = writeCap
          ? await capResult({
              content: event.result.content,
              details: event.result.details,
              cap,
              name: `${event.runId}.${spilled++}.${event.callId}`,
              // A call id can repeat across turns and within a run, so the file is named by the run and a count too.
              write: (name, text) =>
                (options.spill as NonNullable<typeof options.spill>).write(session.key, name, text),
            })
          : undefined;
        remember(event.callId, capped?.spill ?? NO_SPILL);
        return capped?.patch;
      };

      const transformContext: NonNullable<TurnContext["interceptors"]["transformContext"]> = async (event) => {
        await learn();
        const where = (callId: string, occurrence: number) => {
          const spill = spills.get(callId)?.[occurrence];
          return spill === undefined || spill.path === ""
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
        spillOf: (callId) => {
          const latest = spills.get(callId)?.at(-1);
          return latest === undefined || latest.path === "" ? undefined : latest;
        },
        fill: () => fill,
      };
    },
  };
}
