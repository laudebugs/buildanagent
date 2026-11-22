/**
 * Layer 3: summarise the span a long session has outgrown, between turns. The harness keeps a verbatim tail, asks a
 * model for a recall-first summary of everything before it, and writes the result as a `compaction` entry beside a
 * `usage` entry that holds the call's cost. No entry is changed or removed: the log still holds every original, and
 * only the context a later turn rebuilds starts from the summary.
 */
import {
  type AssistantMessage,
  type Message,
  type Model,
  type ModelContext,
  projectCallCost,
} from "@buildanagent/gateway";
import type { CompactionEntry, SessionEntry } from "@buildanagent/protocol";
import { contextWithStarts, summaryMessage } from "../session/rebuild.js";
import { charsOf, estimate, type LastUsage, tokensOfChars } from "./estimate.js";
import { SUMMARY_PROMPT_VERSION, SUMMARY_SYSTEM, summaryPrompt } from "./summary-template.js";
import type { AppendEntry, CompactEvent, CompactionLog, ContextHooks, SummarizeSettings } from "./types.js";

/** What `compact()` needs for one turn. */
export interface CompactInput {
  readonly path: readonly SessionEntry[];
  readonly append: AppendEntry;
  readonly model: Model;
  readonly settings: Required<Pick<SummarizeSettings, "tailTokens" | "toolOutputChars" | "maxOutputTokens">> &
    Pick<SummarizeSettings, "model" | "focus" | "capUsd">;
  readonly budgetTokens: number;
  readonly hooks: ContextHooks;
  readonly log: CompactionLog | undefined;
  /** Stops the summary call when the turn is aborted. */
  readonly signal?: AbortSignal | undefined;
}

const ZERO_USAGE = {
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: { "5m": 0, "1h": 0 },
  output: 0,
  reasoning: 0,
  raw: null,
};

/** The usage of the last model call since the latest compaction, or `undefined` when none is a fair size of the context. */
function lastUsageSince(path: readonly SessionEntry[]): LastUsage | undefined {
  const from = path.findLastIndex((entry) => entry.type === "compaction");
  const last = path.slice(from + 1).findLast((entry) => entry.type === "usage" && entry.source === "model_call");
  return last?.type === "usage" && last.usage.raw !== null ? last.usage : undefined;
}

/**
 * The index of the first message of the tail: the newest messages that together reach `tailTokens`, moved earlier until
 * the tail does not start with a tool result, so a call is never split from its result. 0 means nothing can be dropped.
 */
export function tailStart(messages: readonly Message[], tailTokens: number): number {
  let tokens = 0;
  let start = messages.length;
  while (start > 0 && tokens < tailTokens) {
    start--;
    tokens += tokensOfChars(charsOf(messages[start] as Message));
  }
  while (start > 0 && messages[start]?.role === "tool") start--;
  return start;
}

/** The reason the summary request cannot fit the summary model's window, or `undefined` when it fits. */
function tooLongFor(model: Model, request: ModelContext, maxOutputTokens: number): string | undefined {
  const chars = request.messages.reduce((sum, message) => sum + charsOf(message), request.system.length);
  const room = model.caps.contextWindow - maxOutputTokens;
  if (tokensOfChars(chars) <= room) return undefined;
  return `the span is about ${tokensOfChars(chars)} tokens, more than the summary model's window leaves room for (${room})`;
}

/** Money spent on the branch so far, from the `usage` entries from the root to HEAD; `null` when a call's price is unknown. */
function spentUsd(path: readonly SessionEntry[]): number | null {
  let total = 0;
  for (const entry of path) {
    if (entry.type !== "usage") continue;
    if (entry.cost.total === null) return null;
    total += entry.cost.total;
  }
  return total;
}

/** Why the summary call may not run under the session cap, or `undefined` when it may. */
function overCap(
  path: readonly SessionEntry[],
  projected: number | null,
  capUsd: number | undefined,
): string | undefined {
  if (capUsd === undefined) return undefined;
  const spent = spentUsd(path);
  if (spent === null || projected === null) return "the session's spend or the summary call's price is unknown";
  if (spent + projected > capUsd)
    return `the summary call's projected cost ($${projected.toFixed(4)}) would take the session past its cap ($${capUsd})`;
  return undefined;
}

const summaryOf = (message: AssistantMessage): string =>
  message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

/** Writes the `usage` entry for the summary call and returns its id. */
async function writeUsage(input: CompactInput, message: AssistantMessage | undefined): Promise<string> {
  const entry = await input.append("harness", {
    type: "usage",
    source: "summary",
    usage: message?.usage ?? ZERO_USAGE,
    ...(message?.lastAttemptUsage === undefined ? {} : { lastAttemptUsage: message.lastAttemptUsage }),
    // A summary a hook wrote cost nothing here.
    cost: message?.cost ?? { total: 0, basis: "catalog", currency: "USD" },
  });
  return entry.id;
}

/** The part of the context a compaction replaces, and where the kept tail begins. */
interface Plan {
  readonly before: number;
  readonly span: readonly Message[];
  readonly kept: readonly Message[];
  readonly firstKept: string;
  readonly system: string;
}

/** What to do with the context: nothing (under budget), skip with a reason, or compact this span. */
function plan(input: CompactInput): Plan | { readonly skip: string } | undefined {
  const { context, starts } = contextWithStarts(input.path);
  const before = estimate(context.system, context.messages, lastUsageSince(input.path));
  if (before <= input.budgetTokens) return undefined;
  const cut = tailStart(context.messages, input.settings.tailTokens);
  const firstKept = starts[cut];
  // Nothing to drop when the tail is the whole context, or the only message before it is an earlier summary.
  if (cut === 0 || firstKept === null || firstKept === undefined || (cut === 1 && starts[0] === null)) {
    return { skip: "there is no span to summarise before the verbatim tail" };
  }
  return {
    before,
    span: context.messages.slice(0, cut),
    kept: context.messages.slice(cut),
    firstKept,
    system: context.system,
  };
}

/** The summary text and the call that wrote it, or the reason there is none. */
async function summarise(
  input: CompactInput,
  p: Plan,
): Promise<{ summary: string; message?: AssistantMessage; model: Model } | { skip: string }> {
  const { settings, hooks } = input;
  const model = settings.model ?? input.model;
  const event: CompactEvent = {
    span: p.span,
    tokens: p.before,
    ...(settings.focus === undefined ? {} : { focus: settings.focus }),
  };
  const replaced = (await hooks.beforeCompact?.(event))?.summary;
  if (replaced !== undefined) return { summary: replaced, model };
  const prompt = summaryPrompt(p.span, { toolOutputChars: settings.toolOutputChars, focus: settings.focus });
  const request: ModelContext = {
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    tools: [],
  };
  const callOptions = { cacheRetention: "none" as const, maxOutputTokens: settings.maxOutputTokens };
  const tooLong = tooLongFor(model, request, settings.maxOutputTokens);
  if (tooLong !== undefined) return { skip: tooLong };
  const reason = overCap(input.path, projectCallCost(model, request, callOptions).total, settings.capUsd);
  if (reason !== undefined) return { skip: reason };
  const message = await model.complete(request, {
    ...callOptions,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return { summary: summaryOf(message), message, model };
}

/**
 * Compacts the session when its context is over the budget. Returns whether it wrote a `compaction` entry. A skipped
 * or failed summary writes nothing but, when the call was made, its `usage` entry, and says why through `log`.
 */
export async function compact(input: CompactInput): Promise<boolean> {
  const { log, hooks } = input;
  const p = plan(input);
  if (p === undefined) return false;
  const skipped = (detail: string) => log?.({ layer: "summarize", event: "skipped", detail });
  if ("skip" in p) {
    skipped(p.skip);
    return false;
  }
  const made = await summarise(input, p);
  if ("skip" in made) {
    skipped(made.skip);
    return false;
  }
  const usageEntryId = await writeUsage(input, made.message);
  // A reply that stopped for any reason but its own end, such as the output limit, is cut off and would replace the span for good.
  if (made.summary === "" || (made.message !== undefined && made.message.stopReason !== "stop")) {
    skipped(`the summary call returned no usable summary (${made.message?.stopReason ?? "empty"})`);
    return false;
  }
  const hooked = made.message === undefined;
  const keptChars = p.kept.reduce((sum, m) => sum + charsOf(m), 0);
  const entry = await input.append("harness", {
    type: "compaction",
    layer: "summarize",
    summary: made.summary,
    firstKeptEntryId: p.firstKept,
    tokensBefore: p.before,
    tokensAfter: tokensOfChars(p.system.length + keptChars + charsOf(summaryMessage(made.summary))),
    model: hooked ? { api: "hook", provider: "hook", id: "beforeCompact" } : made.model.ref,
    promptVersion: hooked ? "hook" : SUMMARY_PROMPT_VERSION,
    usageEntryId,
    ...(input.settings.focus === undefined ? {} : { focus: input.settings.focus }),
  });
  log?.({
    layer: "summarize",
    event: "compacted",
    detail: `${p.before} tokens before, ${tokensOfChars(keptChars)} kept`,
  });
  await hooks.afterCompact?.(entry as CompactionEntry);
  return true;
}
