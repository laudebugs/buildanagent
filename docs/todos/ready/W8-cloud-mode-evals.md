# W8: Cloud-mode evals against mini-swe-agent

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W8` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W6](W6-pr-delivery.md), [N38](N38-seed-suite-baseline.md), [N49](N49-hosted-sandbox-measurement.md), [W12](W12-coding-agent-eval-tasks.md) |
| Size | M |

## Goal

Run the thirty-task seed suite, N38's twenty repository tasks plus W12's ten coding-agent tasks, through the deployed agent and report pass^k and cost beside mini-swe-agent, with provisioning time and infra failures counted apart (CA9). The owner amended HD8 on 2026-11-19 so the baseline runs at thirty.

## Context

- [Harness plan, HD8](../../plans/build-harness.md#hd8-a-30-task-seed-suite-from-real-failures-and-triage-tasks-at-k--5-accepted): the suite, k and the $3 cap.

## Scope

**In scope**

- A cloud mode for the eval runner
- A report with provisioning time, infra failures, pass^k and cost

**Out of scope**

- New task suites

## Tasks

- [ ] Add the cloud mode to the eval package
- [ ] Run the thirty tasks at k = 5 on Cloudflare
- [ ] Commit the report

## Acceptance criteria

- [ ] A committed report beside the local baseline
- [ ] A recommendation on CA8 (the snapshot cache)

## Tests

The eval run is opt-in and never part of CI.

## Docs to update

Plan CA8 and CA9 with the numbers.

## Risks and open questions

Live runs cost money; the $3 per-task cap applies.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
