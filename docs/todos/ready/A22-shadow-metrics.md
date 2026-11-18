# A22: Rollout stages, `shadowHelpdesk`, shadow labels and dashboard rows

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A22` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 5](../../plans/build-agent.md#45-stage-5-builds-the-rollout-machinery-that-shadow-canary-and-release-will-need) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A13](A13-triage-workflow.md), [A17](A17-eval-tasks-graders.md), [N31](N31-telemetry-projection.md) |
| Size | M |

## Goal

Build the rollout machinery that runs offline: stage configuration with the retention check, the shadow wrapper that records writes while reads run, the join of shadow proposals with human decisions, and the dashboard row per bundle version.

## Context

- [AD14](../../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted) and [AD8](../../plans/build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-accepted-with-hd11): the shadow wrapper and the retention check
- [build-agent.md §5.5](../../plans/build-agent.md#55-shadow-mode-is-tested-offline-before-any-real-ticket): the offline shadow test
- [build-agent.md §3.5](../../plans/build-agent.md#35-evals-and-rollout): `StageConfig`, `joinShadowLabels()`, `DashboardRow`
- [agent guide §7](../../guides/agent.md#7-ship-in-four-stages-behind-a-graded-kill-switch-hand-off-to-people-by-design-and-turn-each-incident-into-a-regression-task): the dashboard signals

## Scope

**In scope**

- `assertStageReady()` refusing shadow and later stages without retention
- `shadowHelpdesk()`
- `joinShadowLabels()`, including whether the lead would have asked a question (AD12) and the T1–T2 labels a later classifier comparison needs (AD10), each label stored as a `product_record` entry (`"triage.shadow_label"`)
- `dashboardRows()` from the log, with hashed identifiers through `projectSpans`'s `hashAttributes`, including `guardrailFlagRate` and a `sampledJudgeScore` that stays `null` until A20 calibrates the judge
- The canary rule: only `canaryQueues` auto-apply category and priority

**Out of scope** (and which todo covers it)

- Shadow, canary and general release on real tickets (later phase)

## Tasks

- [ ] Run the synthetic suite in shadow over the fake and assert no real write.

## Acceptance criteria

- [ ] In shadow, the fake's real write list stays empty while T0 reads return data
- [ ] `assertStageReady({ stage: "shadow" })` throws without retention
- [ ] A dashboard row computes every field in §3.5 from scripted sessions, including `guardrailFlagRate` from detector and outbound-check flags
- [ ] `sampledJudgeScore` is `null` while no calibrated judge is configured
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/rollout/*.test.ts`.

## Docs to update

The README's "Rollout" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None open. Shadow labels are `product_record` entries (AH8, harness N2), and hashing is `projectSpans`'s `hashAttributes` (AH12, harness N31).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
