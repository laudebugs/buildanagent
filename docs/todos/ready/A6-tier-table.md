# A6: The tier table as code and its compilation into the pipeline (AD2)

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A6` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 2](../../plans/build-agent.md#42-stage-2-compiles-the-tier-table-into-the-pipeline-and-adds-the-kill-switch-the-quorum-and-the-taint-rule) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A3](A3-tool-contract-lint.md), [N12](N12-permission-pipeline.md) |
| Size | M |

## Goal

Turn the guide's T0–T5 table into data and compile it into the harness's `PermissionConfig` as deny rules, hooks and a host callback, so every tool's gate follows from its tier and T4 stays denied until the owner sets the caps.

## Context

- [AD2](../../plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-accepted): the decision and its evidence
- [AD10](../../plans/build-agent.md#ad10-no-classifier-approves-any-call-and-a-classifier-may-only-raise-a-tier): no classifier approves
- [build-agent.md §3.3](../../plans/build-agent.md#33-policy-tiers-store-quorum-and-taint): `AgentPolicy`, `compilePolicy()`
- [ADR 0023](../../decisions/0023-tier-table-as-code.md)

## Scope

**In scope**

- `DEFAULT_POLICY` with `caps: null`
- `compilePolicy()`: T5 names as deny rules; the host callback allows T0–T1, asks for T2–T3, denies T4 without caps and asks with caps; untiered and MCP tools get T3
- Per-run call caps per tier
- `rule` and `by` on every decision; `policyVersion` from the policy
- A hash test that fails when the table changes without a `policy/CHANGELOG.md` entry

**Out of scope** (and which todo covers it)

- Counters and the kill switch (A7)
- The quorum (A8)
- The taint hook (A9)

## Tasks

- [ ] Rely on N12's test that a pipeline with no allow rules is valid (AH11, covered); add one test that the compiled config constructs.
- [ ] Write each tier's behaviour as its own test case.

## Acceptance criteria

- [ ] With `caps: null`, a T4 call is denied with rule `tier:billing_issue_refund@<version>`
- [ ] An unregistered MCP tool asks
- [ ] A deny rule on a T5 name wins in every permission mode
- [ ] No allow rule exists in the compiled config
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/policy/tiers.test.ts`.

## Docs to update

`packages/triage-agent/src/policy/CHANGELOG.md` (first entry). The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

The cap values and sign-off owners wait for the owner (AD2).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
