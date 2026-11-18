# 0021. Build the MCP client on `@modelcontextprotocol/client` 2.4.0, behind our own `McpConnection` interface

- **Status:** Proposed (provisional until todo N24)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD14](../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional)

## Context

The MCP client must negotiate the 2026-07-28 revision or the legacy era per server. The 2.4.0 client's types include the `server/discover` probe, the package is Apache-2.0 and already in our lockfile, and its server sibling gives tests a real peer; `@ai-sdk/mcp` would pull in `ai`, and our own client would mean writing every transport.

## Decision

The harness's MCP module wraps `@modelcontextprotocol/client` 2.4.0 in `McpConnection`, and the registry sees only that interface. `@modelcontextprotocol/server` 2.4.0 is a dev dependency for the conformance tests.

## Consequences

- Todo N24 checks the per-server probe and fallback; if the client lacks it, N24 adds the probe on our side and records the gap.
- Changing the base later touches only `src/mcp/`.
