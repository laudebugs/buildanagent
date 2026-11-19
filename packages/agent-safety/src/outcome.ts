/**
 * The five write outcomes: what a tool that changes the world reports, so the harness can act on it and the model can
 * read it. Each kind allows only the retry rules that are safe for it, and `unknown` never allows a fresh operation,
 * because the first attempt may still have taken effect (close-sdk-gaps SG3).
 */
import { SafetyError } from "./errors.js";

/**
 * What a write did. `applied`: it took effect. `not_applied`: it was rejected before any effect. `compensated`: it
 * took effect and was then undone. `partial`: some effects hold and the rest could not be undone. `unknown`: nobody
 * knows whether it took effect, as after a timeout or a lost response.
 */
export type OutcomeKind = "applied" | "not_applied" | "compensated" | "partial" | "unknown";

/**
 * When the same write may run again. `same_key`: retry with the same effect key, so it takes effect at most once.
 * `new_operation_only`: only as a new operation, if the user still wants it. `reconcile_first`: check what happened
 * before any retry. `never`: do not retry.
 */
export type Retry = "same_key" | "new_operation_only" | "reconcile_first" | "never";

/** The retry rules each outcome kind allows. */
export interface AllowedRetry {
  applied: "never";
  not_applied: "same_key" | "new_operation_only" | "never";
  compensated: "new_operation_only" | "never";
  partial: "same_key" | "reconcile_first" | "never";
  unknown: "same_key" | "reconcile_first" | "never";
}

/** The fields every write outcome carries, whatever its kind. */
export interface OutcomeFields {
  /** The tool or business operation, such as `send_email`. */
  readonly operation: string;
  /** The key that makes a retry of this write take effect at most once. */
  readonly effectKey?: string;
  /** Effects that hold now. */
  readonly applied: readonly string[];
  /** Effects that were undone. */
  readonly reverted: readonly string[];
  /** Effects that happened and cannot be undone, such as "email delivered 14:02". */
  readonly notReversible: readonly string[];
  /** One line about the current state that the model can trust. */
  readonly currentState?: string;
  /** What the model should do next. */
  readonly next: string;
  /** What the model must not do, beyond what the kind already rules out. */
  readonly avoid?: string;
  /** A stable code for the cause, in upper snake case and at most 63 characters, such as `CARD_DECLINED`. */
  readonly reason?: string;
}

/** A write outcome of one kind, whose `retry` is one of the rules that kind allows. */
export type WriteOutcomeOf<K extends OutcomeKind> = OutcomeFields & {
  readonly kind: K;
  readonly retry: AllowedRetry[K];
};

/** What a write reports: one of the five kinds, with its retry rule and what the model should do next. */
export type WriteOutcome = { [K in OutcomeKind]: WriteOutcomeOf<K> }[OutcomeKind];

/** The fields you can leave out of a write outcome, because `writeOutcome()` fills them in. */
type Defaulted = "applied" | "reverted" | "notReversible";

/**
 * The input to `writeOutcome()`. `retry` defaults to the kind's rule in `DEFAULT_RETRY`, and the three effect lists
 * default to empty.
 */
export type WriteOutcomeInit = {
  [K in OutcomeKind]: Omit<OutcomeFields, Defaulted> &
    Partial<Pick<OutcomeFields, Defaulted>> & { readonly kind: K; readonly retry?: AllowedRetry[K] };
}[OutcomeKind];

/** The five outcome kinds, in the order the docs list them. */
export const OUTCOME_KINDS: readonly OutcomeKind[] = Object.freeze([
  "applied",
  "not_applied",
  "compensated",
  "partial",
  "unknown",
]);

/**
 * The retry rule each kind gets when the tool sets none: a rejected write may run again with the same key, an undone
 * one only as a new operation, a partial one goes to a person, and an unknown one is checked first.
 */
export const DEFAULT_RETRY: { readonly [K in OutcomeKind]: AllowedRetry[K] } = Object.freeze({
  applied: "never",
  not_applied: "same_key",
  compensated: "new_operation_only",
  partial: "never",
  unknown: "reconcile_first",
});

/** The retry rules each kind allows, as `AllowedRetry` lists them. */
export const ALLOWED_RETRIES: { readonly [K in OutcomeKind]: readonly AllowedRetry[K][] } = Object.freeze({
  applied: Object.freeze(["never"] as const),
  not_applied: Object.freeze(["same_key", "new_operation_only", "never"] as const),
  compensated: Object.freeze(["new_operation_only", "never"] as const),
  partial: Object.freeze(["same_key", "reconcile_first", "never"] as const),
  unknown: Object.freeze(["same_key", "reconcile_first", "never"] as const),
});

// AIP-193's rule for `reason`: upper snake case, no leading digit or underscore, no trailing underscore.
const REASON = /^[A-Z][A-Z0-9_]+[A-Z0-9]$/;
const MAX_REASON_LENGTH = 63;

function invalid(message: string): SafetyError {
  return new SafetyError("invalid_outcome", message);
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`a write outcome's ${field} must be non-empty`);
}

function requireOptionalText(value: unknown, field: string): void {
  // A blank value would render as an empty sentence, such as "Current state: .", so it must be left out instead.
  if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
    throw invalid(`a write outcome's ${field} must be non-empty when it is set`);
  }
}

function effectList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw invalid(`a write outcome's ${field} must be a list of non-empty strings`);
  }
  return Object.freeze([...value]);
}

function checkReason(reason: unknown): void {
  if (reason === undefined) return;
  if (typeof reason !== "string" || reason.length > MAX_REASON_LENGTH || !REASON.test(reason)) {
    throw invalid(
      `a write outcome's reason must be upper snake case and at most ${MAX_REASON_LENGTH} characters, ` +
        `got ${JSON.stringify(reason)}`,
    );
  }
}

// The effect lists each kind can't hold, because the kind's own sentence would contradict them: a write that changed
// nothing has no effects, one that took effect undid nothing, and one that was undone holds none of its effects.
const FORBIDDEN_EFFECTS: { readonly [K in OutcomeKind]: readonly Defaulted[] } = {
  applied: ["reverted"],
  not_applied: ["applied", "reverted", "notReversible"],
  compensated: ["applied"],
  partial: [],
  unknown: [],
};

function checkEffects(kind: OutcomeKind, lists: Readonly<Record<Defaulted, readonly string[]>>): void {
  for (const field of FORBIDDEN_EFFECTS[kind]) {
    if (lists[field].length > 0) throw invalid(`a ${kind} outcome cannot list ${field} effects`);
  }
}

function checkEffectKey(kind: OutcomeKind, retry: Retry, effectKey: unknown): void {
  // Without a key, a same-key retry of a write that may have taken effect could take effect twice. A not_applied
  // write took no effect, so retrying it is safe with or without one.
  if (retry === "same_key" && effectKey === undefined && (kind === "partial" || kind === "unknown")) {
    throw invalid(`a ${kind} outcome can use retry "same_key" only with an effectKey`);
  }
}

function checkKindAndRetry(kind: unknown, retry: unknown): Retry {
  if (!OUTCOME_KINDS.includes(kind as OutcomeKind)) throw invalid(`unknown outcome kind ${JSON.stringify(kind)}`);
  const known = kind as OutcomeKind;
  // Only a missing retry takes the default; `null` from a JSON caller fails the check below like any other value.
  const chosen = retry === undefined ? DEFAULT_RETRY[known] : retry;
  if (!(ALLOWED_RETRIES[known] as readonly unknown[]).includes(chosen)) {
    throw invalid(`a ${known} outcome cannot use retry ${JSON.stringify(chosen)}`);
  }
  return chosen as Retry;
}

/**
 * Builds a write outcome, filling in the defaults and checking every field. The result is frozen.
 *
 * Throws a `SafetyError`, code `invalid_outcome`, for:
 * - an unknown kind, or a retry rule the kind doesn't allow;
 * - an empty `operation` or `next`, or an `operation` with leading or trailing spaces;
 * - a blank effect or optional text field;
 * - a `reason` that isn't upper snake case of at most 63 characters;
 * - effects the kind contradicts: any effect on `not_applied`, `reverted` on `applied`, `applied` on `compensated`;
 * - a `partial` or `unknown` outcome that allows a `same_key` retry without an `effectKey`.
 */
export function writeOutcome(init: WriteOutcomeInit): WriteOutcome {
  const retry = checkKindAndRetry(init.kind, init.retry);
  requireText(init.operation, "operation");
  if (init.operation !== init.operation.trim())
    throw invalid("a write outcome's operation must not start or end with spaces");
  requireText(init.next, "next");
  for (const field of ["effectKey", "currentState", "avoid"] as const) requireOptionalText(init[field], field);
  checkReason(init.reason);
  checkEffectKey(init.kind, retry, init.effectKey);
  const lists = {
    applied: effectList(init.applied, "applied"),
    reverted: effectList(init.reverted, "reverted"),
    notReversible: effectList(init.notReversible, "notReversible"),
  };
  checkEffects(init.kind, lists);
  const outcome = {
    kind: init.kind,
    operation: init.operation,
    ...(init.effectKey === undefined ? {} : { effectKey: init.effectKey }),
    ...lists,
    ...(init.currentState === undefined ? {} : { currentState: init.currentState }),
    retry,
    next: init.next,
    ...(init.avoid === undefined ? {} : { avoid: init.avoid }),
    ...(init.reason === undefined ? {} : { reason: init.reason }),
  };
  // checkKindAndRetry has shown that `retry` is one the kind allows, which the spread above can't carry in its type.
  return Object.freeze(outcome) as WriteOutcome;
}
