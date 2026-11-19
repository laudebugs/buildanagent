# B12: Parallel tool scheduling, per-resource serialisation and sibling cancellation

| Field | Value |
| --- | --- |
| ID | `B12` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../done/B11-loop-core.md) |
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

- [x] Implement a scheduler with a per-key queue.
- [x] Abort the siblings' signal when a call in the batch throws a programmer error or the run aborts; a model-caused `isError` result cancels nothing. Document the rule.
- [x] Test with tools that record start and end times from the fixed clock.

## Acceptance criteria

- [x] Three independent calls start before any ends (fixed-clock timestamps)
- [x] Two calls with the same `resourceKey` never overlap
- [x] Results appear in model order whatever the finish order
- [x] A sequential tool runs its batch one at a time
- [x] An MCP-style tool with `readOnlyHint` but no `firstParty` is not scheduled as read-only
- [x] A programmer error in one call aborts its siblings' signals, and an `isError` result does not
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/scheduler.test.ts`.

## Docs to update

`packages/sdk/README.md`: scheduling rules. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Timing tests can flake; use the fixed clock and explicit promises, never real timers.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

A step's tool calls now start together, and their results reach the transcript in model order. `ToolDefinition` gains `executionMode`, `resourceKey`, `firstParty` and `annotations.readOnlyHint`, `ToolContext.signal` also fires when a sibling throws a programmer error, and `ToolFailure`'s `not_run` kind gains the reason `sibling_failed`. The package exports the new types `ToolAnnotations` and `ToolExecutionMode`. The changeset is `.changeset/sdk-parallel-tools.md`, a `minor` bump that opens with "Breaking Changes", because a tool that relied on running after the calls before it must now set `executionMode: "sequential"`.

Each criterion and the test that covers it, all in `test/scheduler.test.ts` unless noted:

- Three independent calls start before any ends: "three independent calls all start before any of them ends", which compares the fixed clock's start and end times. `test/parallel-run.test.ts` repeats it through `run()`.
- Same-key calls never overlap: "calls with the same resourceKey never overlap and run in model order", and the same across two tools.
- Model order: "results arrive in model order whatever order the calls finish in", "onResult passes a result on as soon as every result before it is in…", and in `test/parallel-run.test.ts` the transcript and `tool_call_end` order.
- A sequential tool: "a sequential tool makes its step run one call at a time…" and "one sequential tool also holds back the parallel calls of its step".
- A hint without `firstParty`: "a readOnlyHint without firstParty does not make a call read-only". The three tests after it cover a first-party hint, a `false` hint and the read and write ordering.
- Sibling cancellation: "a programmer error in one call fires the signal its siblings hold", against "an error result the model can read cancels no sibling" and "a tool that throws an ordinary error cancels no sibling".
- Aborts: "an aborted run gives every call a result…", and in `test/parallel-run.test.ts` "an abort while calls run in parallel gives every call a result and settles before run_end".

Judgement calls, where the plan left room:

- **Gates.** `PipelineContext.gate` is the ordering hook only. Each call's gate settles before the next call's is asked, and all gates settle before any call executes. A gate returns a result to block a call, or `undefined`. It is internal until the interceptors arrive.
- **Events.** `tool_call_start` is emitted for every call of a step before the first executes, because each call is checked and gated first. `tool_call_end` events come in model order.
- **Read-only calls.** A trusted read-only call neither waits for nor blocks other read-only calls with its key, but it waits for the writes before it, and a write waits for the reads before it, so a model's "read, then write" order holds. The scheduler is a readers-writer lock built in model order, with no timers.
- **Sequential.** One sequential tool in a step runs the whole step in model order, other tools' calls included. The key lanes then play no part.
- **Programmer errors.** A malformed result from `execute` aborts the batch signal. (A `resourceKey` that throws or returns a non-string throws before any call starts.) The run waits for the other calls to return, passes on the results that come before the failing call in model order, then throws. Calls queued behind it get `sibling_failed` and never run.
- **`annotations`.** The plan listed `readOnlyHint` without a home, so it sits in `annotations`, which mirrors MCP's name.

Left undone: gate logic and the `beforeToolCall` interceptor (B13), and a `progressKey` and `execution` option the plan sketch lists for later todos.
