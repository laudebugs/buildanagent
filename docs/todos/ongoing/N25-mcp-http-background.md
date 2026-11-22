# N25: MCP streamable HTTP, legacy SSE and background connect

| Field | Value |
| --- | --- |
| ID | `N25` |
| Status | `ongoing` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N24](../done/N24-mcp-stdio.md) |
| Size | M |

## Goal

Add the remote transports and connect servers in the background, waiting at the first prompt only for directly exposed servers, so a slow server never blocks a session.

## Context

- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): streamable HTTP, SSE as legacy, background connect, 10-second wait
- [HD14](../../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional): the decision and its evidence

## Scope

**In scope**

- Streamable HTTP through `McpConnection`, and SSE for legacy-era servers only: HTTP+SSE has been deprecated since 2025-03-26, and the 2026-07-28 revision formally classes it Deprecated ([MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), as of November 2026)
- HTTP servers reached through the egress proxy's allowlist (N20)
- Background connect; the first prompt waits up to 10 seconds only for `direct` servers
- Tool-list changes diffed against a pin, never re-registered silently. Tool definitions are pinned in N22's `extensions.lock.json` format, and this todo owns the MCP entries. A new or changed tool starts disabled, is announced in a `role: "system"` message (HD3's append-only rule) and needs an approval before the model can call it. The `tools` array sent to the model stays as built at session start
- List-change notifications from both eras: `notifications/tools/list_changed` from legacy servers, and the opt-in `subscriptions/listen` stream (`toolsListChanged`) from 2026-07-28 servers, with a dropped stream re-issued

**Out of scope** (and which todo covers it)

- OAuth flows beyond what the client library provides

## Tasks

- [ ] Serve a local HTTP MCP server in tests on 127.0.0.1.
- [ ] Write the pin format for MCP tool definitions on N22's lock file, and the diff that classifies each tool as unchanged, new or changed.
- [ ] Subscribe through `subscriptions/listen` on 2026-07-28 servers, and test a dropped stream with a re-issued request.

## Acceptance criteria

- [ ] A deferred HTTP server that takes 30 s to answer does not delay the first model call
- [ ] A direct server that answers in 2 s is listed in the first request
- [ ] A tool-list change applies at the next turn, never mid-turn
- [ ] A changed or new tool is disabled, announced in a system message and callable only after an approval; an unchanged tool stays enabled
- [ ] A tool-list change never changes the `tools` array sent to the model mid-session (a scripted test inspects every request)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/http.test.ts`, `background.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Remote servers hold their own credentials; the harness passes none unless a credential route names the host.

History: plan review 2 (2026-11-19) replaced the silent re-register on `tools/list_changed` with the diff against a pin (agent connectors report, plan-change item 4), added `subscriptions/listen`, marked SSE legacy-only and tied tool changes to HD3's append-only rule.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
