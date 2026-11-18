# A20: First live eval at k = 5, discordance and judge calibration (AD7)

| Field | Value |
| --- | --- |
| ID | `A20` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 4](../../plans/build-agent.md#44-stage-4-builds-the-eval-suite-and-the-release-gate-then-runs-them-live-once-the-owners-inputs-arrive) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A18](A18-release-gate-baseline.md), [A19](A19-owner-eval-inputs.md), [N37](N37-inspect-bridge.md) |
| Size | M |

## Goal

Run the real suite at k = 5 on real models through the Inspect bridge, twice with one configuration, calibrate the judge, and publish the first gate report beside the single-call baseline.

## Context

- [AD7](../../plans/build-agent.md#ad7-k--5-15-budgets-and-a-two-week-shadow-stay-as-starting-values-until-two-baseline-runs-measure-discordance-provisional): the discordance rules
- [agent guide §6](../../guides/agent.md#6-evals-30-real-tickets-graded-on-final-state-released-on-passk-with-cost-beside-every-score): judge calibration and the baseline
- [N37](N37-inspect-bridge.md): the bridge

## Scope

**In scope**

- Two same-configuration runs and their discordance
- Judge agreement against the 50 human-labelled summaries
- The single-call baseline on the same tasks
- Per-model overlays kept only if they help
- A report in `packages/triage-agent/evals/results/<date>-baseline.md`, with no ticket content

**Out of scope** (and which todo covers it)

- Shadow on real tickets (later phase, build-agent.md §6.4)

## Tasks

- [ ] Get the owner's budget sign-off before any live run.
- [ ] Read every flipped task's transcript.

## Acceptance criteria

- [ ] The report lists pass@1, pass^5, cost, cost per resolved ticket and p95 latency per slice for both the workflow and the baseline
- [ ] Discordance is reported and AD7's rules are applied
- [ ] Rubric scores are marked gating or non-gating by the calibration result
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None in `pnpm test`; the report is the output.

## Docs to update

The results file; AD7's status through P4 or a follow-up. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Live cost; the owner sets the cap.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
