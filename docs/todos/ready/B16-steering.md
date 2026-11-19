# B16: Steering and follow-up with delivery receipts

| Field | Value |
| --- | --- |
| ID | `B16` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../ongoing/B11-loop-core.md) |
| Size | S |

## Goal

Let a caller steer a running agent or queue a follow-up, drained only at step boundaries and never cutting a running tool batch.

## Context

- [agent-SDK guide §3](../../guides/agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason): abort and steering each have a race the loop must close
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): `steer`, `followUp`, `DeliveryReceipt`

## Scope

**In scope**

- `run.steer()` and `run.followUp()` returning receipts
- Draining at step boundaries
- `steer_applied` events for steers and follow-ups
- `DeliveryReceipt` with `id`, `kind`, `message` and `stepIndex`

**Out of scope** (and which todo covers it)

- Protocol-level steering (P2)

## Tasks

- [ ] Queue messages; drain steering before the next model call and follow-ups after the run would otherwise end.
- [ ] Resolve each receipt when its message enters the transcript.

## Acceptance criteria

- [ ] A steer sent during a tool batch is applied after the batch, never inside it
- [ ] A follow-up sent before `done` extends the run by one step
- [ ] Every receipt resolves with the step index at which its message was applied
- [ ] A steer and a follow-up each emit one `steer_applied` whose receipt carries `kind` (`"steer"` or `"follow_up"`), the message and `stepIndex` (harness need 12)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/steering.test.ts`.

## Docs to update

`packages/sdk/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Low.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
