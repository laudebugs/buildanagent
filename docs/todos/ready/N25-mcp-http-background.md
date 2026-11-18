# N25: MCP streamable HTTP, legacy SSE and background connect

| Field | Value |
| --- | --- |
| ID | `N25` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-extensions-and-mcp) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N24](N24-mcp-stdio.md) |
| Size | M |

## Goal

Add the remote transports and connect servers in the background, waiting at the first prompt only for directly exposed servers, so a slow server never blocks a session.

## Context

- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): streamable HTTP, SSE as legacy, background connect, 10-second wait
- [HD14](../../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional): the decision and its evidence

## Scope

**In scope**

- Streamable HTTP and legacy SSE through `McpConnection`
- HTTP servers reached through the egress proxy's allowlist (N20)
- Background connect; the first prompt waits up to 10 seconds only for `direct` servers
- `tools/list_changed` notifications re-registering tools at the next turn boundary

**Out of scope** (and which todo covers it)

- OAuth flows beyond what the client library provides

## Tasks

- [ ] Serve a local HTTP MCP server in tests on 127.0.0.1.

## Acceptance criteria

- [ ] A deferred HTTP server that takes 30 s to answer does not delay the first model call
- [ ] A direct server that answers in 2 s is listed in the first request
- [ ] A tool-list change applies at the next turn, never mid-turn
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/http.test.ts`, `background.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Remote servers hold their own credentials; the harness passes none unless a credential route names the host.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
