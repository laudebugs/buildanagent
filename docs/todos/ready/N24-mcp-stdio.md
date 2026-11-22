# N24: MCP client over stdio: per-server negotiation, canonical names, deferred exposure

| Field | Value |
| --- | --- |
| ID | `N24` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../ongoing/N11-tool-registry.md), [N12](N12-permission-pipeline.md) |
| Size | M |

## Goal

Connect MCP servers over stdio as a removable built-in: negotiate the protocol era per server, register their tools under canonical names with deferred exposure, and send every call and result through the pipeline and the write cap.

## Context

- [HD14](../../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional): the decision and its evidence
- [ADR 0021](../../decisions/0021-mcp-client-base.md): the decision records
- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): per-server eras, deferred by default, annotations untrusted

## Scope

**In scope**

- `McpConnection` over `@modelcontextprotocol/client` 2.4.0, stdio transport
- Per-server negotiation: probe `server/discover`, fall back to `initialize`; record `era`
- `mcp__<server>__<tool>` names through the registry; exposure `deferred` by default
- Server processes spawned with `spawnEnv` plus each server's declared variables
- `readOnlyHint` and other annotations ignored for scheduling (not first-party)
- An `mcp: false` switch that registers nothing

**Out of scope** (and which todo covers it)

- Streamable HTTP, SSE and background connect (N25)

## Tasks

- [ ] Pin `@modelcontextprotocol/client` and `@modelcontextprotocol/server` at 2.4.0 exactly.
- [ ] Run one in-process server per era in the tests and check the probe and fallback; if the client lacks the probe, add it in `src/mcp/` and record the gap in ADR 0021's consequences through P4.

## Acceptance criteria

- [ ] A 2026-07-28 server connects with `era: "2026-07-28"` and a legacy server with `era: "legacy"` in the same session
- [ ] Their tools appear as deferred, canonically named tools
- [ ] A denied MCP call never reaches the server
- [ ] A 200 KiB MCP result is capped like any tool result
- [ ] No parent environment variable reaches the server process unless declared
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/stdio.test.ts`, `negotiation.test.ts`.

## Docs to update

`packages/harness/README.md`: configuring MCP servers. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The 2.4.0 client may not expose a per-connection era; read it from the negotiated version.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
