# B12: Parallel tool scheduling, per-resource serialisation and sibling cancellation

| Field | Value |
| --- | --- |
| ID | `B12` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../ongoing/B11-loop-core.md) |
| Size | M |

## Goal

Run a step's tool calls in parallel by default while keeping results in model order and serialising calls that touch the same resource.

## Context

- [agent-SDK guide §4](../../guides/agent-sdk.md#4-tools-should-take-standard-schema-validate-inside-the-sdk-and-return-every-failure-to-the-model-as-data): parallel by default, per-tool classes
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): `executionMode`, `resourceKey`, `firstParty`

## Scope

**In scope**

- Parallel start of a step's calls; results appended in model order
- `executionMode: "sequential"` forces its batch sequential
- `resourceKey` serialises calls with the same key
- A sibling-cancelling signal in `ToolContext`
- Gates run sequentially in model order before any execution
- `readOnlyHint` affects scheduling only for `firstParty` tools

**Out of scope** (and which todo covers it)

- Gate logic itself (B13)

## Tasks

- [ ] Implement a scheduler with a per-key queue.
- [ ] Abort the siblings' signal when a call in the batch throws a programmer error or the run aborts; a model-caused `isError` result cancels nothing. Document the rule.
- [ ] Test with tools that record start and end times from the fixed clock.

## Acceptance criteria

- [ ] Three independent calls start before any ends (fixed-clock timestamps)
- [ ] Two calls with the same `resourceKey` never overlap
- [ ] Results appear in model order whatever the finish order
- [ ] A sequential tool runs its batch one at a time
- [ ] An MCP-style tool with `readOnlyHint` but no `firstParty` is not scheduled as read-only
- [ ] A programmer error in one call aborts its siblings' signals, and an `isError` result does not
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/scheduler.test.ts`.

## Docs to update

`packages/sdk/README.md`: scheduling rules. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Timing tests can flake; use the fixed clock and explicit promises, never real timers.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
