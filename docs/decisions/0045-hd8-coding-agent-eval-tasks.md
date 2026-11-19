# 0045. Fill HD8's seed suite to 30 tasks with 10 coding-agent tasks while the triage tasks stay deferred

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [build-harness.md, HD8](../plans/build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended)

## Context

HD8 chose a 30-task seed suite at k = 5: 20 recreated failures from this repo's history and 10 triage tasks. [ADR 0032](0032-personal-coding-agent-first.md) deferred the triage agent and, with it, todo N38b, which builds the 10 triage tasks. ADR 0032 kept HD8 "unchanged", so the suite ran at 20 tasks, the floor of the 20–50 range that HD8's own evidence cites. Plan review 2 asked the owner how large the suite should be while triage is deferred ([plan review 2, D4](../plans/reviews/plan-review-2.md#2-the-owner-settled-four-questions-on-2026-11-19)).

## Decision

The owner chose "20 now, plus coding tasks". N38 ships the 20 repository tasks. A new todo, [W12](../todos/ready/W12-coding-agent-eval-tasks.md), adds 10 coding-agent tasks, which brings the suite to 30 before W8 publishes the coding agent's baseline. When Round A resumes, N38b adds its 10 triage tasks on top, for 40 in all.

## Consequences

- This record amends ADR 0032's consequence that "HD8 and its twenty repository tasks are unchanged"; the rest of ADR 0032 stands.
- W8 depends on W12 and runs 30 tasks; N38b depends on W12.
- HD8's heading and summary row in [build-harness.md](../plans/build-harness.md) carry the amendment, and CA2 in [build-coding-agent.md](../plans/build-coding-agent.md) points here.
