# B19b: The readable reference loop, passing the capstone

| Field | Value |
| --- | --- |
| ID | `B19b` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B19](../done/B19-triage-capstone.md) |
| Size | M |

## Goal

Give readers a loop they can read in one sitting: a few hundred lines with the same stop reasons as the real loop, held to the same capstone so it cannot drift into a toy.

## Context

- [agent-SDK guide §9](../../guides/agent-sdk.md#9-the-public-api-should-be-functions-with-options-objects-an-explicit-provider-and-nothing-that-reaches-outside-the-process-by-default): a readable reference loop beside the full one
- [B19](../done/B19-triage-capstone.md): the capstone and the conformance suite this loop must pass
- [P4 review R25](../../plans/reviews/plan-review.md#23-buildability-the-graph-is-sound-and-one-cross-round-task-source-is-unscheduled): why the reference loop left B19

## Scope

**In scope**

- `packages/sdk/reference-loop/reference-loop.ts`: a loop with the same stop reasons, passing B19's conformance suite on `ScriptedModel`
- A README section that maps each part of the reference loop to the module of the real loop it simplifies

**Out of scope** (and which todo covers it)

- Parallel tools, steering and the OTel observer: the reference loop runs tools in order and has no observers (B12, B16, B17 cover them in the real loop)

## Tasks

- [x] Write the loop in the order transform → before → stream → after → tools → stop, using only the public exports of `@buildanagent/gateway` and `@buildanagent/sdk`.
- [x] Run B19's conformance suite against it.
- [x] Count its non-blank, non-comment lines in a test.

## Acceptance criteria

- [x] The reference loop passes B19's conformance suite on `ScriptedModel`, with `assertComplete()`
- [x] The reference loop stays under 400 non-blank, non-comment lines (a test counts them)
- [x] The reference loop imports nothing outside the two packages' public exports
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/reference-loop.test.ts`.

## Docs to update

`packages/sdk/README.md`: the reference-loop section. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Outcome

The loop is `packages/sdk/reference-loop/reference-loop.ts`, under 400 code lines (a test counts them). It passes B19's conformance suite on the scripted model and both mock transports, ends seventeen further scripted runs with the same stop reason, step count, message count and failed tool results as the real loop, and passes five resume cases that the real loop also passes. It leaves out `clarification_requested`, because the public API signs approval requests only. The suite's `Loop` type and `drive()` now ask only for events and a result, which relaxes types and no case. The README maps each part to the real module it simplifies. The first code review found ten places where the reference behaved differently from the real loop, and the loop now matches it in each. It runs no call of a response cut off at the output limit, runs no call once the run is aborted, denies a call whose gate throws and withholds a result whose `afterToolCall` throws, and applies all of `beforeModelCall`'s patch. It asks again through the gate, never reuses a waiting request's id and checks a gate's replacement input. It runs an approved call with the signed input unchanged, ends a hook failure caused by an abort `aborted` and compares inputs by `canonicalInputHash()`. The SDK now re-exports the safety package's `verifyResolution()`, so the loop checks stored requests as the real loop does, under every key the signer's ring holds and in constant time. Callers of `createPendingRequest()` needed it too. `clarification_requested` stays out: reaching it needs a public way to sign a clarification and to recognise a clarification tool, which is more public API than a reference loop justifies.

## Risks and open questions

The reference loop may lag a later change to the real loop. The shared conformance suite fails when it does.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
