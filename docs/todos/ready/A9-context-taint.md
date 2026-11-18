# A9: Context taint from origin labels and the T2+ taint rule (AD5)

| Field | Value |
| --- | --- |
| ID | `A9` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 2](../../plans/build-agent.md#42-stage-2-policy) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A6](A6-tier-table.md), [N6](N6-session-runner.md) |
| Size | S |

## Goal

Derive each context's taint from the session's per-block origin labels and the tools' declared output trust, and deny any T2+ call a tainted context proposes, so text from the requester cannot steer a disruptive action.

## Context

- [AD5](../../plans/build-agent.md#ad5-hd1s-per-block-origin-plus-a-per-context-taint-and-no-per-argument-tracking-provisional): the decision and its two rules
- [build-agent.md §3.3](../../plans/build-agent.md#33-policy-tiers-store-quorum-and-taint): `contextTaint()`, `taintHook()`
- [ADR 0026](../../decisions/0026-provenance-block-origin-and-context-taint.md)
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): need H10

## Scope

**In scope**

- `contextTaint(entries, tools)` returning the taint and its sources
- `taintHook()` denying T2+ calls from a tainted context
- Taint sources on every ask, for the approval card (A12)

**Out of scope** (and which todo covers it)

- Per-argument tracking (rejected for v1)

## Tasks

- [ ] Until H10 lands, read output trust from the agent's tool table by tool name, and note the workaround in code.

## Acceptance criteria

- [ ] A context with a `user`-origin block is tainted; the planner's context in a scripted run is clean
- [ ] An escalation proposed by a tainted context is denied with rule `taint`
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
