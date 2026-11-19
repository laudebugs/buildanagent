# N38b: Add the 10 shared triage tasks to the seed suite

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `N38b` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), deferred with M7b |
| Depends on | [N38](N38-seed-suite-baseline.md), [A17](A17-eval-tasks-graders.md), [A19](A19-owner-eval-inputs.md) |
| Size | M |

## Goal

Add the agent's 10 classification-slice tasks to HD8's seed suite when Round A resumes, without holding the harness baseline (N38) behind Round A. Under the owner's HD8 amendment of 2026-11-19, N38's 20 repository tasks and W12's 10 coding-agent tasks make the suite 30, so these 10 triage tasks extend it to 40.

## Context

- [HD8](../../plans/build-harness.md#hd8-a-30-task-seed-suite-from-real-failures-and-triage-tasks-at-k--5-accepted): 20 repository tasks plus 10 shared triage tasks, k = 5
- [agent plan AD6](../../plans/build-agent.md#ad6-the-owner-names-the-policy-writer-and-two-labelling-leads-and-the-judge-and-simulator-run-on-the-other-provider-accepted): the classification slice and who labels it
- [agent plan AD8](../../plans/build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-accepted-with-hd11): the repo holds only synthetic and de-identified tickets
- [P4 review R22](../../plans/reviews/plan-review.md#23-buildability-the-graph-is-sound-and-one-cross-round-task-source-is-unscheduled): why N38 was split

## Scope

**In scope**

- A runner that loads the 10 classification-slice `TriageTask`s from `@buildanagent/triage-agent/evals` and runs them on the harness with the fake helpdesk and the triage tools
- A decision, recorded in the results note, on how mini-swe-agent receives a ticket: as a task file it reads with bash, or not at all, in which case those 10 tasks are scored for our harness only and the report says so
- Two runs of the same configuration for discordance on the 40-task suite

**Out of scope** (and which todo covers it)

- The 20 repository tasks and the first baseline (N38)
- Labelling the tickets (the owner, A19)

## Tasks

- [ ] Import the task ids and graders from `@buildanagent/triage-agent/evals`; commit only the ids, grader names and versions in `packages/evals`.
- [ ] Keep ticket text in the agent's eval package, which holds only synthetic and de-identified tickets; never copy a raw ticket into `packages/evals`.
- [ ] Try the task-file route for mini-swe-agent on one task offline against the mock server, and record the result.
- [ ] Run the 40-task suite twice at k = 5 within the owner's budget, through N37's live script.

## Acceptance criteria

- [ ] `packages/evals` lists the 10 task ids with their grader versions, and contains no ticket text
- [ ] The results note states how mini-swe-agent received the tickets, or that the 10 tasks are scored for our harness only
- [ ] The report gives pass@1, pass^5 and cost per task for the 40-task suite, with discordance between the two runs
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None in `pnpm test` beyond a check that the task-id list resolves against the agent's eval package; the report is the output.

## Docs to update

HD8 in [build-harness.md](../../plans/build-harness.md#hd8-a-30-task-seed-suite-from-real-failures-and-triage-tasks-at-k--5-accepted) if the mini-swe-agent route changes the suite; the plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Live cost; N37's script refuses to run without the owner's budget flag. N39 may run before this todo on the 20 repository tasks alone, and its note says which suite it used.

History: plan review 2 (2026-11-19) moved this todo to M7b and changed its suite from 30 to 40 tasks after the owner's HD8 amendment.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
