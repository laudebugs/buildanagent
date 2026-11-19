# B2: Gateway core types, the v1 model spec, the stream contract and `complete()`

| Field | Value |
| --- | --- |
| ID | `B2` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-builds-the-gateway-types-and-the-scripted-model-that-every-later-todo-tests-against) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B1](../done/B1-sdk-workspace-scaffold.md) |
| Size | M |

## Goal

Define the provider-neutral transcript and the single-method model spec that every adapter, the test model and the loop share, plus the checker that enforces the stream rule, so later todos build against fixed types.

## Context

- [gateway API §3.2](../../plans/build-sdk.md#32-gateway-api): the signatures to implement
- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name): the `Usage` field names
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): one method, one terminal event, in-band errors

## Scope

**In scope**

- `types.ts`: `ContentBlock`, `ModelContent`, `OpaqueToken`, `Message`, `AssistantMessage`, `ModelContext`, `ModelCaps`, `Usage`, `Cost`, `ModelRef`
- `spec.ts`: `ModelAdapter` with `specificationVersion: "v1"` and `ModelEvent`
- `stream-contract.ts`: `assertStreamContract()`
- `complete.ts`: fold a stream into one `AssistantMessage`
- `usage.ts`: `totalInput()` and an empty-usage constructor

**Out of scope** (and which todo covers it)

- Retries, middleware and the model factory (B4)
- Pricing (B5)
- `Context`, which names the SDK's `SignedPendingRequest` and so lives in `@buildanagent/sdk` (B11), keeping the gateway free of SDK types
- Adapters (B8, B9)

## Tasks

- [x] Write the types from §3.2 exactly; any rename needs a plan edit in the same commit.
- [x] Implement `assertStreamContract()`: `start` first; per index, start → deltas → end; no event after the terminal; exactly one `done` or `error`; an `error` message has `stopReason` `error` or `aborted`.
- [x] Implement `complete()` over any `AsyncIterable<ModelEvent>`, returning the terminal message and never throwing for an `error` terminal.
- [x] Export everything from `@buildanagent/gateway`.
- [x] Write unit tests with hand-built event arrays for each contract rule.

## Acceptance criteria

- [x] Every type in §3.2's transcript and spec blocks is exported
- [x] `assertStreamContract()` rejects each of: a delta before `start`, a delta after its `end`, two terminals, no terminal, and an `error` with `stopReason: "stop"`, with one test each
- [x] `complete()` returns the `error` terminal's message, with partial content and usage, without throwing
- [x] No field named `input` exists on `Usage` (a type test)
- [x] No gateway source file imports from `@buildanagent/sdk`, and `packages/gateway/package.json` has no `dependencies` entry
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/stream-contract.test.ts` and `complete.test.ts`.

## Docs to update

`packages/gateway/README.md`: the transcript and the stream rule, in a few paragraphs. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The `ContentBlock` set may need a block kind the adapters reveal (for example citations); add it in B8 or B9 with a plan edit.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome (2026-11-19)

- `src/types.ts`, `spec.ts`, `usage.ts`, `stream-contract.ts` and `complete.ts` implement §3.2's transcript and spec blocks. Every type is exported from `@buildanagent/gateway`, and `assertStreamContract()` is also exported from `./testing`, where §3.2 lists it.
- **`WireTool`** was used in `ModelContext` but defined nowhere in the plans. B2 defines it as `{ name; description; inputSchema }`, with `inputSchema` a JSON Schema object, and adds the line to §3.2.
- `assertStreamContract()` enforces two rules beyond the five this todo listed: a `done` terminal may not carry `stopReason` `"error"` or `"aborted"`, and every block a `done` stream started must have ended. Each has a test.
- **Tests:** 27 pass in the gateway: 14 for the stream contract, 6 for `complete()` and usage including the type test, 2 for package boundaries, and 5 from B1. Adding an `input` field to `Usage` fails `pnpm typecheck`, checked by hand.
