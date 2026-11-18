# W7: CLI attach over WebSocket

| Field | Value |
| --- | --- |
| ID | `W7` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [N44](N44-web-stream-websocket-transport.md), [W5](W5-control-plane-ingress.md) |
| Size | M |

## Goal

Let the owner watch and steer a running task from the CLI over N44's WebSocket transport, and answer signed pauses there.

## Context

- [Harness plan, HD6](../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods): the protocol the CLI speaks.

## Scope

**In scope**

- `coding-agent attach <task>`
- Answering an approval from the CLI

**Out of scope**

- A web UI

## Tasks

- [ ] Connect the harness CLI to the Worker over WebSocket
- [ ] Authenticate the owner with a token held by the CLI

## Acceptance criteria

- [ ] Attach, detach and re-attach mid-task without losing events

## Tests

Offline tests over an in-memory WebSocket pair.

## Docs to update

CLI help text.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
