# 0016. Frame the harness protocol as strict JSON-RPC 2.0, with the `jsonrpc` field and twelve v1 client methods

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD6](../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods)

## Context

Harness decision 6 asks whether to keep the `jsonrpc` field that Codex drops, and which methods ship in v1. JSON-RPC 2.0 requires the field, and MCP messages are JSON-RPC 2.0 messages, so generic clients and MCP-style libraries need it.

## Decision

Every message carries `"jsonrpc": "2.0"`. Version 1 ships `initialize`, `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt`, `approval/list`, the experimental `session/checkout` and `session/fork`, and the `$/cancelRequest` notification. The server sends `approval/request`, `clarification/request` and `tool/call` requests, `event` notifications with a sequence number, and one `turn/settled` per turn. Framing splits on `\n` only, never with Node `readline`.

## Consequences

- Todo N29 still wraps the stdio transport with a generic JSON-RPC client and `@modelcontextprotocol/client`'s JSON-RPC layer as the guide's settling test.
- New methods ship behind the `experimental` gate first.
