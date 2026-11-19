# B8: Anthropic Messages adapter and its mock transport

| Field | Value |
| --- | --- |
| ID | `B8` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 2](../../plans/build-sdk.md#42-stage-2-adds-the-two-wire-adapters-and-the-replay-pass-between-them) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](../done/B5-usage-cost-catalog.md), [B6](B6-transform-messages.md), [B7](../done/B7-tool-name-table.md) |
| Size | L |

## Goal

Ship the `anthropic-messages` adapter, one of the two first wire protocols in D2, with a mock transport, so the loop and the capstone run on a real wire format offline.

## Context

- [D2](../../plans/build-sdk.md#d2-anthropic-messages-and-openai-compatible-chat-completions-first-accepted): why this protocol, and plain `fetch`
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): the stream protocol, in-band errors, caching
- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name) and [D4](../../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it): usage mapping and billed totals
- [`mock-anthropic.mjs`](../../../verify/claude-agent-sdk/scripts/mock-anthropic.mjs): the mock our harnesses already use, a source of wire fixtures

## Scope

**In scope**

- `anthropic(config)` in `@buildanagent/gateway/anthropic`, over `fetch` through `ProviderConfig.transport`, sending a pinned `anthropic-version: 2026-10-21` header
- Sampling parameters: never send `temperature`, `top_p` or `top_k` to Anthropic. On `2026-10-21` any of them returns a 400, even at its default value, so the adapter drops them with a `warning` ([Anthropic, migration to 2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21), as of November 2026)
- Thinking usage: thinking tokens count inside `output_tokens`, and `usage.output_tokens_details.thinking_tokens` arrives only on the final `message_delta` when streaming ([Anthropic, extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking))
- The thinking prefix check (HD3), behind beta header `thinking-binding-controls-2026-08-01` ([Anthropic, prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)): a 400 that says a block is "bound to a different conversation" maps to a typed error kind. The adapter then retries with `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` and sends that setting on every later request of the conversation, because the setting acts only on the request that carries it. Each `thinking_mismatch_allowed` entry in a 200 response's `input_transformations` becomes a warning event (HD3 rule 5)
- An SSE parser that emits `ModelEvent`s passing `assertStreamContract()`
- Request encoding: system, messages after `transformMessages`, tools lowered to strict form with names sanitised (B7); the nulls that strict lowering adds are stripped from the model's arguments before validation
- Caching: cache breakpoints on the system prompt, the last tool and the last user or tool-result block, at most 4
- Usage mapping into the four classes, with a check of whether reasoning is inside output
- Error mapping into the B4 classes
- `mockTransport("anthropic-messages", script)` with fixtures for text, reasoning, parallel tool calls, a `length` stop and each error class

**Out of scope** (and which todo covers it)

- Live calls to the real API (an opt-in script outside `pnpm test`, if wanted)
- Other protocols (deferred by D2)
- Computer-use toolsets such as `computer_toolset_20260801` (a later round, with the logged-in browsing ADR)

## Tasks

- [ ] Write wire fixtures from the API reference, including a tool-call JSON split across chunks.
- [ ] Implement the adapter; the API key comes only from `config.apiKey`, never from the environment.
- [ ] Record in the adapter README: the token-class mapping, whether responses carry a billed cost, and whether reasoning is counted inside output, each with the API-reference link and date.
- [ ] Add the adapter's models to `catalog.json` if B5 lacked them.
- [ ] Run the B6 replay test across both adapters once both exist (whichever of B8 and B9 lands second adds it).

## Acceptance criteria

- [ ] Every fixture stream passes `assertStreamContract()`
- [ ] Every request carries `anthropic-version: 2026-10-21`, and the README records the pin
- [ ] A request with `temperature`, `top_p` or `top_k` set reaches the wire without them and emits one warning
- [ ] Two fixtures pin the content-placement 400s of `2026-10-21`: a `document` block in an assistant message, and `citations` on a user text block
- [ ] A fixture where `thinking_tokens` arrives only on the last `message_delta` maps into `Usage.reasoning`
- [ ] A fixture 200 whose `input_transformations` holds a `thinking_mismatch_allowed` entry surfaces as a warning event (HD3 rule 5)
- [ ] A fixture 400 "bound to a different conversation" surfaces as its typed error kind, the retry carries `drop_block`, and so does every later request in that conversation
- [ ] A tool call whose optional field arrives as the `null` that strict lowering added reaches validation without that field (a fixture test)
- [ ] A `length` stop yields `stopReason: "length"` with the partial tool input
- [ ] Each error fixture maps to its B4 class and returns an in-band `error` terminal
- [ ] `baseURL` and `transport` reach every request (a test asserts the URL and that the mock transport saw it)
- [ ] The adapter reads no environment variable (a test replaces `process.env` with a recording proxy and asserts no key was read)
- [ ] The README records the usage mapping and billed-cost answer with sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/anthropic-messages.test.ts` and fixtures under `packages/gateway/test/fixtures/anthropic-messages/`.

## Docs to update

`packages/gateway/README.md` and an adapter section; ADR 0003 if the reasoning check changes D3. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

History: plan review 2 (2026-11-19) pinned the API version, dropped sampling parameters, and added the thinking-usage, content-placement and prefix-check fixtures and the computer-use exclusion.

Fixtures can drift from the live API; B18's stamps and expiry apply to recorded pairs, and a live smoke script stays opt-in. Size L: split the caching work into its own todo if the batch grows.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
