# N12: Permission pipeline: order, rules, modes and the no-match default

| Field | Value |
| --- | --- |
| ID | `N12` |
| Status | `done` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../done/N11-tool-registry.md), [B13](../done/B13-interceptors-observers.md) |
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

- [x] Test every ordering rule as its own case: a deny beats an allow in `bypass`; a hook deny beats everything.
- [x] Normalise chained shell commands (`a && b`, `a; b`) into parts, and match each part.

## Acceptance criteria

- [x] A deny rule wins in every mode, including `bypass`
- [x] Headless with no matching rule denies; interactive asks
- [x] An allow rule covering a tool that has a host callback throws at construction
- [x] A hook cannot return `allow` (type error and runtime check)
- [x] A configuration of deny rules, hooks and a host callback, with no allow rules, constructs without `PermissionConfigError` (agent AH11)
- [x] Every `decide()` writes one `permission_decision` entry with `decision`, `rule`, `policyVersion` and `inputHash`, for allows as well as asks and denials
- [x] A hook receives `PolicyContext` with the session, the turn's host context and the session's entries
- [x] An edit that removes a test file asks under `defaultAskRules`
- [x] In `shadow` mode the tool's `execute` never runs and a `shadow_call` entry is written
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/pipeline.test.ts`, `rules.test.ts`, `modes.test.ts`.

## Docs to update

`packages/harness/README.md`: the order and the no-handler outcome, stated in the option's JSDoc too. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Shell normalisation is heuristic; record its limits rather than widen a rule.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The harness now decides every tool call in one ordered pipeline, in `packages/harness/src/permissions/`. The plan's §3.4 sketch holds with the differences below.

**Public API (`@buildanagent/harness/permissions`).**
- `createPermissionPipeline(config, registry)` returns a `PermissionPipeline` with `decide(call, input)` and `gate(context)`.
- `defaultAskRules`, `shadowWrapper(session, mode)` and `PermissionConfigError`, a `HarnessError` with the new code `invalid_permission_config`.
- Types: `PermissionConfig`, `PermissionMode`, `Rule`, `ToolCall`, `PolicyInput`, `PolicyContext`, `PermissionHook`, `HookDecision`, `Decision`, `PolicySession` and `RecordedEntry`.

**Behavior.**
- The order is hooks, deny rules, ask rules, the mode, allow rules, the host callback, then no match. A hook's deny and a deny rule end the decision in every mode. A hook's ask is held until the deny rules have run.
- `permission_decision` is written on every `decide()`, with `rule` such as `deny[0]`, `mode:bypass`, `hook[1]` or `no_match`.
- It fails closed: a hook or callback that throws or returns nonsense, an input with no canonical form and an entry that can't be written each deny the call.
- Rules read `path`-like fields and the `command` field. A command is split on chain operators and `bash -c` scripts, and a command with a substitution is never allowed by a rule.

**Decisions.**
- **`gate(context)` takes a function.** The sketch's `gate()` had no way to reach the session, host context or entries that a hook receives, so the host passes one function that gives them per call.
- **`decide(call, input)` takes `PolicyInput`, not `PolicyContext`.** The pipeline adds `mode` and `policyVersion` itself, so a caller can't hand a hook a mode the pipeline isn't in.
- **The session is a small interface, `PolicySession`, with `append()`.** N3's store doesn't exist yet. Its `Session` will satisfy the interface, and the store fills in each entry's id, sequence, time and origin.
- **The mode meanings are ours.** The plan names five modes and doesn't define them. `accept_edits` and `read_only` read two new options, `editTools` and `readOnlyTools`, because the registry has no read-only or edit flag. `read_only` denies other tools even when an allow rule matches. `bypass` and `shadow` still honour deny and ask rules, and shadow skips asks because nothing runs.
- **`PermissionConfigError` extends `HarnessError`,** following the one-error-class-per-package rule. A tool registered after construction is checked at decide time and refused.
- **`defaultAskRules` is path-based,** so it asks for any change to a test, hook, CI or rules file. Telling a deletion from an edit is the product's hook.

**Left out.** Pauses and resolutions (N13), sticky and grouped approvals (N14), and a path rule for a bash command that edits a file.

