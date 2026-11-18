# N29: stdio transport and the framing check (HD6)

| Field | Value |
| --- | --- |
| ID | `N29` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-protocol-and-interfaces) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N28](N28-server-requests-backpressure.md) |
| Size | S |

## Goal

Serve the dispatcher over JSONL on stdio as `agent-speak rpc`, and run the guide's settling test for the framing with a generic JSON-RPC client and an MCP-style library.

## Context

- [HD6](../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods): the decision and its evidence
- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): stdio JSONL first; no `readline`

## Scope

**In scope**

- `stdioTransport(dispatcher, io)`
- A test client in a child process speaking JSONL
- The framing check with one generic JSON-RPC 2.0 client library and `@modelcontextprotocol/client`'s JSON-RPC layer

**Out of scope** (and which todo covers it)

- CLI subcommands (N30)

## Tasks

- [ ] Choose the generic client library at least a week old, as a dev dependency only.
- [ ] Spawn the server child with `spawnEnv`.

## Acceptance criteria

- [ ] A child-process client completes `initialize`, `turn/start`, receives events and `turn/settled`
- [ ] Both libraries parse every server message without adapters
- [ ] stdout carries only protocol lines; logs go to stderr
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/stdio.test.ts`, `framing-interop.test.ts`.

## Docs to update

`packages/protocol/README.md`: the stdio transport. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If a library needs a framing quirk, record it; do not change the protocol for it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
