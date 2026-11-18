# A9: Session taint from origin labels and the T2+ taint rule (AD5)

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A9` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 2](../../plans/build-agent.md#42-stage-2-compiles-the-tier-table-into-the-pipeline-and-adds-the-kill-switch-the-quorum-and-the-taint-rule) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A6](A6-tier-table.md), [N6](N6-session-runner.md) |
| Size | S |

## Goal

Derive each role's session taint from its per-block origin labels and the tools' declared output trust, and deny any T2+ call proposed in a tainted session, so text from the requester cannot steer a disruptive action.

## Context

- [AD5](../../plans/build-agent.md#ad5-hd1s-per-block-origin-plus-a-per-session-taint-and-no-per-argument-tracking-provisional): the decision and its two rules
- [build-agent.md §3.3](../../plans/build-agent.md#33-policy-tiers-store-quorum-and-taint): `sessionTaint()`, `taintHook()`
- [ADR 0026](../../decisions/0026-provenance-block-origin-and-context-taint.md)
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): need AH10, now in harness N2 and N11

## Scope

**In scope**

- `sessionTaint(entries, tools)` returning the taint and its sources
- `taintHook()` denying T2+ calls from a tainted session
- Taint sources on every ask, for the approval card (A12)

**Out of scope** (and which todo covers it)

- Per-argument tracking (rejected for v1)

## Tasks

- [ ] Read output trust from `tool_result.trust`, so the taint survives a rebuild from the log.

## Acceptance criteria

- [ ] A session with a `user`-origin block is tainted; a scripted planner-style session whose input is written with `inputOrigin: "operator"` (as A11 does) is clean
- [ ] An escalation proposed in a tainted session is denied with rule `taint`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/policy/taint.test.ts`.

## Docs to update

None beyond the README's policy section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

A tool that mislabels its output trust breaks the guarantee; the lint (A3) requires the field.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
