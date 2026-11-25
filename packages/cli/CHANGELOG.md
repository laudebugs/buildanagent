# @buildanagent/cli

## 0.1.0-alpha.35

### Patch Changes

- Updated dependencies [c25b00d]
  - @buildanagent/harness@0.1.0-alpha.35
  - @buildanagent/gateway@0.1.0-alpha.35
  - @buildanagent/protocol@0.1.0-alpha.35
  - @buildanagent/sdk@0.1.0-alpha.35

## 0.1.0-alpha.34

### Patch Changes

- @buildanagent/harness@0.1.0-alpha.34
  - @buildanagent/sdk@0.1.0-alpha.34
  - @buildanagent/gateway@0.1.0-alpha.34
  - @buildanagent/protocol@0.1.0-alpha.34

## 0.1.0-alpha.33

### Patch Changes

- Updated dependencies [eea1862]
  - @buildanagent/harness@0.1.0-alpha.33
  - @buildanagent/gateway@0.1.0-alpha.33
  - @buildanagent/protocol@0.1.0-alpha.33
  - @buildanagent/sdk@0.1.0-alpha.33

## 0.1.0-alpha.32

### Patch Changes

- Updated dependencies [ec8a6e0]
- Updated dependencies [ec8a6e0]
  - @buildanagent/sdk@0.1.0-alpha.32
  - @buildanagent/harness@0.1.0-alpha.32
  - @buildanagent/protocol@0.1.0-alpha.32
  - @buildanagent/gateway@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- Updated dependencies [06f0cc5]
  - @buildanagent/harness@0.1.0-alpha.31
  - @buildanagent/protocol@0.1.0-alpha.31
  - @buildanagent/gateway@0.1.0-alpha.31
  - @buildanagent/sdk@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies [29c4cec]
  - @buildanagent/harness@0.1.0-alpha.30
  - @buildanagent/gateway@0.1.0-alpha.30
  - @buildanagent/protocol@0.1.0-alpha.30
  - @buildanagent/sdk@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- Updated dependencies [836f8d0]
  - @buildanagent/harness@0.1.0-alpha.29
  - @buildanagent/gateway@0.1.0-alpha.29
  - @buildanagent/protocol@0.1.0-alpha.29
  - @buildanagent/sdk@0.1.0-alpha.29

## 0.1.0-alpha.28

### Minor Changes

- 7d87f8f: First public alpha of `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety`, which now version and publish with the gateway and the SDK as one group of six at one version. The gateway and the SDK have no change of their own in this version: they move with the group.
  
  The protocol is the JSON-RPC wire between a client and the harness. It gained four additions before this release:
  
  - `session/open` takes `fromSeq`, which replays a session's entries from that sequence number before any live event.
  - An `events_dropped` event tells a client that is reading too slowly how many events it missed, so it can reopen with `fromSeq`.
  - `$/cancelRequest` withdraws a request.
  - `stdioTransport()`, from `@buildanagent/harness/server`, serves one client over a pair of byte streams with one JSON-RPC message per line. The CLI's `buildanagent rpc` command serves the protocol that way over standard input and output.
  
  The session format records which MCP server connected. An `extension_loaded` entry of tier `mcp` now carries an optional `mcp` member, a `McpServerRecord`: the `transport` (`stdio` or `in_process`), the negotiated `era` (`2026-07-28` or `legacy`), a `toolsHash` and, for a stdio server only, a `commandHash`. The `toolsHash` is `sha256:` and the hex digest of the canonical JSON of the tool list the server sent, sorted by name, each tool as its name, description and input schema, before the harness strips regular-expression keywords from the schemas. The `commandHash` is `sha256:` and the hex digest of the canonical JSON of `[command, ...args]`. The hash is not salted, so a reader of the log can confirm a guessed argument by hashing it. Keep secrets out of a server's arguments.
  
  A validator built from the earlier session-entry JSON Schema refuses an entry that carries `mcp`, because that schema sets `additionalProperties: false` on `extension_loaded`. `formatVersion` stays 1, so rebuild the validator from the published schema.
  
  The harness gained an MCP client, at `@buildanagent/harness/mcp`:
  
  - `createMcpManager()` connects each configured server on its own and registers its tools as `mcp__<server>__<tool>`, deferred behind tool search.
  - `connectMcpServer()` connects one server without registering anything, and its `signal` option aborts the connect and closes the server.
  - `McpError` reports a server that could not connect, a tool list the harness refuses, and a tool call that ended with no result; for the last, its `failure` member (an `McpCallFailure`) says why: `closed`, `timeout`, `aborted`, `input_required` or `server_error`.
  - `killMcpServersOnSignal()` ends every server on `SIGINT`, `SIGTERM` or `SIGHUP`. Signal handling is opt-in, because a listener changes what a signal does to the host.
  
  `ToolRegistry.registerAll()`, at `@buildanagent/harness/tools`, registers a list all or none: when any tool is refused, it removes what it added.
  
  `HarnessErrorCode`, exported from `@buildanagent/harness`, gained four values for the client: `invalid_mcp_config`, `mcp_connect_failed`, `mcp_tool_list_refused` and `mcp_call_failed`. The harness strips `pattern`, `patternProperties` and `format` from a server's input schemas, so it never runs a server's regular expression on the model's input, and `tool_search` no longer quotes an untrusted tool's description: it gives the tool's name and source. The harness now depends at runtime on `@modelcontextprotocol/client` 2.4.0.

### Patch Changes

- Updated dependencies [7d87f8f]
  - @buildanagent/gateway@0.1.0-alpha.28
  - @buildanagent/sdk@0.1.0-alpha.28
  - @buildanagent/protocol@0.1.0-alpha.28
  - @buildanagent/harness@0.1.0-alpha.28
