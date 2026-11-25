# @buildanagent/harness

## 0.1.0-alpha.37

### Minor Changes

- 6fcd051: Add `@buildanagent/harness/vercel` and `@buildanagent/harness/vercel/workflow`. `postgresStore()` and `postgresLock()` keep the session log and its writer lock in Postgres. `workflowScheduler()` turns each wake into a Vercel Workflow run that delivers in one step, and `envKeyStore()` reads the approval key ring from a secret environment variable. The entries take the Postgres client and the Workflow SDK's functions as arguments and import neither.

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.37
  - @buildanagent/gateway@0.1.0-alpha.37
  - @buildanagent/protocol@0.1.0-alpha.37
  - @buildanagent/sdk@0.1.0-alpha.37

## 0.1.0-alpha.36

### Minor Changes

- 0aa9bda: Export the eight-seam portability conformance suite from `@buildanagent/harness/testing` (`PORTABILITY_SEAMS`, `portabilityConformanceCases()`, `runPortabilityConformance()`). This release also exports standalone suites for locks (`lockConformanceCases()`, `runLockConformance()`), egress (`EGRESS_DENIED_TARGETS`, `egressConformanceCases()`, `runEgressConformance()`), and protocol transports (`transportConformanceCases()`, `runTransportConformance()`).

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.36
  - @buildanagent/gateway@0.1.0-alpha.36
  - @buildanagent/protocol@0.1.0-alpha.36
  - @buildanagent/sdk@0.1.0-alpha.36

## 0.1.0-alpha.35

### Minor Changes

- c25b00d: Add `@buildanagent/harness/ablation` (`AblationConfig`, `DEFAULT_ABLATION`, `defaultAblation()`, `validateAblation()`, `ablationHash()`, `credentialEnvOf()`) and wire `HarnessOptions.ablation` into `createHarness()` and `runTurn()` so every removable component can be switched off and its configuration hash stamped into `session_header.ablationHash`.

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.35
  - @buildanagent/gateway@0.1.0-alpha.35
  - @buildanagent/protocol@0.1.0-alpha.35
  - @buildanagent/sdk@0.1.0-alpha.35

## 0.1.0-alpha.34

### Patch Changes

- Updated dependencies [be43a99]
  - @buildanagent/agent-safety@0.1.0-alpha.34
  - @buildanagent/sdk@0.1.0-alpha.34
  - @buildanagent/gateway@0.1.0-alpha.34
  - @buildanagent/protocol@0.1.0-alpha.34

## 0.1.0-alpha.33

### Minor Changes

- eea1862: Add long-term memory to the harness as a removable extension.
  
  - `memoryExtension()` from the new `@buildanagent/harness/memory` entry adds a `memory` tool (`view`, `create`, `str_replace`, `delete`, `rename`) over `.agents/memory/` only. Each record is one sourced Markdown file, and the index at the start of each run's first request stops at 200 lines or 25 KiB.
  - Records expire from an injected clock. A write after untrusted tool output is stored as low trust, and no write raises a record's trust.
  - The extension denies the built-in `write` and `edit` tools inside the folder.
  - `fileMemoryFiles()` from `@buildanagent/harness/memory/node` keeps the folder on disk and follows no links.
  - A delete adds the calls that held the record to a purge list, which a mark matches by run where the log shows one.
  - `purgeSession()` from `@buildanagent/harness/session` rewrites a session with those calls' content removed, keeps each entry's base fields, and returns the `spills` and `residual` entries the caller should handle.
  - `pruneSessions({ marks })` takes the purge list, and its result adds `purgedMarks` and `markedArchives`.
  - `clearPurgeMarks()` takes an `unmatched` option: marks no session held leave the list once they are 30 days old.

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.33
  - @buildanagent/gateway@0.1.0-alpha.33
  - @buildanagent/protocol@0.1.0-alpha.33
  - @buildanagent/sdk@0.1.0-alpha.33

## 0.1.0-alpha.32

### Minor Changes

- ec8a6e0: Add @buildanagent/harness/telemetry: projectSpans() rebuilds OpenTelemetry spans from a session log, with content off by default, and createBudgetMeter() warns once at 80% of a session cap

### Patch Changes

- Updated dependencies [ec8a6e0]
  - @buildanagent/sdk@0.1.0-alpha.32
  - @buildanagent/protocol@0.1.0-alpha.32
  - @buildanagent/agent-safety@0.1.0-alpha.32
  - @buildanagent/gateway@0.1.0-alpha.32

## 0.1.0-alpha.31

### Minor Changes

- 06f0cc5: Add remote MCP servers, background connect and tool pins. A server config takes `transport: { kind: "http", url, headers?, proxy?, allowAddresses?, unsafeAllowLoopback?, resolve?, ... }` for streamable HTTP, typed `McpRemoteSettings` and with the bounds the README lists, or `kind: "sse"` for a legacy HTTP+SSE server. Every request is HTTPS to a checked public address, follows no redirect and is bounded in bytes and time. `createMcpManager()` gains `start()`, `beginTurn()`, `statuses()`, `pending()`, `approve()` and `permissionHook()`, and the options `pins`, `directWaitMs`, `relistIntervalMs` and `timers`. `HarnessOptions` gains `turnBoundaries`, which a turn runs before it builds its tools. A tool whose definition has no matching pin starts disabled until a person approves it, and a changed tool list applies at the next turn. `memoryMcpPinStore()` keeps the pins in memory, and `fileMcpPinStore()`, `readMcpPins()` and `writeMcpPins()` from `@buildanagent/harness/extensions/node` keep them in `extensions.lock.json`. The new types are `McpPinStore`, `McpPendingTool`, `McpEgressFetch` and `McpTimers`. `McpCallFailure` gains `disabled`, and the protocol's `McpServerRecord` gains the `http` and `sse` transports and `urlHash`. `TurnBoundary` gives a component `commitNotices()`, called once a turn has written its notices. The egress proxy's `fetch()` now rejects an upstream status outside 200 to 599 with `egress_denied`, where it used to throw inside a socket handler. The proxy's log records a refused status with the reason `bad_status`.

### Patch Changes

- Updated dependencies [06f0cc5]
  - @buildanagent/protocol@0.1.0-alpha.31
  - @buildanagent/agent-safety@0.1.0-alpha.31
  - @buildanagent/gateway@0.1.0-alpha.31
  - @buildanagent/sdk@0.1.0-alpha.31

## 0.1.0-alpha.30

### Minor Changes

- 29c4cec: Add `escalation()` to `@buildanagent/harness/sandbox`: the host's state machine for a denied command. Under `never` a denial goes back to the model; under `on-request` and `granular` it becomes a signed approval request, and an approval reruns the command once with the policy widened by exactly the denied target. The machine's states and legal edges are exported as data (`ESCALATION_STATES`, `ESCALATION_TRANSITIONS`), a classifier's allow never approves a rerun, and the host alone widens the policy.

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.30
  - @buildanagent/gateway@0.1.0-alpha.30
  - @buildanagent/protocol@0.1.0-alpha.30
  - @buildanagent/sdk@0.1.0-alpha.30

## 0.1.0-alpha.29

### Minor Changes

- 836f8d0: Add the built-in tools. `builtinTools(sandbox, proxy, { root, policy, env?, spills? })` from `@buildanagent/harness/tools` returns `read`, `write`, `edit`, `bash`, `grep`, `glob` and, when a proxy is given, `fetch`. Every path is checked against the sandbox policy's roots before a sandbox call, `bash` and the search tools run only inside the sandbox, and `fetch` goes only through the egress proxy and scrubs known secrets from what it returns. `read` pages long files and long lines and can open the full text of a cut result by its spill path. `ExecResult` gains an optional `timedOut` flag that every sandbox backend sets when it stops a command for time, and `fakeSandbox()` understands `find`, `grep` and `bash -c`. `memorySpillStore()` now returns absolute paths, and `fileSpillStore()` gains `read(key, path)`.

### Patch Changes

- @buildanagent/agent-safety@0.1.0-alpha.29
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
  - @buildanagent/agent-safety@0.1.0-alpha.28
  - @buildanagent/protocol@0.1.0-alpha.28
