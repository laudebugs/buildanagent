# N39: Ablation and tuning runs: HD3, HD9, HD12 and SDK D11

| Field | Value |
| --- | --- |
| ID | `N39` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N38](N38-seed-suite-baseline.md) |
| Size | M |

## Goal

Run the settling tests the guide names on recorded and live data: each context layer on and off, budget overshoot, prompts per task under each approval mode, and the SDK's progress defaults.

## Context

- [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional): the decision and its evidence
- [HD9](../../plans/build-harness.md#hd9-sdk-d9s-per-call-check-plus-a-session-cap-and-a-pre-checked-summary-call-with-sdk-d9): the decision and its evidence
- [HD12](../../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback): the decision and its evidence
- [SDK D11](../../plans/build-sdk.md#d11-three-identical-failing-calls-stop-the-run-and-the-depth-cap-is-2-provisional): provisional progress defaults
- [harness guide §11](../../guides/agent-harness.md#11-every-component-should-be-removable-because-the-value-of-harness-scaffolding-decays-as-models-improve): ablation in the eval format

## Scope

**In scope**

- Each context layer, tool search, MCP and the completion check switched off in turn on the seed suite
- Budget overshoot of the pre-emptive check on the longest recorded runs
- Prompts per task under each permission mode inside the default sandbox, against Anthropic's 84% reduction
- `no_progress` firings against recorded loops
- A results note with a keep, change or remove verdict per component

**Out of scope** (and which todo covers it)

- Changing SDK defaults (an SDK todo, after this note)

## Tasks

- [ ] Hold model, tasks, prices and limits fixed across arms; change one flag per arm.

## Acceptance criteria

- [ ] The results note lists, per arm, pass^5 and cost per task with intervals, and a verdict
- [ ] HD3's defaults are confirmed or changed with the evidence linked
- [ ] The overshoot measurement for HD9 is recorded
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None in `pnpm test`.

## Docs to update

`packages/evals/results/<date>-ablations.md`; the plan's HD3 and HD9 text through a follow-up. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Small suites cannot detect small effects; verdicts under 10 points need paired statistics or are marked inconclusive.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
