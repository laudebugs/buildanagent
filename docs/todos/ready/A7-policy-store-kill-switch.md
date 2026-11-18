# A7: Policy store, counters and the graded kill switch, with the delay measurement (AD4)

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A7` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 2](../../plans/build-agent.md#42-stage-2-compiles-the-tier-table-into-the-pipeline-and-adds-the-kill-switch-the-quorum-and-the-taint-rule) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A6](A6-tier-table.md) |
| Size | M |

## Goal

Build the `PolicyStore` with its memory and file backends, the permission hook that denies killed or spent calls, and the interceptor that stops a running role, then measure how fast a flip reaches a running ticket.

## Context

- [AD4](../../plans/build-agent.md#ad4-an-in-process-policy-snapshot-read-synchronously-by-a-permission-hook-with-a-measured-kill-switch-delay-provisional): the decision and its settling test
- [build-agent.md §3.3](../../plans/build-agent.md#33-policy-tiers-store-quorum-and-taint): `PolicyStore`, `policyHook()`, `killSwitchInterceptors()`
- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): limits per run, requester, tenant and day; a graded kill switch
- [ADR 0025](../../decisions/0025-in-process-policy-store.md)

## Scope

**In scope**

- `memoryPolicyStore()` and `filePolicyStore()` (atomic rename, watch plus 1-second polling)
- Counters `pages_per_tenant_hour`, `replies_per_requester_hour`, `t4_value_per_tenant_day`
- Kill scopes by tool, tier, tenant and global
- `policyHook()` (deny only) and `killSwitchInterceptors()` (`shouldStop` returning `{ stop: "hook", reason: "kill_switch" }`)
- A measurement script for read latency and flip-to-stop delay

**Out of scope** (and which todo covers it)

- The operator CLI (A23)
- A multi-host store (later)

## Tasks

- [ ] Persist a counter before `consume()` resolves true.
- [ ] Run the measurement on the file backend and record the numbers in the package README.

## Acceptance criteria

- [ ] A killed tier denies its next call; a killed tenant leaves other tenants running
- [ ] A kill during a scripted planner run ends it `stopped` with `stoppedBy: "kill_switch"`, which the workflow maps to the `kill_switch` handoff, not `done` (R4)
- [ ] A spent daily T4 value budget denies a refund below the single-approver cap
- [ ] A file-store flip stops a scripted planner at its next step within 2 seconds, or the README records the measured delay and ADR 0025 is updated
- [ ] Snapshot reads do no I/O (a test stubs `fs` and counts calls)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/policy/store.test.ts`, `kill-switch.test.ts`; `scripts/measure-kill-switch.mjs`.

## Docs to update

The package README's "Kill switch" section; ADR 0025's status. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

File watching differs across platforms; the polling fallback bounds the delay.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
