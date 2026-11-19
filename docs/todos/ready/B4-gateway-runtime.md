# B4: Gateway runtime: `createModel`, retries, middleware, `onPayload` and the request dump

| Field | Value |
| --- | --- |
| ID | `B4` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-builds-the-gateway-types-and-the-scripted-model-that-every-later-todo-tests-against) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B3](../done/B3-scripted-model.md) |
| Size | M |

## Goal

Wrap any adapter in the gateway's shared behaviour (explicit model resolution, safe retries, middleware and request inspection) so adapters stay thin and every model call is retried and dumped the same way.

## Context

- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): three retry layers, replay safety, the full-request dump
- [agent-SDK guide §9](../../guides/agent-sdk.md#9-the-public-api-should-be-functions-with-options-objects-an-explicit-provider-and-nothing-that-reaches-outside-the-process-by-default): an explicit provider, nothing outward by default
- [gateway API §3.2](../../plans/build-sdk.md#32-gateway-api)

## Scope

**In scope**

- `createModel()` that takes an adapter object, never a string
- `Model.caps` (`contextWindow`, `maxOutputTokens`, `images`, `reasoning`), read from the catalog entry B5 fills; a model without an entry gets caps from the adapter's defaults
- HTTP retries (default 2) before any output, abortable backoff, no replay after the first output event, quota errors final, a `retry` event per attempt
- `ModelMiddleware` with `transformParams` and `wrapStream`, first is outermost
- `onPayload` and the `onRequest` dump
- Error classification into `retryable`, `overflow`, `quota` and `fatal`

**Out of scope** (and which todo covers it)

- Turn-level retries above the model (B11)
- Pricing (B5)

## Tasks

- [ ] Implement `createModel()`; `Model.complete()` folds `Model.stream()`.
- [ ] Implement retries with exponential backoff (2 s initial delay, factor 2, as Vercel's default), cancelled by the signal.
- [ ] Never retry once an output event has been emitted, and never retry a `quota` error.
- [ ] Compose middleware first-is-outermost; document the order.
- [ ] Call `onRequest` with the full request (context, options, wire body after `onPayload`) before each attempt.
- [ ] Test with `ScriptedModel` plus a failing-adapter double that errors before or after its first output event.

## Acceptance criteria

- [ ] A `retryable` failure before output is retried twice, emitting two `retry` events, then succeeds or returns the `error` terminal
- [ ] A failure after the first delta is not retried
- [ ] A `quota` error is not retried
- [ ] Aborting during backoff ends promptly with `stopReason: "aborted"`, within 50 ms of the abort in a test with a fixed clock
- [ ] `createModel({ adapter: "claude-x" })` is a type error (a `@ts-expect-error` test)
- [ ] Two middlewares run in documented order (a test asserts the call sequence)
- [ ] `Model.caps` carries the `contextWindow` and `maxOutputTokens` of the model's catalog entry (a test with a fixture catalog)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/retries.test.ts`, `middleware.test.ts`, `create-model.test.ts`.

## Docs to update

`packages/gateway/README.md`: retries and middleware. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The error classifier needs each adapter's status codes; B8 and B9 extend its table.

## Revision (2026-11-18, SDK gaps)

Gap 7 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) asks for proof that the gateway never falls back to another credential. Add one acceptance criterion:

- [ ] With decoy provider key variables set in the test process, `createModel()` sends only `ProviderConfig.apiKey`, a missing `apiKey` fails before any request, and no code path reads a key from the environment (a recording transport checks every request).

The safety package's [E6](E6-byok-no-fallback.md) asserts the same rule for the AI SDK's providers.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
