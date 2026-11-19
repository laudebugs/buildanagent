/**
 * `renderOutcome()`: turns a write outcome into what the model reads. The outcome travels in the tool result's body,
 * as a sentence and a structured payload, with the provider's error flag set as well, because some adapters drop the
 * flag and some SDKs hide text blocks once structured content is set (server rollback report).
 */
import type { OutcomeKind, Retry, WriteOutcome } from "./outcome.js";

/**
 * The structured half of a rendered outcome: the outcome's own fields, as plain JSON. Optional fields the outcome
 * leaves out are left out here too.
 */
export type OutcomePayload = {
  readonly kind: OutcomeKind;
  readonly operation: string;
  readonly effectKey?: string;
  readonly applied: readonly string[];
  readonly reverted: readonly string[];
  readonly notReversible: readonly string[];
  readonly currentState?: string;
  readonly retry: Retry;
  readonly next: string;
  readonly avoid?: string;
  readonly reason?: string;
};

/** A write outcome as the model reads it. */
export interface RenderedOutcome {
  /** Sentences that say what happened, what to do next and what not to do. */
  readonly text: string;
  /** The outcome's fields, for a model or a harness that reads structured results. */
  readonly payload: OutcomePayload;
  /** True for every kind except `applied`: the provider's error flag, where the provider has one. */
  readonly isError: boolean;
}

// What happened, per kind. `{op}` is the operation's name.
const HAPPENED: { readonly [K in OutcomeKind]: string } = {
  applied: "The {op} call took effect.",
  not_applied: "The {op} call did not take effect, and nothing changed.",
  compensated: "The {op} call took effect and was then undone.",
  partial: "The {op} call only partly took effect, and the rest could not be undone.",
  unknown: "It is not known whether the {op} call took effect.",
};

// What the model must not do, per kind, from the server rollback report's outcome table.
const MUST_NOT: { readonly [K in OutcomeKind]: string } = {
  applied: "Do not run it again for the same request.",
  not_applied: "Do not say that it happened.",
  compensated: "Do not say that it took effect, and do not hide what could not be undone.",
  partial: "Do not present it as a success.",
  unknown: "Do not say that it happened or that it failed, and do not retry it as a new request.",
};

// What a retry may look like, per rule. `applied` takes no retry sentence, because its kind sentence covers it.
const RETRY: { readonly [R in Retry]: string } = {
  same_key: "Retrying this same call is safe; it takes effect at most once.",
  new_operation_only: "Try again only as a new request, and only if the user still wants it.",
  reconcile_first: "Check its current status before any retry.",
  never: "Do not retry it.",
};

const KEYLESS_SAME_KEY = "Retrying this same call is safe, because this attempt changed nothing.";

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function effects(label: string, list: readonly string[]): string[] {
  // Each effect loses its own end punctuation, so "email sent." doesn't render as "email sent..".
  const items = list.map((item) => item.trim().replace(/[.!?]+$/, ""));
  return items.length === 0 ? [] : [`${label}: ${items.join("; ")}.`];
}

// A same-key retry takes effect at most once only when there is a key. writeOutcome() allows a keyless one only for
// not_applied, whose first attempt changed nothing.
function retrySentence(outcome: WriteOutcome): string {
  if (outcome.retry === "same_key" && outcome.effectKey === undefined) return KEYLESS_SAME_KEY;
  return RETRY[outcome.retry];
}

function describe(outcome: WriteOutcome): string {
  const parts = [
    // A function replacer, so `$&` or `$'` in an operation's name is copied, not read as a replacement pattern.
    HAPPENED[outcome.kind].replace("{op}", () => outcome.operation),
    ...effects("Still in effect", outcome.applied),
    ...effects("Undone", outcome.reverted),
    ...effects("Cannot be undone", outcome.notReversible),
    ...(outcome.currentState === undefined ? [] : [`Current state: ${sentence(outcome.currentState)}`]),
    `Next: ${sentence(outcome.next)}`,
    ...(outcome.kind === "applied" ? [] : [retrySentence(outcome)]),
    MUST_NOT[outcome.kind],
    ...(outcome.avoid === undefined ? [] : [sentence(outcome.avoid)]),
  ];
  return parts.join(" ");
}

function toPayload(outcome: WriteOutcome): OutcomePayload {
  return {
    kind: outcome.kind,
    operation: outcome.operation,
    ...(outcome.effectKey === undefined ? {} : { effectKey: outcome.effectKey }),
    applied: [...outcome.applied],
    reverted: [...outcome.reverted],
    notReversible: [...outcome.notReversible],
    ...(outcome.currentState === undefined ? {} : { currentState: outcome.currentState }),
    retry: outcome.retry,
    next: outcome.next,
    ...(outcome.avoid === undefined ? {} : { avoid: outcome.avoid }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  };
}

/**
 * Renders a write outcome for the model: sentences that name what happened, what to do next and what not to do, the
 * outcome's fields as a JSON payload, and whether the provider's error flag should be set. Put both the text and the
 * payload in the tool result, because some SDKs show the model only one of them.
 */
export function renderOutcome(outcome: WriteOutcome): RenderedOutcome {
  return { text: describe(outcome), payload: toPayload(outcome), isError: outcome.kind !== "applied" };
}
