# B9: OpenAI-compatible Chat Completions adapter and its mock transport

| Field | Value |
| --- | --- |
| ID | `B9` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 2](../../plans/build-sdk.md#42-stage-2-providers) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](B5-usage-cost-catalog.md), [B6](B6-transform-messages.md), [B7](B7-tool-name-table.md) |
| Size | L |

## Goal

Ship the `openai-chat` adapter, one of the two first wire protocols in D2, with a mock transport, so the loop and the capstone run on a real wire format offline.

## Context

- [D2](../../plans/build-sdk.md#d2-anthropic-messages-and-openai-compatible-chat-completions-first-owner-to-confirm): why this protocol, and plain `fetch`
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): the stream protocol, in-band errors, caching
- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name) and [D4](../../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it): usage mapping and billed totals

## Scope

**In scope**

- `openaiChat(config)` in `@agent-speak/gateway/openai-chat`, over `fetch` through `ProviderConfig.transport`
- An SSE parser that emits `ModelEvent`s passing `assertStreamContract()`
- Request encoding: system, messages after `transformMessages`, tools lowered to strict form with names sanitised (B7)
- Caching: per-model `compat` flags for OpenAI-compatible servers
- Usage mapping into the four classes, with a check of whether reasoning is inside output
- Error mapping into the B4 classes
- `mockTransport("openai-chat", script)` with fixtures for text, reasoning, parallel tool calls, a `length` stop and each error class

**Out of scope** (and which todo covers it)

- Live calls to the real API (an opt-in script outside `pnpm test`, if wanted)
- Other protocols (deferred by D2)

## Tasks

- [ ] Write wire fixtures from the API reference, including a tool-call JSON split across chunks.
- [ ] Implement the adapter; the API key comes only from `config.apiKey`, never from the environment.
- [ ] Record in the adapter README: the token-class mapping, whether responses carry a billed cost, and whether reasoning is counted inside output, each with the API-reference link and date.
- [ ] Add the adapter's models to `catalog.json` if B5 lacked them.
- [ ] Run the B6 replay test across both adapters once both exist (whichever of B8 and B9 lands second adds it).

## Acceptance criteria

- [ ] Every fixture stream passes `assertStreamContract()`
- [ ] A `length` stop yields `stopReason: "length"` with the partial tool input
- [ ] Each error fixture maps to its B4 class and returns an in-band `error` terminal
- [ ] `baseURL` and `transport` reach every request (a test asserts the URL and that the mock transport saw it)
- [ ] The adapter reads no environment variable (a test replaces `process.env` with a recording proxy and asserts no key was read)
- [ ] The README records the usage mapping and billed-cost answer with sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/openai-chat.test.ts` and fixtures under `packages/gateway/test/fixtures/openai-chat/`.

## Docs to update

`packages/gateway/README.md` and an adapter section; ADR 0003 if the reasoning check changes D3. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Fixtures can drift from the live API; B18's stamps and expiry apply to recorded pairs, and a live smoke script stays opt-in. Size L: split the caching work into its own todo if the batch grows.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
