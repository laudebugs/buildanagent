# N24: MCP client over stdio: per-server negotiation, canonical names, deferred exposure

| Field | Value |
| --- | --- |
| ID | `N24` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../done/N11-tool-registry.md), [N12](../done/N12-permission-pipeline.md) |
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

- [x] Pin `@modelcontextprotocol/client` and `@modelcontextprotocol/server` at 2.4.0 exactly.
- [x] Run one in-process server per era in the tests and check the probe and fallback; if the client lacks the probe, add it in `src/mcp/` and record the gap in ADR 0021's consequences through P4.

## Acceptance criteria

- [x] A 2026-07-28 server connects with `era: "2026-07-28"` and a legacy server with `era: "legacy"` in the same session
- [x] Their tools appear as deferred, canonically named tools
- [x] A denied MCP call never reaches the server
- [x] A 200 KiB MCP result is capped like any tool result
- [x] No parent environment variable reaches the server process unless declared
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/stdio.test.ts`, `negotiation.test.ts`.

## Docs to update

`packages/harness/README.md`: configuring MCP servers. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The 2.4.0 client may not expose a per-connection era; read it from the negotiated version.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/mcp` now connects MCP servers over stdio and in process, negotiates each server's era on its own, and registers each server's tools as deferred `mcp__<server>__<tool>` tools. `createMcpManager({ servers, registry, mcp?, log? })` connects every server at once and resolves with one status per server. `connectMcpServer(config)` connects one server without registering anything. The exports are those two functions, `McpError` and `McpCallFailure`, and the types `McpServerConfig`, `McpStdioTransport`, `McpInProcessTransport`, `McpChannel`, `McpConnection`, `McpTool`, `McpCallResult`, `McpEra`, `McpManager`, `McpManagerOptions` and `McpServerStatus`. `HarnessErrorCode` gains `invalid_mcp_config`, `mcp_connect_failed`, `mcp_tool_list_refused` and `mcp_call_failed`. The code is in `packages/harness/src/mcp/`, and the tests are `test/mcp/negotiation.test.ts` (11), `test/mcp/stdio.test.ts` (42) and `test/examples/mcp-servers.test.ts` (1).

**Decisions.**

- **The client's own probe negotiates the era.** `@modelcontextprotocol/client` 2.4.0 probes with `server/discover` and falls back to `initialize` when `versionNegotiation` is `{ mode: "auto" }`. Its default mode, `legacy`, sends no probe, so the harness sets `auto`. `getProtocolEra()` gives the era per connection, so the todo's risk did not arise. Writing our own probe in `src/mcp/` was the alternative; it would have duplicated the spec's corrective step for error -32022, which the client already handles. The probe waits 5,000 ms by default, not the client's 60,000 ms, so a legacy server that ignores the probe costs five seconds at connect.
- **The harness spawns each stdio server itself.** The client's `StdioClientTransport` copies six parent variables into the child's environment, which breaks the criterion that no undeclared parent variable reaches a server. `StdioChannel` spawns the child with `spawnEnv(env, setEnv)` and gives the client a transport over its pipes, with its own line framing. Using the client's transport and proving it clean was impossible, since the leak is in its code.
- **A server that exits on the probe is started once more as legacy.** The client probes on a throwaway process only through its own stdio transport, so on ours a server that exits on any request before `initialize` would fail the connect. When the first handshake fails because the server ended the channel, the harness starts it again and connects with `prior: { kind: "legacy" }`. A server that crashes at start therefore runs twice before it is reported as failed.
- **Declared variables come in two lists.** `env` names parent variables under `spawnEnv()`'s rules, so a credential-like name is refused before anything starts. `setEnv` sets values the host supplies, which is how a token reaches a server. The plan's sketch had one `env: string[]`; one list could not carry a token without copying it from the parent.
- **A tool list is registered all or none.** The manager checks the whole list, registers each tool into a scratch registry, and only then registers them for real. A list that fails any check closes the server and registers nothing. Registering the good tools and skipping the bad ones was the alternative; it would leave a server half there, with no way to undo it, because the registry has no `unregister()`.
- **Every MCP tool is treated as a write by code we don't control.** Each definition sets `firstParty: false` and `effect: { kind: "write" }` and drops the server's annotations, so a `readOnlyHint` changes neither scheduling nor whether the loop may re-run a call after a crash. `McpConnection.listTools()` keeps the annotations for display.
- **The MCP code adds no pipeline of its own.** A tool's `execute` is the only path to `callTool()`, and the turn runs `execute` only after the permission gate allows the call. Its result then passes the write cap like any tool result. The tests check this end to end: the server's own call log, and the stored `tool_result` with its spill.
- **A request for user input fails the call.** The client runs with `inputRequired: { autoFulfill: false }`, so an `input_required` result rejects with `UNSUPPORTED_RESULT_TYPE`. The harness maps that to `McpError` with `failure: "input_required"`, and the model reads a fixed sentence. The source-update report's proposal, a signed pause through N13, waits on the owner's decision (question 1 below). The client declares no capabilities, so a 2.4.0 server refuses its own input requests before it sends them.
- **A changed tool list is logged, never applied.** The manager registers a handler for `notifications/tools/list_changed` that only calls `log`. N25 owns the pin and the diff, and re-registering here would have put HD14's revision, tools that change silently, back in place.
- **The Node-only file loads Node at call time.** `mcp/stdio.ts` reads `node:child_process` and `node:fs` through `process.getBuiltinModule()`, as `sandbox/spawn-env.ts` does, so the `./mcp` entry still loads on Cloudflare, where an in-process server works. The gateway's portability scan and Biome's `noRestrictedGlobals` list the file beside its sandbox neighbours. A separate `./mcp/node` entry was the alternative; the plan fixes the export list, and the sandbox entry already follows this pattern.

**Threat model.** A server is untrusted code, and everything it sends is untrusted data.

- *What a hostile server cannot do.* It cannot read a parent variable its config does not declare, or the real `HOME`, which the test proves with a canary. It cannot name a tool that shadows a built-in or another server's tool. Every name starts `mcp__<server>__`, a server name holds no `_`, non-MCP sources can't take the `mcp__` prefix, and the registry hashes a name that needs cleaning. It cannot slip in two names that look alike: names equal after NFKC and lower case are refused, and so are names with control characters. Its annotations change no scheduling. It cannot receive a call the pipeline denied. It cannot flood the harness: a line is capped at 8 MiB, the list at 256 tools, a schema at 64 KiB, a description at 4,096 characters, standard error at 64 KiB kept, and its error messages at 500 characters. A server that hangs meets the connect, probe and request timeouts. One that ignores the close is killed with its whole process group.
- *What it can still do.* It can return any text a tool result may hold, which reaches the model as `untrusted` output. Taint tracking for that output waits on HD16. It can change what a tool does after the harness registered it, since only N25 pins definitions. It can use anything its declared variables and its own process can reach, because a stdio server runs outside the sandbox. A tool's description, cut to 4,096 characters, still reaches the model when tool search activates the tool. It can also give a crafted `outputSchema` that the client compiles with its JSON Schema validator.

**Mutation checks.** Each criterion's test was checked by breaking the code it covers. Twenty mutations ran, and every one but M20 failed its test.

| Mutation | Criterion | Result |
| --- | --- | --- |
| M1 `versionNegotiation` set to `legacy`; M2 era always `legacy` | eras in one session | 9 and 5 tests fail |
| M3 exposure forced to `direct`; M4 source `extension` | deferred, canonical names | fails |
| M5 the gate allows every call | a denied call never reaches the server | fails on the server's log |
| M6 write cap off | 200 KiB result capped | fails |
| M7 `{ ...process.env, ...env }` for the child | no undeclared parent variable | fails |
| M8 `firstParty: true`, no `effect` | annotations ignored | fails |
| M9 `mcp: false` ignored | the switch | fails (marker file written) |
| M10 no NFKC and case fold; M14 registering as the list is read | refused lists, all or none | 2 tests fail; the `remote-ref` test fails |
| M11 no restart after a probe exit | legacy fallback | fails |
| M12 kill the leader only; M13 standard error unbounded | closing, bounded standard error | fails |
| M15 no request timeout; M16 no line cap; M17 no config-time variable check; M18 `input_required` mapped as a server error; M19 a closed channel not marked | lifecycle | each fails |
| M20 no harness connect timer | connect timeout | survives: the client's own `timeout` already bounds the handshake, so the timer is a second guard |

**Named limits.**

- A request for user input fails the call, so a server that needs a confirmation can't finish its tool.
- A server that exits stays down until the harness connects it again; nothing reconnects it.
- A tool-list change is logged, and the registered tools stay as they were.
- If the harness process is killed with `SIGKILL`, its exit handler can't run, and a server that ignores its closed input outlives it.
- A stdio server runs on the host, with the harness's user, outside any sandbox. `spawnEnv()` limits what it inherits, not what it can do.
- The connect retry spawns a server that crashes at start twice.
- Group kills need POSIX process groups. On Windows the harness kills the server only.
- The bounds on lines and standard error apply to stdio. An in-process channel delivers what its host's server sends.
- Only 2026-07-28 counts as a modern era. A server that negotiates a later revision fails to connect until the client knows it.

**Other changes.** `@modelcontextprotocol/client` 2.4.0 moved from a dev to a runtime dependency of the harness, and `@modelcontextprotocol/server` 2.4.0 is a new dev dependency. Both were published on 2026-10-23, are Apache-2.0 and have no install script. They add no package to the lockfile, and `pnpm audit` finds nothing through them; its two advisories were already on `main`. No changeset: the harness is private, and the changeset gate counts only packages that are not. ADR 0021 is accepted, and HD14 is confirmed with a revision that lists how the built API differs from §3.3's sketch.

**Open questions for the owner.**

1. May a server's request for user input pause a turn for a person, through N13's signed pause? Until you decide, the call fails.
2. Should project-supplied MCP configs, such as a `.mcp.json`, load only for trusted projects, as N22's extensions do? N24 takes configs from host code only, and the plan's `trusted` flag is not built.
3. Should a connected server write an `extension_loaded` entry with tier `mcp`, so a session shows which servers ran? The tier exists in the type, and nothing writes it yet.
