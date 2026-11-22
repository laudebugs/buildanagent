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
import { MidTurn, type RunCompaction } from "./mid-turn.js";
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

function checkRatio(ratio: number | undefined): void {
  if (ratio !== undefined && !(Number.isFinite(ratio) && ratio > 0 && ratio < 1)) {
    throw new HarnessError("invalid_context_options", "midTurnRatio must be a number above 0 and below 1");
  }
}

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
  checkRatio(options.midTurnRatio);
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

const MID_TURN_RATIO = 0.9;
/** Mid-turn compaction is on by default only below this window, where the context fills in the middle of a turn. */
const MID_TURN_WINDOW = 128_000;

type AfterToolCall = NonNullable<TurnContext["interceptors"]["afterToolCall"]>;

/** Layer 1 as an `afterToolCall` hook: caps the result and records where its full text went. */
function writeCapHook(
  options: ContextPolicyOptions,
  session: TurnContextOptions["session"],
  ledger: SpillLedger,
  cap: number | undefined,
): AfterToolCall {
  let spilled = 0;
  return async (event) => {
    // Read the earlier turns' spills first, so this result takes its place after them in the list.
    await ledger.learn();
    const capped =
      cap === undefined
        ? undefined
        : await capResult({
            content: event.result.content,
            details: event.result.details,
            cap,
            // A call id can repeat across turns and within a run, so the file is named by the run and a count too.
            name: `${event.runId}.${spilled++}.${event.callId}`,
            write: (name, text) => (options.spill as NonNullable<typeof options.spill>).write(session.key, name, text),
          });
    ledger.remember(event.callId, capped?.spill ?? NO_SPILL);
    return capped?.patch;
  };
}

/** Creates a context policy. A layer left out of `layers` is on, except mid-turn compaction, which is on below a 128K window. */
export function createContextPolicy(options: ContextPolicyOptions = {}): ContextPolicy {
  const { cap, mask, writeCap, masking } = checked(options);
  const settings = summarySettings(options);
  const summarizing = options.layers?.summarize !== false;
  const overflowRetry = options.layers?.overflow_retry !== false;
  return {
    forTurn({ session, model, onFill, ownHistory }: TurnContextOptions): TurnContext {
      const ledger = new SpillLedger(session);
      const window = model.caps.contextWindow;
      const budget = options.budgetTokens ?? Math.max(1, Math.min(window - RESERVE_TOKENS, MAX_BUDGET_TOKENS));
      let fill: ContextFill = { tokens: 0, budget, window };
      const runCompaction: RunCompaction = (input) =>
        compact({ ...input, model, settings, budgetTokens: budget, hooks: options.hooks ?? {}, log: options.log });
      const midTurn = new MidTurn({
        session,
        // A caller-supplied history is not what the log rebuilds, so a summary of it could not be written as an entry.
        enabled: ownHistory !== true && (options.layers?.mid_turn ?? window < MID_TURN_WINDOW),
        limitTokens: Math.floor((options.midTurnRatio ?? MID_TURN_RATIO) * window),
        compact: runCompaction,
        log: options.log,
      });

      const transformContext: NonNullable<TurnContext["interceptors"]["transformContext"]> = async (event) => {
        await ledger.learn();
        const compactedBefore = midTurn.applied;
        const base = await midTurn.view(event);
        // A mid-turn compaction changes which results the view holds, so the spills are counted again from the log.
        if (!compactedBefore && midTurn.applied) await ledger.reload();
        const view = masking ? maskMessages(base, mask, (id, nth) => ledger.where(id, nth)) : base;
        // After a compaction the last response's usage describes the context before it, so it no longer counts.
        fill = { tokens: estimate(event.system, view, midTurn.usageFor(event)), budget, window };
        onFill?.(fill);
        return [...view];
      };

      return {
        interceptors: {
          afterToolCall: writeCapHook(options, session, ledger, writeCap ? cap : undefined),
          transformContext,
        },
        attach: (bindings) => midTurn.attach(bindings),
        compact: async ({ path, append, signal }) =>
          summarizing && (await runCompaction({ path, append, signal, layer: "summarize" })) !== undefined,
        onOverflow: async ({ path, append, signal }) =>
          overflowRetry &&
          (await runCompaction({ path, append, signal, layer: "overflow_retry", force: true })) !== undefined,
        spillOf: (callId) => ledger.latest(callId),
        fill: () => fill,
      };
    },
  };
}
