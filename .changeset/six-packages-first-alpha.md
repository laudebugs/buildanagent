---
"@buildanagent/gateway": patch
"@buildanagent/sdk": patch
"@buildanagent/agent-safety": minor
"@buildanagent/protocol": minor
"@buildanagent/harness": minor
"@buildanagent/cli": minor
---

First public alpha of `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety`, which now version and publish with the gateway and the SDK as one group of six at one version. The gateway and the SDK have no change of their own in this version: they move with the group.

The protocol is the JSON-RPC wire between a client and the harness. It gained four additions before this release:

- `session/open` takes `fromSeq`, which replays a session's entries from that sequence number before any live event.
- An `events_dropped` event tells a client that is reading too slowly how many events it missed, so it can reopen with `fromSeq`.
- `$/cancelRequest` withdraws a request.
- `stdioTransport()`, from `@buildanagent/harness/server`, serves one client over a pair of byte streams with one JSON-RPC message per line. The CLI's `buildanagent rpc` command serves the protocol that way over standard input and output.

The session format records which MCP server connected. An `extension_loaded` entry of tier `mcp` now carries an optional `mcp` member, a `McpServerRecord`: the `transport` (`stdio` or `in_process`), the negotiated `era`, a `toolsHash` over the registered tools and, for a stdio server only, a `commandHash`. The `commandHash` is `sha256:` and the hex digest of the canonical JSON of `[command, ...args]`. It is not salted, so a reader of the log can confirm a guessed argument by hashing it; keep secrets out of a server's arguments. The published session-entry JSON Schema sets `additionalProperties: false` on `extension_loaded`, so a validator built from the earlier schema refuses an entry that carries `mcp`, although `formatVersion` stays 1.

The harness gained an MCP client, at `@buildanagent/harness/mcp`:

- `createMcpManager()` connects each configured server on its own and registers its tools as `mcp__<server>__<tool>`, deferred behind tool search.
- `connectMcpServer()` connects one server without registering anything, and its `signal` option aborts the connect and closes the server.
- `McpError` reports a server that could not connect, a tool list the harness refuses, and a tool call that ended with no result, whose `McpCallFailure` says why.
- `killMcpServersOnSignal()` ends every server on `SIGINT`, `SIGTERM` or `SIGHUP`. Signal handling is opt-in, because a listener changes what a signal does to the host.
- `ToolRegistry.registerAll()` registers a list all or none: when any tool is refused, it removes what it added.

`HarnessErrorCode` gained four values for the client: `invalid_mcp_config`, `mcp_connect_failed`, `mcp_tool_list_refused` and `mcp_call_failed`. Two changes guard against a hostile server. The harness strips `pattern`, `patternProperties` and `format` from a server's input schemas, so it never runs a server's regular expression on the model's input, and `tool_search` no longer quotes an untrusted tool's description: it gives the tool's name and source. The harness now depends at runtime on `@modelcontextprotocol/client` 2.4.0.
