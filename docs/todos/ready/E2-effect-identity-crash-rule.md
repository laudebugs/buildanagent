# E2: Effect identity, the persist-before-execute rule and the crash test

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner approved Round E's reviewed todos but said "Approve plan, don't start yet" ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-and-only-once-the-owner-says-go-accepted-on-hold)).

| Field | Value |
| --- | --- |
| ID | `E2` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps) |
| Depends on | [E1](E1-safety-core-outcomes.md) |
| Size | M |

## Goal

Give every write an identity before it runs and an outcome after it runs, and treat the gap between the two as `unknown`, so that a crash or a regenerated model turn cannot repeat an email, an application or a refund (gap 2). The rewind report calls this "the most valuable change to our plans", and it is cheap.

## Context

- [Server rollback report, idempotency keys](../../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped): a call id deduplicates only once it is persisted before execution and scoped.
- [Rewind report, the first fields to add](../../research/reversible-actions/rewind-vs-rollback.md#two-ledgers-and-the-first-fields-to-add): the crash test this todo adds, and why "exactly once" means "once, if nothing crashes" until it passes.
- [Rewind report, triage table](../../research/reversible-actions/rewind-vs-rollback.md#triage-needs-undo-windows-for-t1-approval-for-anything-that-leaves-the-org-and-a-saga-only-once-money-moves): business keys such as `refund:{orderId}`, because a regenerated turn emits a fresh call id.
- [Storage-and-wake note](../../research/deployment/storage-and-wake.md): wakes arrive at least once, so every target needs this rule.
- [ADR 0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md) and [W6](W6-pr-delivery.md): the coding agent already persists an idempotency key before each push and API call; `guardedWrite` is the shared form of that rule.

## Scope

**In scope**

- `effectKey()`, the `EffectRecord` and the `EffectStore` interface with an in-memory implementation
- `guardedWrite()`, which persists the record, runs the write, and records the outcome
- `reconcile()`, the hook a tool supplies to read the external system's state by key
- The rule that `unknown` is never retried with a fresh key
- The crash test

**Out of scope** (and which todo covers it)

- Durable stores on Cloudflare, AWS and Vercel (E7)
- Plan-level ordering and compensation (E4a, E4b)
- The harness's session-log entries for the same rule (the revisions to N7 and N40)

## Design notes

```ts
interface EffectScope { tenant: string; session: string; branch: string; toolCallId: string }

// The key: the business key when the tool declares one, so a regenerated turn maps to the same effect.
declare function effectKey(scope: EffectScope, businessKey?: string): string;
// businessKey present: hash(tenant, businessKey); absent: hash(tenant, session, branch, toolCallId)

interface EffectRecord {
  key: string; scope: EffectScope; businessKey?: string;
  operation: string; inputHash: string;             // canonical hash, the same function D5 signs
  state: "started" | "settled";
  outcome?: WriteOutcome;                           // set when settled
  startedAt: string; leaseUntil: string; settledAt?: string; // a started record is live until its lease lapses
}

interface EffectStore {
  begin(record: EffectRecord): Promise<"started" | { existing: EffectRecord }>; // atomic insert-if-absent
  settle(key: string, outcome: WriteOutcome): Promise<void>;
  get(key: string): Promise<EffectRecord | undefined>;
}

declare function guardedWrite<T>(opts: {
  store: EffectStore; scope: EffectScope; businessKey?: string; operation: string; input: unknown;
  run(key: string): Promise<T>;                     // the tool passes key to the external API's idempotency header
  toOutcome(result: T): WriteOutcome;
  reconcile?(key: string): Promise<WriteOutcome | "not_found">;
}): Promise<WriteOutcome>;
```

`begin` stores the record before `run` starts. If `begin` finds a record whose `inputHash` differs, `guardedWrite` refuses with `not_applied`, `retry: "never"` and reason `IDEMPOTENCY_KEY_REUSED`, the 422 case of the server rollback report. If it finds a `settled` record, it returns that outcome without running. A `started` record whose lease has not lapsed belongs to a live attempt, perhaps in another process, so `guardedWrite` returns `unknown` with reason `IN_PROGRESS` and neither runs nor reconciles, the report's 409 case. Once the lease lapses, the attempt counts as crashed, and `guardedWrite` calls `reconcile`. A `not_found` result means the earlier attempt never reached the external system, so the write runs under the same key. With no `reconcile` hook, the outcome is `unknown` with `retry: "reconcile_first"`, and the write does not run again. A fresh key for the same business key is refused.

## Tasks

- [ ] Write `effectKey()` with the business-key rule, and document which tools must declare a business key (anything that sends, submits, pays or deletes).
- [ ] Write `EffectStore`, `memoryEffectStore()` and `guardedWrite()`.
- [ ] Write the crash test: a fake tool persists, then the test kills the process (a forked child) before `settle`; a second process runs the same call.
- [ ] Override `repairInterruptedToolPart` in a test `AIChatAgent` so an interrupted write reaches the model as `unknown`; the default repair writes an `output-error` result, the same aborted-error gap the N7 revision closes for our harness.
- [ ] Write the regenerated-turn test: two different tool call ids with the same business key.
- [ ] Export the store's conformance cases so E7 can run them against each target's store.

## Acceptance criteria

- [ ] The child is killed after the fake external system accepts its request and before `settle`, with no `reconcile` hook: once the lease lapses, the resume returns `unknown` with `retry: "reconcile_first"`, and the fake system records exactly one request.
- [ ] A second process that calls while the first one's lease is live gets `unknown` with reason `IN_PROGRESS`, and neither `run` nor `reconcile` is called.
- [ ] The same key with a different input hash returns `not_applied` with reason `IDEMPOTENCY_KEY_REUSED` and sends nothing.
- [ ] Crash after the external system accepted the request, with a `reconcile` hook that finds it: the resume returns `applied`, and the system still records one request.
- [ ] Crash before the request left, with a `reconcile` hook that returns `not_found`: the resume sends once, under the same key.
- [ ] Two tool calls with different call ids and the same business key produce one external request.
- [ ] A settled record returns its stored outcome without calling `run`.
- [ ] An `ai` 7.0.162 tool wrapped with `guardedWrite` passes the regenerated-turn test against `MockLanguageModelV4`.
- [ ] On Cloudflare `AIChatAgent` (`@cloudflare/ai-chat` 0.12.2), an override of `repairInterruptedToolPart` turns an interrupted write into an `unknown` outcome instead of the default `output-error` text "The tool call was interrupted before a result was recorded.", checked in workerd.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/effects.test.ts` and `test/crash.test.ts`, which forks a child process with an allowlisted environment, following the repo's rule for running code.

## Docs to update

The package README (the write rule in one paragraph, and the list of tools that need a business key).

## Risks and open questions

- Some external APIs accept no idempotency key. For those, `reconcile` must query by a field the tool controls, such as a message id header; a tool with neither must declare itself `unknown`-only, and an approval should cover it.
- The business key's scope is per tenant, the owner's choice of 2026-11-18 ("Per user"; one tenant is one user under PF1). The key excludes the session, so a new session cannot repeat a refund or an email.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
