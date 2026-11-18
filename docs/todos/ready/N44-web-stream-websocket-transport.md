# N44: stdio over Web streams and a WebSocket transport

| Field | Value |
| --- | --- |
| ID | `N44` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N29](N29-stdio-transport.md) |
| Size | M |

## Goal

Type the protocol transport over Web `ReadableStream` and `WritableStream`, and add a WebSocket transport, so Workers and the coding agent's CLI can attach (U11 change 7).

## Context

- [Portable agents report](../../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places): why Node streams tie the transport to one host.
- [Harness plan §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the transport API.

## Scope

**In scope**

- `stdioTransport` typed over Web streams, with a Node adapter
- `webSocketTransport()` with reconnect and the bounded queues of N28

**Out of scope**

- Durable Object hibernation wiring (N46a)

## Tasks

- [ ] Retype the transport interface
- [ ] Add the Node adapter
- [ ] Implement the WebSocket transport against a local WebSocket server in tests
- [ ] Add transport cases to N45's collection

## Acceptance criteria

- [ ] The stdio framing check (HD6) passes over both transports
- [ ] `pnpm test` passes

## Tests

Framing and reconnect tests over an in-memory WebSocket pair.

## Docs to update

Harness plan §1 (non-goal removed) and §3.5.

## Risks and open questions

Multi-client attach semantics are left to W7.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
