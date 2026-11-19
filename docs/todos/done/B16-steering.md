# B16: Steering and follow-up with delivery receipts

| Field | Value |
| --- | --- |
| ID | `B16` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../done/B11-loop-core.md) |
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

- [x] Queue messages; drain steering before the next model call and follow-ups after the run would otherwise end.
- [x] Resolve each receipt when its message enters the transcript.

## Acceptance criteria

- [x] A steer sent during a tool batch is applied after the batch, never inside it
- [x] A follow-up sent before `done` extends the run by one step
- [x] Every receipt resolves with the step index at which its message was applied
- [x] A steer and a follow-up each emit one `steer_applied` whose receipt carries `kind` (`"steer"` or `"follow_up"`), the message and `stepIndex` (harness need 12)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/steering.test.ts`.

## Docs to update

`packages/sdk/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Low: the queue is one class and the loop applies it in one function.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`Run` gains `steer()` and `followUp()`, each returning a `Promise<DeliveryReceipt>`; `AgentEvent` gains `steer_applied`; `SdkErrorCode` gains `undelivered_message`; the package root exports the `DeliveryReceipt` and `DeliveryKind` types. The queue lives in `src/steering.ts` and the loop applies it in `src/loop.ts`. The changeset is `.changeset/steering-follow-up.md`, a `minor` bump that opens with "Breaking Changes", because an exhaustive `switch` over `event.type` needs a new case.

Decisions:

- A steer is applied at the start of each step, before its model call, so it can never land inside a model call or a tool batch. A steer that arrives while the model answers without a tool call also extends the run.
- A follow-up is applied only when the model has answered without a tool call and no steer waits. A run that ends any other way rejects the waiting message with `undelivered_message`, so no receipt hangs. The other ways are:
  - an output tool, an abort, an error or `maxSteps`;
  - a `shouldStop` stop or `no_progress` verdict, even on a text answer;
  - a programmer error that rejects `result`.
- `receipt.stepIndex` is the index of the step at whose start the message was added, which is also the `stepIndex` of its `steer_applied` event. That step's model call is the first to see the message, unless the run ends before the call (a budget stop or a failed hook).
- `receipt.id` is `<runId>:message-<n>`, deterministic and unique within the run.
- A message is a string that isn't blank or a non-empty list of text and image blocks whose text isn't blank. Each block is copied with only its own fields, and the transcript holds a copy of the receipt's message.

Each criterion and the test that covers it, all in `packages/sdk/test/steering.test.ts`:

- Steer during a batch: "a steer sent during a tool batch is applied after the batch, never inside it".
- Follow-up extends by one step: "a follow-up sent before done extends the run by one step", and "a follow-up waits for the end of the run".
- Receipt step index: "every receipt resolves with the step index at which its message was applied".
- One `steer_applied` per message with `kind`, `message` and `stepIndex`: "a steer and a follow-up each emit one steer_applied".
- Offline checks: `pnpm check`, `pnpm typecheck` and `pnpm test` pass from the repo root.
