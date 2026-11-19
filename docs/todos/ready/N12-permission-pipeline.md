# N12: Permission pipeline: order, rules, modes and the no-match default

| Field | Value |
| --- | --- |
| ID | `N12` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](N11-tool-registry.md), [B13](../ongoing/B13-interceptors-observers.md) |
| Size | M |

## Goal

Decide every tool call in one ordered, deny-first pipeline that fills the SDK's `beforeToolCall` gate, fails closed, and turns a shadowed host callback into a startup error.

## Context

- [HD12](../../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback): the decision and its evidence
- [ADR 0019](../../decisions/0019-permission-pipeline-and-approval-modes.md): the decision records
- [harness guide §5](../../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries): the order, the no-match default, path-based ask rules
- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): the API sketch
- [build-harness.md §3.7](../../plans/build-harness.md#37-what-the-agent-plan-gets-from-the-harness): R4 and R5 hooks

## Scope

**In scope**

- `createPermissionPipeline()`: hooks, deny, ask, mode, allow, host callback
- Rules by tool name or alias, path globs and command prefixes
- Modes `default`, `accept_edits`, `read_only`, `bypass`, `shadow`
- No match: `ask` when `interactive`, `deny` otherwise
- `PermissionConfigError` when an allow rule makes the host callback unreachable
- `defaultAskRules` (HD12)
- `gate()` mapping `Decision` to `GateDecision`, with `policyVersion` on `ask`
- `ToolCall`, `PolicyContext` and `PermissionHook` typed as in §3.4, so a hook cannot allow at the type level (agent AH5)
- A `permission_decision` entry written on every `decide()`, allows included (agent AH9)
- `shadow` mode writing `shadow_call` entries through the registry wrapper

**Out of scope** (and which todo covers it)

- Writing and resolving pauses (N13)
- Sticky and grouped approvals (N14)

## Tasks

- [ ] Test every ordering rule as its own case: a deny beats an allow in `bypass`; a hook deny beats everything.
- [ ] Normalise chained shell commands (`a && b`, `a; b`) into parts, and match each part.

## Acceptance criteria

- [ ] A deny rule wins in every mode, including `bypass`
- [ ] Headless with no matching rule denies; interactive asks
- [ ] An allow rule covering a tool that has a host callback throws at construction
- [ ] A hook cannot return `allow` (type error and runtime check)
- [ ] A configuration of deny rules, hooks and a host callback, with no allow rules, constructs without `PermissionConfigError` (agent AH11)
- [ ] Every `decide()` writes one `permission_decision` entry with `decision`, `rule`, `policyVersion` and `inputHash`, for allows as well as asks and denials
- [ ] A hook receives `PolicyContext` with the session, the turn's host context and the session's entries
- [ ] An edit that removes a test file asks under `defaultAskRules`
- [ ] In `shadow` mode the tool's `execute` never runs and a `shadow_call` entry is written
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/pipeline.test.ts`, `rules.test.ts`, `modes.test.ts`.

## Docs to update

`packages/harness/README.md`: the order and the no-handler outcome, stated in the option's JSDoc too. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Shell normalisation is heuristic; record its limits rather than widen a rule.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
