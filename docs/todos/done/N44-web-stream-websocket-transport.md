# N44: a WebSocket transport, and Web-stream cases for the stdio transport

| Field | Value |
| --- | --- |
| ID | `N44` |
| Status | `done` |
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

- [x] Run the stdio transport's turn, backpressure and end-of-input cases over a Web stream pair
- [x] Implement the WebSocket transport against a local WebSocket server in tests
- [x] Write the transport cases as reusable helpers, because N45's collection is not built (see the Outcome)

## Acceptance criteria

- [x] The framing check (HD6) passes over the WebSocket transport and over the stdio transport on Web streams
- [x] `pnpm test` passes

## Tests

Framing and reconnect tests over an in-memory WebSocket pair.

## Docs to update

Harness plan §3.5, for the WebSocket transport's signature. §1's non-goal was removed in the plan's 2026-11-18 revision.

## Risks and open questions

Multi-client attach semantics are left to W7.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`webSocketTransport(dispatcher, socket, options?)` serves one client on one WebSocket, one JSON-RPC message per text frame, and the stdio transport now has Web-stream cases for a full turn, backpressure, the end of the input and the write timeout. The code is `packages/harness/src/server/websocket.ts` and the shared `rpc-session.ts`; the exports are `webSocketTransport` and the types `WebSocketLike`, `WebSocketOptions`, `WebSocketMessageEvent` and `WebSocketCloseEvent`. The tests are `websocket-transport.test.ts` (20), `websocket-reconnect.test.ts`, `websocket-framing.test.ts` and `stdio-web-streams.test.ts` (5), over an in-memory socket pair (`memory-websocket.ts`). No dependency was added: the transport takes the standard `WebSocket` interface, so it needs no library and imports no Node module.

**The transport authenticates nobody.** Whoever holds the socket acts as the dispatcher's user, and `Resolution.by` is passed on as the client sent it, as for stdio. A host that exposes the socket checks the caller's identity and origin before it hands the socket over. N53 holds the identity binding.

**Options.** `maxMessageBytes` (8 MiB, the stdio line bound), `maxBufferedBytes` (1 MiB), `writeTimeoutMs` (30,000 ms, checked as stdio's is), `signal` and `log`. A bad option, or a socket that is not open, rejects with `invalid_transport_options` before the transport connects.

**Decisions.**

- **Frames go through the protocol's `JsonlFramer` as one line,** so the `\r`, U+2028 and bad-UTF-8 rules match stdio. A binary, empty, multi-line or batch frame gets `InvalidRequest`, with a `null` id where the id cannot be read; a malformed response is only logged. The alternative, `JSON.parse` on the frame, would have been a second reader.
- **The two transports share `RpcSession`.** The connection, the envelope check, the answers to bad messages, the bound of 128 waiting error answers, the fallback for a message JSON cannot carry and `checkWriteTimeout` moved out of `stdio.ts`, and stdio's behaviour and log lines did not change.
- **Outgoing frames carry no trailing newline.** `@modelcontextprotocol/client` 2.4.0 (as of November 2026) has no WebSocket transport, so the framing check reads each frame with its `deserializeMessage`, and `json-rpc-2.0` reads the same frames. `ReadBuffer` needs a newline, so it is checked only over Web streams.
- **Close codes.** 1009 after answering a frame over the bound, 1008 when the client breaks a bound (128 unread error answers or refusals, the dispatcher closing the connection, or a send buffer that never drains), 1000 when `signal` aborts, and none after the peer closes or errors. The peer's close reason is never logged. The 1009 close is the one place this transport differs from stdio, which keeps the stream open after an oversize line, because a WebSocket peer that sends such a frame has nothing to resync on.
- **Backpressure polls `bufferedAmount` every 25 ms,** one poll for every message that waits, on `globalThis.setTimeout` so fake timers work, cleared when there is room or the transport stops. A socket reports no event when its send buffer empties, so the alternative, an event-based drain, does not exist. A socket without `bufferedAmount` is never taken to be full.
- **`writeTimeoutMs` applies while the socket is open,** unlike stdio's, which applies after the input ends, and it restarts whenever the buffer shrinks. The limit is per wait for room.
- **Reconnect is a new call.** The transport serves one socket; the host serves a new socket with a new call on the same dispatcher, and the client sends `session/open` with `fromSeq`. A test drops the first socket mid-turn and reopens on a second: the missed entries, the live ones and `turn/settled` arrive exactly once and in order.

**Mutation checks.** Twenty mutations each failed their test, among them ignoring `bufferedAmount`, never restarting the timeout, no 1009 close, counting characters instead of bytes (this one survived at first, and the test was fixed), taking only the first line of a frame, reading binary as text, logging the close reason, leaving listeners attached, sending a trailing newline, and the Web writer ignoring backpressure.

**Named limits.**

- The send buffer can pass `maxBufferedBytes` by one frame.
- A type test shows that the global `WebSocket` fits `WebSocketLike`; a Workers or `ws` socket was not checked, so the TSDoc names neither.
- N45's collection is not built, so the transport cases stay in `test/server/` for N45 to import.
- Multi-client attach semantics stay with W7.
