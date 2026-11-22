# N44: a WebSocket transport, and Web-stream cases for the stdio transport

| Field | Value |
| --- | --- |
| ID | `N44` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N29](../done/N29-stdio-transport.md) |
| Size | M |

## Goal

Add a WebSocket transport, and test the stdio transport over Web streams, so Workers and the coding agent's CLI can attach (U11 change 7). [N29](../done/N29-stdio-transport.md) already types `stdioTransport()` over Node and Web streams by their shape, with no Node import, so no retype or Node adapter is left.

## Context

- [Portable agents report](../../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places): why Node streams tie the transport to one host.
- [Harness plan §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the transport API.

## Scope

**In scope**

- Web-stream cases for `stdioTransport()`: a full turn, backpressure and the end of the input over a `ReadableStream` and `WritableStream` pair
- `webSocketTransport()` with reconnect and the bounded queues of N28

**Out of scope**

- Durable Object hibernation wiring (N46a)

## Tasks

- [ ] Run the stdio transport's turn, backpressure and end-of-input cases over a Web stream pair
- [ ] Implement the WebSocket transport against a local WebSocket server in tests
- [ ] Add transport cases to N45's collection

## Acceptance criteria

- [ ] The framing check (HD6) passes over the WebSocket transport and over the stdio transport on Web streams
- [ ] `pnpm test` passes

## Tests

Framing and reconnect tests over an in-memory WebSocket pair.

## Docs to update

Harness plan §3.5, for the WebSocket transport's signature. §1's non-goal was removed in the plan's 2026-11-18 revision.

## Risks and open questions

Multi-client attach semantics are left to W7.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
