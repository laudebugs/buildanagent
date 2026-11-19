# A23: Kill-switch CLI, human-only fallback and the incident runbook

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A23` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 5](../../plans/build-agent.md#45-stage-5-builds-the-rollout-machinery-that-shadow-canary-and-release-will-need) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A7](A7-policy-store-kill-switch.md), [A22](A22-shadow-metrics.md) |
| Size | S |

## Goal

Give operators a command that kills or restores the agent by tool, tier, tenant or globally, make the fallback to human-only triage a tested path, and write the runbook that ends every incident with a regression task.

## Context

- [AD4](../../plans/build-agent.md#ad4-an-in-process-policy-snapshot-read-synchronously-by-a-permission-hook-with-a-measured-kill-switch-delay-provisional): the policy store
- [agent guide §7](../../guides/agent.md#7-ship-in-four-stages-behind-a-graded-kill-switch-hand-off-to-people-by-design-and-turn-each-incident-into-a-regression-task): handoff by design, incidents become regression tasks

## Scope

**In scope**

- `triage-agent kill --tool|--tier|--tenant|--all [--restore] --reason <text>`, writing `by` and `reason`
- A global kill routes every new ticket to `handoff` with `kill_switch`
- `packages/triage-agent/RUNBOOK.md`: when to kill which scope, how to restore, and the regression-task template
- The review cadence from the guide: re-review on every tool, tier, model, prompt or policy change; monthly decision-log review; quarterly red-team pass

**Out of scope** (and which todo covers it)

- Paging integration (later phase)

## Tasks

- [ ] Test the CLI against a file store in a temp directory.

## Acceptance criteria

- [ ] Each scope's kill and restore has a test
- [ ] A global kill during a run hands the ticket to a person at the next step
- [ ] The runbook has a regression-task template that A17's format accepts
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/rollout/cli.test.ts`.

## Docs to update

`RUNBOOK.md`. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
