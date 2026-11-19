# B3: `ScriptedModel`, chunked streams, determinism options and `allowModelRequests`

| Field | Value |
| --- | --- |
| ID | `B3` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-builds-the-gateway-types-and-the-scripted-model-that-every-later-todo-tests-against) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B2](../done/B2-gateway-core-types.md) |
| Size | M |

## Goal

Ship the strict scripted test model before any loop code, because every later test drives it; the guide asks for the test model from the first release.

## Context

- [agent-SDK guide §8](../../guides/agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release): strictness, frozen snapshots, `assertComplete()`, injected ids
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): the `testing` signatures
- [test strategy §5](../../plans/build-sdk.md#5-test-strategy)

## Scope

**In scope**

- `ScriptedModel` with fixed and responder steps
- Chunked streams: text and tool-input JSON split into token-sized deltas, with abort checked between chunks
- `UnexpectedModelCallError` on over-run; `assertComplete()` on under-run
- Frozen, detached `RecordedRequest` snapshots
- `fixedClock()`, `sequentialIds()`, a seeded `random`
- `allowModelRequests(false)` in the gateway's `testing` export

**Out of scope** (and which todo covers it)

- `autoResponder` and seam doubles (B18)
- Record and replay (B18)

## Tasks

- [x] Implement `ScriptedModel implements ModelAdapter`, emitting events that pass `assertStreamContract()`.
- [x] Split text and tool-input JSON into chunks of a configurable size (default: 4 characters), taking sizes and ids only from the injected options, never `Math.random()` or `Date.now()`.
- [x] Record each request with `structuredClone` and `Object.freeze` it deeply.
- [x] Implement `allowModelRequests(false)`: a module-level flag that makes any adapter whose transport is not a mock throw before sending.
- [x] Add the B1 setup file's call to `allowModelRequests(false)`.

## Acceptance criteria

- [x] A script with two steps called three times throws `UnexpectedModelCallError` on the third call
- [x] A script with two steps called once fails `assertComplete()`
- [x] Mutating the context after a call leaves `calls[0]` unchanged
- [x] Two runs of the same script with `fixedClock` and `sequentialIds` emit deep-equal event arrays
- [x] Aborting between chunks ends the stream with an `error` terminal whose `stopReason` is `aborted`
- [x] Every `ScriptedModel` stream passes `assertStreamContract()`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/scripted-model.test.ts`, `packages/gateway/test/allow-model-requests.test.ts`.

## Docs to update

`packages/sdk/README.md`: a testing section. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

`ScriptedModel` lives in the SDK package but implements a gateway type; keep it free of loop imports so B4's gateway tests can use it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome (2026-11-19)

- **`@buildanagent/sdk/testing`** exports `ScriptedModel`, `UnexpectedModelCallError`, `fixedClock()`, `sequentialIds()` and `seededRandom()`, and the `AssistantScript`, `RecordedRequest`, `ScriptStep`, `ScriptedModelOptions` and `Clock` types. `ScriptedModel` imports only gateway types, never loop code.
- **Plan edits in §3.3:**
  - `AssistantScript` and `RecordedRequest` were used but undefined; B3 defines both.
  - `ScriptedModel`'s options gain `idGenerator`, which fills missing tool-call ids.
  - `seededRandom()` is listed beside the other determinism helpers.
- **`allowModelRequests()`** is a module-level switch in the gateway (`src/request-policy.ts`). Adapters call `assertModelRequestAllowed(transport)` before sending. `markMockTransport()` marks the in-process mocks that B4's `mockTransport()` will return, and the shared setup now calls `allowModelRequests(false)`.
- **Choices beyond the todo:**
  - A call past the script isn't recorded in `calls`.
  - An `image` block in a script goes into the final message without stream events, because the stream rule has no image events.
  - An aborted stream keeps the text streamed so far, but no partial tool call.
- **Tests:** 31 in the gateway, 4 of them new for the request switch, and 14 in the SDK, 11 of them new for `ScriptedModel` and the determinism helpers.

**Renamed 2026-11-19.** This todo created its packages under the `@agent-speak/` scope; [#27](https://github.com/laudebugs/buildanagent/pull/27) renamed them to `@buildanagent/`, and this file now uses the new names.
