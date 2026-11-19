# B11c: Raw provider events: `includeRaw` and the `raw` event, from the adapters up to the loop

| Field | Value |
| --- | --- |
| ID | `B11c` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../done/B11-loop-core.md), [B4](../done/B4-gateway-runtime.md), [B8](../done/B8-anthropic-adapter.md), [B9](../done/B9-openai-chat-adapter.md) |
| Size | L |

## Goal

Let a caller opt in to the provider's own stream events beside the normalized ones. The gateway streams them first, from both adapters, and then the SDK forwards them as `raw` events when `includeRaw` is set. Today neither exists, so a caller who needs a provider-only field must use the adapter directly.

## Context

- [agent-SDK guide §5](../../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item): "Raw provider events are opt-in", and the union stays closed.
- [SDK API §3.2](../../plans/build-sdk.md#32-gateway-api) and [§3.3](../../plans/build-sdk.md#33-sdk-api): the gateway's `ModelEvent` and `StreamOptions`, and the SDK's `includeRaw?: boolean` and `{ type: "raw"; event: unknown }`, both in the sketch only.
- [B11's outcome](../done/B11-loop-core.md#outcome), under "Left out": `raw` and `includeRaw` are missing because the gateway streams no raw events, and no todo owns them.
- `packages/gateway/src/sse.ts`, `packages/gateway/src/adapters/anthropic/response.ts` and `packages/gateway/src/adapters/openai-chat/response.ts`: `sse.ts` parses the body into `ServerSentEvent`s, joining an event's `data:` lines into one string, and both adapters' `handle()` reads one `ServerSentEvent` at a time. The OpenAI Chat adapter's `data: [DONE]` is not JSON: on it, `handle()` returns the terminal event.
- `packages/gateway/src/retry.ts`: forwards each attempt's events live and counts only block events as output, so a failed attempt's events reach the caller before the retry decision.
- `packages/gateway/src/stream-contract.ts`: the contract every stream must pass, which a new event type must not break.
- [B18](../ready/B18-testing-export.md): record and replay works at the normalized boundary, so raw events stay out of recorded pairs. B18's Risks say so.

## Scope

**In scope**

- A gateway option that asks an adapter for raw events, and a `raw` member of `ModelEvent` that carries the provider's parsed event unchanged
- Both adapters emitting it: the Anthropic adapter and the OpenAI Chat adapter, each for every wire event it parses
- `createModel()`, the retry layer and `complete()` passing `raw` through, with `complete()` ignoring it
- The stream contract and `assertStreamContract()` accepting `raw` anywhere between `start` and the terminal event, and `ScriptedModel` able to emit it
- The SDK's `includeRaw` option and a `raw` event in `AgentEvent` and `AGENT_EVENT_TYPES`, off by default
- Documenting that a raw event is the provider's shape, outside our versioning, and may hold content a caller has chosen to keep out of logs

**Out of scope** (and which todo covers it)

- Typing the provider's events: the payload stays `unknown`
- Raw events in OTel spans (B17 keeps content off)
- Raw events in recorded and replayed pairs: they are never recorded, and B18's replay compares the event log without them (B18 implements it, and its Risks say so)
- Any new adapter
- Raw events from the loop's own tool and hook machinery, which have no provider event

## Tasks

- [ ] Decide the open questions in Risks, and record the choice on the plan's §3.2 revision.
- [ ] Add the gateway option and the `raw` event to the model spec, with TSDoc that says the payload is the provider's own.
- [ ] Emit the event from the Anthropic adapter, then the OpenAI Chat adapter, and cover each with its mock transport.
- [ ] Pass the event through `createModel()`, the retry layer and `complete()`, and extend the stream contract and `ScriptedModel`.
- [ ] Add `includeRaw` to `RunOptions`, forward the gateway's `raw` as the SDK's `raw` event, and extend `AGENT_EVENT_TYPES` and the type test.
- [ ] Add a changeset for each package, because both change what users get.
- [ ] Update the READMEs and the plan's todo table.

## Acceptance criteria

- [ ] With the option off, both adapters' streams are byte-for-byte what they were before, and no `raw` event appears
- [ ] With it on, each adapter emits one `raw` event per `ServerSentEvent` it handled, in wire order, before the normalized events that event produced, and the payload follows the unit decided in Risks
- [ ] OpenAI's `[DONE]`, a stream `error` event and a non-SSE HTTP error body are each handled as decided in Risks, and no `raw` event follows the terminal
- [ ] Raw events never change the normalized events, the final `AssistantMessage`, its usage or its cost
- [ ] A raw event does not count as output under the gateway's no-replay rule, so `includeRaw` leaves every pre-output retry in place: a 529 before any block event is still retried with the option on
- [ ] A failed attempt's raw events reach the caller as the decision in Risks says, and a test covers a retried call with the option on
- [ ] `assertStreamContract()` accepts a stream with `raw` events and still rejects a stream with two terminal events
- [ ] `run()` with `includeRaw: true` emits `raw` events between `model_call_start` and `model_call_end`, and with it off emits none
- [ ] `raw` is in `AGENT_EVENT_TYPES`, and the teardown check passes with and without the option
- [ ] `transformMessages()` and the replay pass never see a raw event
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Gateway: `packages/gateway/test/raw-events.test.ts` for the option, `createModel()` and the contract, plus a raw-event case in each adapter's mock-transport test. SDK: `packages/sdk/test/raw-events.test.ts` with `ScriptedModel`, and a type check in `test/types.test.ts`. Fixtures come from the adapters' existing recorded wire events, so no network is used.

## Docs to update

`packages/gateway/README.md` and `packages/sdk/README.md`: the option, the event and its caveats. [build-sdk.md §3.2](../../plans/build-sdk.md#32-gateway-api) and [§3.3](../../plans/build-sdk.md#33-sdk-api): revision notes. The plan's todo table in [§4.3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses). Changesets for both packages.

## Risks and open questions

- **A spec change.** A new `ModelEvent` member could break a custom adapter or middleware that switches on `type` exhaustively. Opt-in keeps existing streams unchanged, but the todo must decide whether this stays `specificationVersion: "v1"` or needs a note under the versioning rules. The owner decides.
- **Where the option lives.** On `StreamOptions` it reaches every adapter; on the adapter's config it is fixed at construction. Proposed: `StreamOptions`, so one `includeRaw` on `run()` maps to one call.
- **What counts as one raw event.** Both adapters read the same `ServerSentEvent` from `sse.ts`, so the unit is one `ServerSentEvent` (`event` and joined `data`), not one `data:` line. Decide whether the payload is that event as parsed (`{ event, data }`), or its `data` parsed as JSON with OpenAI's non-JSON `[DONE]` carried as the raw string, and say so in the TSDoc. Decide too whether an HTTP error body, which arrives without SSE framing, gets a raw event.
- **Raw events and retries.** A raw event must not count as output, or `includeRaw` would turn off the gateway's pre-output retries. But the retry layer forwards events live, so a failed attempt's raw events (its `message_start`, say) have reached the caller before the retry. Proposed: forward them, and the `retry` event marks them superseded, as it does for warnings; the alternative is to buffer raw events until the first block event. The owner decides.
- **Sensitive content.** A raw event holds the model's output and may hold provider metadata that normalized events drop. The default is off, and the README says to keep it out of logs.
- **Size.** L because it touches both packages and both adapters. If the batch grows, split it into a gateway todo and an SDK todo, with the SDK half depending on the gateway half.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
