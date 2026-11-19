// Type tests: each `@ts-expect-error` line makes `pnpm typecheck` fail if the rule it marks stops holding.
import assert from "node:assert/strict";
import type { WriteOutcome } from "@buildanagent/agent-safety";
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
