# 0021. Build the MCP client on `@modelcontextprotocol/client` 2.4.0, behind our own `McpConnection` interface

- **Status:** Accepted (todo N24 confirmed the base on 2026-11-22)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD14](../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional)

## Context

The MCP client must negotiate the 2026-07-28 revision or the legacy era per server. The 2.4.0 client's types include the `server/discover` probe, the package is Apache-2.0 and already in our lockfile, and its server sibling gives tests a real peer; `@ai-sdk/mcp` would pull in `ai`, and our own client would mean writing every transport.

## Decision

The harness's MCP module wraps `@modelcontextprotocol/client` 2.4.0 in `McpConnection`, and the registry sees only that interface. `@modelcontextprotocol/server` 2.4.0 is a dev dependency for the conformance tests.

## Consequences

- Todo N24 checks the per-server probe and fallback; if the client lacks it, N24 adds the probe on our side and records the gap.
- Changing the base later touches only `src/mcp/`.
- N24 found the probe in the client, so the harness adds none. The 2.4.0 client probes with `server/discover` and falls back to `initialize` once `versionNegotiation` is `{ mode: "auto" }`; its default, `legacy`, sends no probe at all. It reports the era per connection through `getProtocolEra()`, so `McpConnection.era` needs no guess from the version string ([N24](../todos/done/N24-mcp-stdio.md#outcome); [fact-check, rows N24-4 and N24-5](../plans/reviews/fact-check-build-harness.md#n24-the-mcp-client-over-stdio-branch-todon24-mcp-stdio)).
- N24 found two gaps, and the harness closes both in `src/mcp/`. First, the client's stdio transport copies six parent variables into the server's environment, so the harness spawns each server itself and hands the client a transport over the child's pipes. Second, the client probes on a throwaway process only through its own stdio transport, so a server that exits on the probe fails the connect; when such a server exits cleanly, the harness starts it once more as a legacy server, within the same connect timeout ([fact-check, rows N24-7 and N24-8](../plans/reviews/fact-check-build-harness.md#n24-the-mcp-client-over-stdio-branch-todon24-mcp-stdio)).
