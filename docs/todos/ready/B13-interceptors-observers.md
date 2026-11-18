# B13: The six interceptors and observers

| Field | Value |
| --- | --- |
| ID | `B13` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](B11-loop-core.md) |
| Size | M |

## Goal

Add the six typed interceptors and the separate observer channel, which are the seams the harness's context policy and permission pipeline plug into.

## Context

- [agent-SDK guide §6](../../guides/agent-sdk.md#6-hooks-should-be-six-typed-interceptors-and-separate-observers-each-taking-one-event-object): the six interceptors, four rules, observers
- [D6](../../plans/build-sdk.md#d6-our-six-moment-named-interceptors-with-run-level-hooks-as-observers)
- [seams §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes)

## Scope

**In scope**

- `transformContext`, `beforeModelCall`, `afterModelCall`, `beforeToolCall`, `afterToolCall`, `shouldStop`, each taking one event object with `runId`, `stepIndex`, `callId`, `signal` and `timestamp`
- Gates fail closed, with an `onFailure` override
- `ModelCallPatch.activeTools` to activate deferred tools
- Observers via options and `run.on()`, which returns an unsubscribe; a throwing observer becomes `hook_error`
- `context_transformed` events
- `ContextEvent` with `system`, `messages`, `model` and `lastUsage`
- `shouldStop` returning `{ stop: "no_progress" | "hook"; reason }` as well as `boolean` or `{ continue }`

**Out of scope** (and which todo covers it)

- The `ask` pause path (B15) and resume (B15b): here `ask` is a stub that the tests do not use

## Tasks

- [ ] Wire each interceptor into the B11 loop at its moment.
- [ ] Return replacements; freeze inputs so a mutating hook throws in tests.
- [ ] Document the no-handler outcome in `beforeToolCall`'s JSDoc: no gate allows every registered tool, and `ask` pauses.

## Acceptance criteria

- [ ] Each interceptor has a test that changes the run's outcome through its return value
- [ ] A `beforeToolCall` that throws denies the call (fail closed), and with `onFailure: "continue"` the call runs
- [ ] A throwing observer emits `hook_error` and the run still ends `done`
- [ ] `run.on()` returns a function that stops delivery
- [ ] A deferred tool activated through `activeTools` appears in the next request only
- [ ] A hook that mutates its frozen input fails the test
- [ ] A masked view returned by `transformContext` reaches only that call's request; the next step's `ContextEvent.messages` and `result.messages` keep the full history (harness need 1)
- [ ] `ContextEvent` carries `system`, `messages`, `model` and, from the second call on, the previous call's `lastUsage` (harness need 2)
- [ ] `tool_call_end.result` equals the result `afterToolCall` returned, not the tool's original result (harness need 5)
- [ ] `activeTools` naming a deferred tool sends it, and a reordered `activeTools` list still sends tools in definition order (harness need 8)
- [ ] `shouldStop` returning `{ stop: "hook", reason: "r" }` ends the run `stopped` with `stoppedBy: "r"`, and `{ stop: "no_progress", reason }` ends it `no_progress`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/interceptors.test.ts`, `observers.test.ts`.

## Docs to update

`packages/sdk/README.md`: the hook order, written out. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Hook order must be documented in one place; a rule that makes a hook unreachable must fail loudly (guide §6).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
