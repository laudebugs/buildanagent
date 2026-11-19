/**
 * `guardedWrite()`: persist before execute. It stores an effect record before the write runs and settles it with the
 * outcome after, and it treats a record left `started` by a crash as `unknown` until the tool's `reconcile` hook reads
 * the external system's state. An `unknown` write is never run again under a fresh key, because the first attempt may
 * have taken effect (close-sdk-gaps SG3; rewind report, "Two ledgers, and the first fields to add").
 *
 * The store's answers map onto the IETF Idempotency-Key draft's statuses, as the server rollback report sets out: the
 * same key with a different input is the draft's 422 and is refused, and a live attempt is its 409, so the caller
 * waits and retries under the same key.
 */
import { checkEffectScope, type EffectScope, effectKey } from "./effect-key.js";
import type { EffectRecord, EffectStore } from "./effect-store.js";
import { SafetyError } from "./errors.js";
import { canonicalInputHash } from "./hash.js";
import { type WriteOutcome, writeOutcome } from "./outcome.js";

/**
 * How a retry can find out what an earlier attempt of the write did. `idempotency_key`: the external API dedupes by
 * the key `run` sends, as Stripe's `Idempotency-Key` header does. `reconcile`: the API ignores keys, but the tool's
 * `reconcile` hook can find the write by a field the tool sets, such as a message id. `unknown_only`: neither, so an
 * interrupted attempt stays `unknown` for good and a person must check it; put such a tool behind an approval.
 */
export type WriteDedupe = "idempotency_key" | "reconcile" | "unknown_only";

/** The options of `guardedWrite()`. */
export interface GuardedWriteOptions<T> {
  /** Where the effect records live. Use a durable store wherever a crash must not repeat the write. */
  readonly store: EffectStore;
  /** The tenant, session, branch and tool call the write was asked for. */
  readonly scope: EffectScope;
  /**
   * The business operation the write performs, such as `refund:{orderId}`. Set it for every tool that sends, submits,
   * pays or deletes, so a regenerated turn or a new session maps to the same effect. One business key names one
   * operation for good: a write the user asks for again as a new operation, such as a second refund of one order,
   * needs a new business key, such as one that adds the request's own id.
   */
  readonly businessKey?: string;
  /** The tool or business operation, such as `refund_create`. */
  readonly operation: string;
  /** The tool's input. Its canonical hash is stored; a later call with the same key and another input is refused. */
  readonly input: unknown;
  /** How a retry finds out what an earlier attempt did. */
  readonly dedupe: WriteDedupe;
  /** Runs the write. Pass `key` to the external API's idempotency header, or set it where `reconcile` can find it. */
  run(key: string): Promise<T>;
  /** Turns what `run` returned into the write's outcome. `key` is the effect key, for an outcome that names it. */
  toOutcome(result: T, key: string): WriteOutcome;
  /**
   * Turns an error `run` threw into an outcome, for errors the tool knows took no effect, such as a validation
   * failure. Without it, every error from `run` is `unknown`, because the request may have reached the system. `key` is
   * the effect key, which an `unknown` or `partial` outcome needs for a `same_key` retry.
   */
  onError?(error: unknown, key: string): WriteOutcome;
  /**
   * Reads the external system's state by key, for a resume after a crash or an `unknown` outcome. Return the outcome
   * if the write took effect or was rejected, or `"not_found"` if it never reached the system, and the write then
   * runs again under the same key. Required for `dedupe: "reconcile"`, refused for `"unknown_only"`.
   */
  reconcile?(key: string): Promise<WriteOutcome | "not_found">;
  /**
   * How long a started attempt counts as live, in milliseconds. A call that finds a live attempt gets `unknown` with
   * reason `IN_PROGRESS`; once the lease lapses, the attempt counts as crashed. Make it longer than the slowest write
   * plus the clock skew between the hosts that share the store, because the lease is read on the resuming host's clock.
   * Defaults to five minutes.
   */
  readonly leaseMs?: number;
  /** Returns the current time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
// A takeover lost to another process is re-read this many times before the call reports the write as in progress.
const MAX_REREADS = 2;

interface Context<T> {
  readonly options: GuardedWriteOptions<T>;
  readonly key: string;
  readonly inputHash: string;
  readonly now: () => number;
  readonly leaseMs: number;
}

function invalid(message: string): SafetyError {
  return new SafetyError("invalid_effect", message);
}

function checkOptions<T>(options: GuardedWriteOptions<T>): void {
  checkEffectScope(options.scope, options.businessKey);
  if (typeof options.operation !== "string" || options.operation.trim() === "") {
    throw invalid("a guarded write's operation must be non-empty");
  }
  if (!["idempotency_key", "reconcile", "unknown_only"].includes(options.dedupe)) {
    throw invalid(`unknown dedupe ${JSON.stringify(options.dedupe)}`);
  }
  if (options.dedupe === "reconcile" && options.reconcile === undefined) {
    throw invalid('a guarded write with dedupe "reconcile" needs a reconcile hook');
  }
  if (options.dedupe === "unknown_only" && options.reconcile !== undefined) {
    throw invalid('a guarded write with dedupe "unknown_only" cannot have a reconcile hook; use "reconcile"');
  }
  const lease = options.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(lease) || lease <= 0) throw invalid("a guarded write's leaseMs must be a positive integer");
}

/** The outcome with this write's effect key, unless the tool set one; checked again, so a stored one is re-checked. */
function stamped(ctx: Context<unknown>, outcome: WriteOutcome): WriteOutcome {
  return writeOutcome(outcome.effectKey === undefined ? { ...outcome, effectKey: ctx.key } : outcome);
}

/** The outcome of an attempt that may have taken effect and that nothing has checked yet. */
function unchecked(ctx: Context<unknown>, reason: string, why: string): WriteOutcome {
  const { operation, dedupe } = ctx.options;
  if (dedupe === "unknown_only") {
    return writeOutcome({
      kind: "unknown",
      operation,
      effectKey: ctx.key,
      retry: "never",
      reason,
      currentState: `${why} The system it calls offers no way to check.`,
      next: "Tell the user it may have taken effect, and ask a person to check before anyone asks for it again.",
    });
  }
  return writeOutcome({
    kind: "unknown",
    operation,
    effectKey: ctx.key,
    retry: "reconcile_first",
    reason,
    currentState: why,
    next: "Check whether it took effect before you do anything else, and tell the user if you cannot.",
  });
}

function inProgress(ctx: Context<unknown>): WriteOutcome {
  return writeOutcome({
    kind: "unknown",
    operation: ctx.options.operation,
    effectKey: ctx.key,
    retry: "same_key",
    reason: "IN_PROGRESS",
    currentState: "Another attempt at this write is still running.",
    next: "Wait, then call the tool again for the same request.",
  });
}

function keyReused(ctx: Context<unknown>): WriteOutcome {
  return writeOutcome({
    kind: "not_applied",
    operation: ctx.options.operation,
    effectKey: ctx.key,
    retry: "never",
    reason: "IDEMPOTENCY_KEY_REUSED",
    currentState: "An earlier write with the same business key had a different input, so this one was not sent.",
    next: "Tell the user that an earlier, different request already holds this business key.",
  });
}

function startedRecord(ctx: Context<unknown>, attempt: number): EffectRecord {
  const time = ctx.now();
  const { scope, businessKey, operation } = ctx.options;
  return {
    key: ctx.key,
    scope,
    ...(businessKey === undefined ? {} : { businessKey }),
    operation,
    inputHash: ctx.inputHash,
    attempt,
    state: "started",
    startedAt: new Date(time).toISOString(),
    leaseUntil: new Date(time + ctx.leaseMs).toISOString(),
  };
}

async function settle(ctx: Context<unknown>, record: EffectRecord, outcome: WriteOutcome): Promise<WriteOutcome> {
  const settled: EffectRecord = { ...record, state: "settled", outcome, settledAt: new Date(ctx.now()).toISOString() };
  // A false answer means another process took the record over after this attempt's lease lapsed. Both attempts used
  // one key, so this outcome is still what this attempt did, and the caller gets it either way.
  await ctx.options.store.settle(settled);
  return outcome;
}

async function execute<T>(ctx: Context<T>, record: EffectRecord): Promise<WriteOutcome> {
  let result: T;
  try {
    result = await ctx.options.run(ctx.key);
  } catch (error) {
    const { onError } = ctx.options;
    if (onError === undefined) {
      return settle(ctx, record, unchecked(ctx, "WRITE_FAILED", "The write threw before it reported a result."));
    }
    return report(ctx, record, () => onError(error, ctx.key), "The write threw, and its error could not be read.");
  }
  return report(
    ctx,
    record,
    () => ctx.options.toOutcome(result, ctx.key),
    "The write ran, but its outcome could not be read.",
  );
}

/**
 * Settles the tool's own outcome. If the tool's hook throws, or returns an invalid outcome, the record still settles as
 * `unknown`, saying `why`, and the hook's error is rethrown, even when that settle fails too.
 */
async function report(
  ctx: Context<unknown>,
  record: EffectRecord,
  hook: () => WriteOutcome,
  why: string,
): Promise<WriteOutcome> {
  let outcome: WriteOutcome;
  try {
    outcome = stamped(ctx, hook());
  } catch (error) {
    // A settle that fails leaves the record started, which a later call reads as crashed, so it stays unknown anyway.
    await settle(ctx, record, unchecked(ctx, "REPORT_FAILED", why)).catch(() => undefined);
    throw error;
  }
  return settle(ctx, record, outcome);
}

/** Takes the record over under a new attempt, then runs `then`; a lost takeover re-reads the winner's record. */
async function retake<T>(
  ctx: Context<T>,
  existing: EffectRecord,
  depth: number,
  then: (record: EffectRecord) => Promise<WriteOutcome>,
): Promise<WriteOutcome> {
  const record = startedRecord(ctx, existing.attempt + 1);
  const claim = await ctx.options.store.takeOver(record);
  return claim === "started" ? then(record) : resume(ctx, claim.existing, depth + 1);
}

/** Resumes an attempt that may have taken effect: reconcile under a fresh lease, or report `unknown`. */
async function recover<T>(
  ctx: Context<T>,
  existing: EffectRecord,
  depth: number,
  fallback: WriteOutcome,
): Promise<WriteOutcome> {
  const { reconcile } = ctx.options;
  if (reconcile === undefined) return fallback;
  return retake(ctx, existing, depth, async (record) => {
    let found: WriteOutcome | "not_found";
    try {
      found = await reconcile(ctx.key);
    } catch {
      return settle(ctx, record, unchecked(ctx, "RECONCILE_FAILED", "Checking the earlier attempt failed."));
    }
    if (found === "not_found") return execute(ctx, record);
    return report(ctx, record, () => found, "The earlier attempt was checked, but the check's outcome is invalid.");
  });
}

/** True for a settled outcome that may run again under the same key. */
function rerunnable(ctx: Context<unknown>, outcome: WriteOutcome): boolean {
  if (outcome.retry !== "same_key") return false;
  // A rejected write changed nothing, so it may run again whatever the system does with keys; a partial or unknown
  // one may run again only where the system dedupes by key.
  return outcome.kind === "not_applied" || ctx.options.dedupe === "idempotency_key";
}

async function resume<T>(ctx: Context<T>, existing: EffectRecord, depth: number): Promise<WriteOutcome> {
  if (existing.inputHash !== ctx.inputHash || existing.operation !== ctx.options.operation) return keyReused(ctx);
  if (existing.state === "started") {
    if (depth > MAX_REREADS || Date.parse(existing.leaseUntil) > ctx.now()) return inProgress(ctx);
    const crashed = unchecked(ctx, "WRITE_INTERRUPTED", "An earlier attempt stopped before it recorded an outcome.");
    return recover(ctx, existing, depth, crashed);
  }
  if (existing.outcome === undefined) throw invalid(`the settled effect record ${existing.key} has no outcome`);
  const outcome = stamped(ctx, existing.outcome);
  if (depth > MAX_REREADS) return outcome;
  if (rerunnable(ctx, outcome)) return retake(ctx, existing, depth, (record) => execute(ctx, record));
  // An unknown or partial outcome that a check could settle goes to `reconcile`; one marked `never` stays as it is.
  if ((outcome.kind === "unknown" || outcome.kind === "partial") && outcome.retry !== "never") {
    return recover(ctx, existing, depth, outcome);
  }
  return outcome;
}

/**
 * Runs a write at most once per effect key. It stores an effect record before `run` starts and settles it with the
 * outcome after, so a crash in between leaves evidence that the write may have happened:
 *
 * - A new key runs the write and returns its outcome, with the effect key stamped on it.
 * - A settled key returns its stored outcome without running, unless that outcome allows a `same_key` retry.
 * - The same key with a different input or operation returns `not_applied`, reason `IDEMPOTENCY_KEY_REUSED`, and
 *   sends nothing.
 * - A key whose attempt is still live, perhaps in another process, returns `unknown`, reason `IN_PROGRESS`, with a
 *   `same_key` retry, and runs nothing.
 * - A key whose attempt crashed, because its lease lapsed, calls `reconcile`: a found write returns its outcome, and
 *   `"not_found"` runs the write once more under the same key. Without `reconcile`, it returns `unknown`, reason
 *   `WRITE_INTERRUPTED`, and runs nothing: its retry is `reconcile_first`, or `never` for `dedupe: "unknown_only"`.
 * - A settled `unknown` or `partial` outcome whose retry isn't `never` calls `reconcile` the same way.
 *
 * The key comes from `effectKey()`, and no option lets a caller pick another one. With a business key, a write whose
 * outcome is `unknown` can therefore never run again under a fresh key. Without one, the key holds the tool call id,
 * so only a resume of the same call finds the record, and a fresh call is a fresh write.
 *
 * It rejects with a `SafetyError`, code `invalid_effect`, for an empty scope field, business key or operation, or for a
 * `dedupe` that doesn't match the `reconcile` hook.
 *
 * @example
 * ```ts
 * const outcome = await guardedWrite({
 *   store, scope, businessKey: `refund:${input.orderId}`, operation: "refund_create", input,
 *   dedupe: "idempotency_key",
 *   run: (key) => payments.refunds.create(input, { idempotencyKey: key }),
 *   toOutcome: (refund) =>
 *     writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user ${refund.id} is on its way` }),
 * });
 * ```
 */
export async function guardedWrite<T>(options: GuardedWriteOptions<T>): Promise<WriteOutcome> {
  checkOptions(options);
  const [key, inputHash] = await Promise.all([
    effectKey(options.scope, options.businessKey),
    canonicalInputHash(options.input),
  ]);
  const ctx: Context<T> = {
    options,
    key,
    inputHash,
    now: options.now ?? Date.now,
    leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
  };
  const record = startedRecord(ctx, 1);
  const claim = await options.store.begin(record);
  return claim === "started" ? execute(ctx, record) : resume(ctx, claim.existing, 0);
}
