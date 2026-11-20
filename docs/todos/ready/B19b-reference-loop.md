# B19b: The readable reference loop, passing the capstone

| Field | Value |
| --- | --- |
| ID | `B19b` |
| Status | `ready` |
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

- `packages/sdk/reference-loop/`: a loop with the same stop reasons, passing B19's conformance suite on `ScriptedModel`
- A README section that maps each part of the reference loop to the module of the real loop it simplifies

**Out of scope** (and which todo covers it)

- Parallel tools, steering and the OTel observer: the reference loop runs tools in order and has no observers (B12, B16, B17 cover them in the real loop)

## Tasks

- [ ] Write the loop in the order transform → before → stream → after → tools → stop, using only the public exports of `@buildanagent/gateway` and `@buildanagent/sdk`.
- [ ] Run B19's conformance suite against it.
- [ ] Count its non-blank, non-comment lines in a test.

## Acceptance criteria

- [ ] The reference loop passes B19's conformance suite on `ScriptedModel`, with `assertComplete()`
- [ ] The reference loop stays under 400 non-blank, non-comment lines (a test counts them)
- [ ] The reference loop imports nothing outside the two packages' public exports
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/reference-loop.test.ts`.

## Docs to update

`packages/sdk/README.md`: the reference-loop section. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The reference loop may lag a later change to the real loop. The shared conformance suite fails when it does.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
