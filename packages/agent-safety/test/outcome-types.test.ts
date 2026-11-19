// Type tests: each `@ts-expect-error` line makes `pnpm typecheck` fail if the rule it marks stops holding.
import assert from "node:assert/strict";
import { OUTCOME_KINDS, type OutcomeKind, type WriteOutcome } from "@buildanagent/agent-safety";
import { test } from "vitest";

const EFFECTS = { applied: [], reverted: [], notReversible: [] } as const;
const BASE = { operation: "send_email", next: "Tell the user", ...EFFECTS } as const;

test("a write outcome without next fails to compile", () => {
  const noNext = { kind: "not_applied", operation: "send_email", retry: "same_key", ...EFFECTS } as const;
  // @ts-expect-error next is required
  const outcome: WriteOutcome = noNext;
  assert.equal(outcome.kind, "not_applied");
});

test("an applied outcome cannot use reconcile_first", () => {
  // @ts-expect-error applied allows only never
  const outcome: WriteOutcome = { ...BASE, kind: "applied", retry: "reconcile_first" };
  assert.equal(outcome.kind, "applied");
});

test("an unknown outcome cannot be retried as a new operation", () => {
  // @ts-expect-error a fresh operation could repeat an effect that already happened
  const outcome: WriteOutcome = { ...BASE, kind: "unknown", retry: "new_operation_only" };
  assert.equal(outcome.kind, "unknown");
});

test("a compensated outcome may be retried as a new operation", () => {
  const outcome: WriteOutcome = { ...BASE, kind: "compensated", retry: "new_operation_only" };
  assert.equal(outcome.retry, "new_operation_only");
});

test("OUTCOME_KINDS lists exactly the kinds of OutcomeKind", () => {
  // Each assignment fails to compile if the union gains or loses a kind that this record doesn't match.
  const all: Record<OutcomeKind, true> = {
    applied: true,
    not_applied: true,
    compensated: true,
    partial: true,
    unknown: true,
  };
  assert.deepEqual([...OUTCOME_KINDS].sort(), Object.keys(all).sort());
});

test("each kind rejects the retry rules it doesn't allow", () => {
  const outcomes: WriteOutcome[] = [
    // @ts-expect-error applied allows only never
    { ...BASE, kind: "applied", retry: "same_key" },
    // @ts-expect-error applied allows only never
    { ...BASE, kind: "applied", retry: "new_operation_only" },
    // @ts-expect-error not_applied has nothing to reconcile
    { ...BASE, kind: "not_applied", retry: "reconcile_first" },
    // @ts-expect-error compensated undid its effect, so a same-key retry would redo it
    { ...BASE, kind: "compensated", retry: "same_key" },
    // @ts-expect-error compensated has nothing to reconcile
    { ...BASE, kind: "compensated", retry: "reconcile_first" },
    // @ts-expect-error part of a partial write holds, so a fresh operation could repeat it
    { ...BASE, kind: "partial", retry: "new_operation_only" },
  ];
  assert.equal(outcomes.length, 6);
});

test("each kind accepts every retry rule it allows", () => {
  const outcomes: WriteOutcome[] = [
    { ...BASE, kind: "applied", retry: "never" },
    { ...BASE, kind: "not_applied", retry: "same_key" },
    { ...BASE, kind: "not_applied", retry: "new_operation_only" },
    { ...BASE, kind: "not_applied", retry: "never" },
    { ...BASE, kind: "compensated", retry: "new_operation_only" },
    { ...BASE, kind: "compensated", retry: "never" },
    { ...BASE, kind: "partial", retry: "same_key" },
    { ...BASE, kind: "partial", retry: "reconcile_first" },
    { ...BASE, kind: "partial", retry: "never" },
    { ...BASE, kind: "unknown", retry: "same_key" },
    { ...BASE, kind: "unknown", retry: "reconcile_first" },
    { ...BASE, kind: "unknown", retry: "never" },
  ];
  assert.equal(outcomes.length, 12);
});
