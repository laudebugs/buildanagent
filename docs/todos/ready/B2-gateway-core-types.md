# B2: Gateway core types, the v1 model spec, the stream contract and `complete()`

| Field | Value |
| --- | --- |
| ID | `B2` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-foundations) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B1](B1-sdk-workspace-scaffold.md) |
| Size | M |

## Goal

Define the provider-neutral transcript and the single-method model spec that every adapter, the test model and the loop share, plus the checker that enforces the stream rule, so later todos build against fixed types.

## Context

- [gateway API §3.2](../../plans/build-sdk.md#32-gateway-api): the signatures to implement
- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name): the `Usage` field names
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): one method, one terminal event, in-band errors

## Scope

**In scope**

- `types.ts`: `ContentBlock`, `OpaqueToken`, `Message`, `AssistantMessage`, `Context`, `ModelContext`, `Usage`, `Cost`, `ModelRef`
- `spec.ts`: `ModelAdapter` with `specificationVersion: "v1"` and `ModelEvent`
- `stream-contract.ts`: `assertStreamContract()`
- `complete.ts`: fold a stream into one `AssistantMessage`
- `usage.ts`: `totalInput()` and an empty-usage constructor

**Out of scope** (and which todo covers it)

- Retries, middleware and the model factory (B4)
- Pricing (B5)
- Adapters (B8, B9)

## Tasks

- [ ] Write the types from §3.2 exactly; any rename needs a plan edit in the same commit.
- [ ] Implement `assertStreamContract()`: `start` first; per index, start → deltas → end; no event after the terminal; exactly one `done` or `error`; an `error` message has `stopReason` `error` or `aborted`.
- [ ] Implement `complete()` over any `AsyncIterable<ModelEvent>`, returning the terminal message and never throwing for an `error` terminal.
- [ ] Export everything from `@agent-speak/gateway`.
- [ ] Write unit tests with hand-built event arrays for each contract rule.

## Acceptance criteria

- [ ] Every type in §3.2's transcript and spec blocks is exported
- [ ] `assertStreamContract()` rejects each of: a delta before `start`, a delta after its `end`, two terminals, no terminal, and an `error` with `stopReason: "stop"`, with one test each
- [ ] `complete()` returns the `error` terminal's message, with partial content and usage, without throwing
- [ ] No field named `input` exists on `Usage` (a type test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/stream-contract.test.ts` and `complete.test.ts`.

## Docs to update

`packages/gateway/README.md`: the transcript and the stream rule, in a few paragraphs. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The `ContentBlock` set may need a block kind the adapters reveal (for example citations); add it in B8 or B9 with a plan edit.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
