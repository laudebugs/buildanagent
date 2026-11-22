# N18: Sandbox escalation state machine

| Field | Value |
| --- | --- |
| ID | `N18` |
| Status | `ongoing` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md), [N13](../done/N13-signed-approvals.md) |
| Size | M |

## Goal

Turn a sandbox denial into a tested, host-side state transition: under `never` the denial returns to the model, under `on-request` it becomes a signed approval and, once approved, one rerun with a widened policy.

## Context

- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): Codex's escalation flow; the model never widens its own sandbox
- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): the API sketch
- [HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5): the decision and its evidence

## Scope

**In scope**

- `escalation({ approvalPolicy, approvals })` with states sandboxed, denied, requested, approved, rerun, done
- `granular`: per-rule escalation policy
- No tool parameter or model output that can request a wider sandbox

**Out of scope** (and which todo covers it)

- New backends

## Tasks

- [ ] Write the transition table as data and test every edge.
- [ ] Check that a hook approval covers the rerun and a classifier allow (`by: "classifier:…"`) does not.

## Acceptance criteria

- [ ] Under `never`, a denial reaches the model as an error result and no approval entry is written
- [ ] Under `on-request`, a denial writes `approval_requested`; after `allow`, the command reruns once with the widened policy
- [ ] A second denial after the rerun returns to the model and does not escalate again
- [ ] No tool schema in the registry contains a field that widens the sandbox (schema scan test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/escalation.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
