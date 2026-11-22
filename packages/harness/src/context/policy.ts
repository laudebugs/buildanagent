/**
 * `createContextPolicy()`: the cheap context layers, built once for a harness. Layer 1 caps each tool result at write
 * time and spills the full text to a file the model can name; layer 2 masks older tool results in the request view.
 * Neither changes a stored entry: the cap changes what the model reads, which is what the log stores, and the mask
 * changes only the view.
 */

import { HarnessError } from "../errors.js";
import { capResult } from "./cap.js";
import { estimate } from "./estimate.js";
import { maskMessages } from "./mask.js";
import { NO_SPILL, SpillLedger } from "./spill-ledger.js";
import { compact } from "./summarize.js";
import type { ContextFill, ContextPolicy, ContextPolicyOptions, TurnContext, TurnContextOptions } from "./types.js";

const DEFAULT_CAP_BYTES = 64 * 1024;
const DEFAULT_MASK = { keepChars: 500, stepMessages: 8 };
const DEFAULT_TAIL_TOKENS = 20_000;
const DEFAULT_TOOL_OUTPUT_CHARS = 2_000;
const DEFAULT_SUMMARY_OUTPUT_TOKENS = 4_096;
const RESERVE_TOKENS = 16_384;
const MAX_BUDGET_TOKENS = 200_000;

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

/** The summary layer's settings with their defaults. */
function summarySettings(options: ContextPolicyOptions) {
  const settings = {
    tailTokens: DEFAULT_TAIL_TOKENS,
    toolOutputChars: DEFAULT_TOOL_OUTPUT_CHARS,
    maxOutputTokens: DEFAULT_SUMMARY_OUTPUT_TOKENS,
    ...options.summarize,
  };
  const whole = (name: string, value: number, least: number) => {
    if (!Number.isInteger(value) || value < least) {
      throw new HarnessError("invalid_context_options", `summarize.${name} must be a whole number, ${least} or more`);
    }
  };
  whole("tailTokens", settings.tailTokens, 1);
  whole("toolOutputChars", settings.toolOutputChars, 0);
  whole("maxOutputTokens", settings.maxOutputTokens, 1);
  if (settings.capUsd !== undefined && !(Number.isFinite(settings.capUsd) && settings.capUsd >= 0)) {
    throw new HarnessError("invalid_context_options", "summarize.capUsd must be a number, 0 or more");
  }
  return settings;
}

/** Creates a context policy. A layer left out of `layers` is on. */
export function createContextPolicy(options: ContextPolicyOptions = {}): ContextPolicy {
  const { cap, mask, writeCap, masking } = checked(options);
  const settings = summarySettings(options);
  const summarizing = options.layers?.summarize !== false;
  return {
    forTurn({ session, model, onFill }: TurnContextOptions): TurnContext {
      const ledger = new SpillLedger(session);
      const window = model.caps.contextWindow;
      const budget = options.budgetTokens ?? Math.max(1, Math.min(window - RESERVE_TOKENS, MAX_BUDGET_TOKENS));
      let fill: ContextFill = { tokens: 0, budget, window };
      let spilled = 0;

      const afterToolCall: NonNullable<TurnContext["interceptors"]["afterToolCall"]> = async (event) => {
        // Read the earlier turns' spills first, so this result takes its place after them in the list.
        await ledger.learn();
        const capped = writeCap
          ? await capResult({
              content: event.result.content,
              details: event.result.details,
              cap,
              // A call id can repeat across turns and within a run, so the file is named by the run and a count too.
              name: `${event.runId}.${spilled++}.${event.callId}`,
              write: (name, text) =>
                (options.spill as NonNullable<typeof options.spill>).write(session.key, name, text),
            })
          : undefined;
        ledger.remember(event.callId, capped?.spill ?? NO_SPILL);
        return capped?.patch;
      };

      const transformContext: NonNullable<TurnContext["interceptors"]["transformContext"]> = async (event) => {
        await ledger.learn();
        const view = masking ? maskMessages(event.messages, mask, (id, nth) => ledger.where(id, nth)) : event.messages;
        fill = { tokens: estimate(event.system, view, event.lastUsage), budget, window };
        onFill?.(fill);
        return view;
      };

      return {
        interceptors: { afterToolCall, transformContext },
        compact: async ({ path, append, signal }) =>
          summarizing &&
          (await compact({
            path,
            append,
            signal,
            model,
            settings,
            budgetTokens: budget,
            hooks: options.hooks ?? {},
            log: options.log,
          })),
        spillOf: (callId) => ledger.latest(callId),
        fill: () => fill,
      };
    },
  };
}
