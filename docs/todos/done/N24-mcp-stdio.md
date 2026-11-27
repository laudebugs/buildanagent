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
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness/mcp` now connects MCP servers over stdio and in process, negotiates each server's era on its own, and registers each server's tools as deferred `mcp__<server>__<tool>` tools. `createMcpManager({ servers, registry, mcp?, log? })` connects every server at once and resolves with one status per server. `connectMcpServer(config)` connects one server without registering anything. The exports are those two functions, `killMcpServersOnSignal()`, `McpError` and `McpCallFailure`, and the types `McpServerConfig`, `McpStdioTransport`, `McpInProcessTransport`, `McpChannel`, `McpConnection`, `McpTool`, `McpCallResult`, `McpEra`, `McpManager`, `McpManagerOptions` and `McpServerStatus`. `HarnessErrorCode` gains `invalid_mcp_config`, `mcp_connect_failed`, `mcp_tool_list_refused` and `mcp_call_failed`. The code is in `packages/harness/src/mcp/`. The MCP tests are `test/mcp/negotiation.test.ts` (11), `test/mcp/stdio.test.ts` (42), `test/mcp/hardening.test.ts` (31, from the code reviews, the first review's self-audit and the security pass), and `test/mcp/record.test.ts` (6); the others are `test/tools/tool-search-untrusted.test.ts` (5), `test/tools/register-all.test.ts` (2) and `test/examples/mcp-servers.test.ts` (1). The registry gains `registerAll()`.

**Decisions.**

- **The client's own probe negotiates the era.** `@modelcontextprotocol/client` 2.4.0 probes with `server/discover` and falls back to `initialize` when `versionNegotiation` is `{ mode: "auto" }`. Its default mode, `legacy`, sends no probe, so the harness sets `auto`. `getProtocolEra()` gives the era per connection, so the todo's risk did not arise. Writing our own probe in `src/mcp/` was the alternative; it would have duplicated the spec's corrective step for error -32022, which the client already handles. The probe waits 5,000 ms by default, not the client's 60,000 ms, so a legacy server that ignores the probe costs five seconds at connect.
- **The harness spawns each stdio server itself.** The client's `StdioClientTransport` copies six parent variables into the child's environment, which breaks the criterion that no undeclared parent variable reaches a server. `StdioChannel` spawns the child with `spawnEnv(env, setEnv)` and gives the client a transport over its pipes, with its own line framing. Using the client's transport and proving it clean was impossible, since the leak is in its code.
- **A server that exits on the probe is started once more as legacy.** The client probes on a throwaway process only through its own stdio transport, so on ours a server that exits on any request before `initialize` would fail the connect. When the first handshake fails because the server exited with code 0 after the client sent the probe, the harness starts it again and connects with `prior: { kind: "legacy" }`, within what is left of one `connectTimeoutMs`. A crash, an exit with any other code or a signal, runs once. The channel can't observe that the server read the probe, so the exit code is the evidence, and a server that exits non-zero on the probe fails to connect. The first version restarted after any exit, which ran a crashing server twice.
- **Declared variables come in two lists.** `env` names parent variables under `spawnEnv()`'s rules, so a credential-like name is refused before anything starts. `setEnv` sets values the host supplies, which is how a token reaches a server. The plan's sketch had one `env: string[]`; one list could not carry a token without copying it from the parent.
- **A tool list is registered all or none.** The manager checks the whole list, builds every definition, checks that the registry holds no tool of the source, and calls the registry's new `registerAll()` with no await between the check and the call. `registerAll()` puts the registry's entries back when any registration throws. A list that fails any check closes the server and registers nothing. The first version rehearsed in an empty scratch registry, which missed a clash with a tool already registered, and checked the source before an await. Registering the good tools and skipping the bad ones was the alternative; it would leave a server half there.
- **Every MCP tool is treated as a write by code we don't control.** Each definition sets `firstParty: false` and `effect: { kind: "write" }` and drops the server's annotations, so a `readOnlyHint` changes neither scheduling nor whether the loop may re-run a call after a crash. `McpConnection.listTools()` keeps the annotations for display.
- **The MCP code adds no pipeline of its own.** A tool's `execute` is the only path to `callTool()`, and the turn runs `execute` only after the permission gate allows the call. Its result then passes the write cap like any tool result. The tests check this end to end: the server's own call log, and the stored `tool_result` with its spill.
- **A request for user input fails the call.** The client runs with `inputRequired: { autoFulfill: false }`, so an `input_required` result rejects with `UNSUPPORTED_RESULT_TYPE`. The harness maps that to `McpError` with `failure: "input_required"`, and the model reads a fixed sentence. The source-update report's proposal, a signed pause through N13, waits on the owner's decision (question 1 below). The client declares no capabilities, so a 2.4.0 server refuses its own input requests before it sends them.
- **A server's output schema is never compiled.** The client validates a tool's structured content against the output schema in its cached tool list, which runs the server's patterns. The harness reads only `content`, so it gives the client a validator that accepts everything. A test with the pattern `^(a+)+$` hangs without it.
- **A server's input schema runs no regular expression.** The SDK checks a call's input against its schema before the permission gate, and pi-schema runs a schema's `pattern` on V8's backtracking engine: `^(a+)+$` with 29 `a`s and a `!` blocked the event loop for about 31 s before any permission decision was written. `safeSchema()` removes `pattern`, `patternProperties` and `format` from every subschema, walking only the keywords that hold subschemas, so a property named `pattern` stays, and refuses a schema nested deeper than 64 levels. The model reads the schema without those keywords, and the server still checks its own input. A linear-time engine and validating after the gate were the alternatives; the first would mean replacing the SDK's compiler, and the second changes the SDK's order for every tool. The registry rebuilds each definition per turn, so a schema compiles once per turn, which a schema without patterns makes cheap.
- **The tool list is read a page at a time.** The client's `listTools()` gathers every page before anything counts them; eight pages of 100,000 tools reached 560 MiB. The harness asks for each page itself and stops at the page that passes `maxTools`, or after eight pages.
- **Tool search treats an MCP description as untrusted.** Its result, which the log stores as trusted, names an untrusted tool and never quotes its description. It scores such a tool on its name, counts its description as one matched word at most, and gives one untrusted source at most half the results, so a stuffed description can't crowd out other tools.
- **Server text is cut on whole characters.** `cut()` backs off one unit rather than split a surrogate pair, because a lone half makes the canonical JSON behind the record refuse the text, and the server's whole list with it.
- **A signal ends the servers only if the host opts in.** Each server runs in its own process group, so the terminal's `SIGINT` never reaches it, and Node emits no `exit` event when a signal's default action ends the process. The harness adds no signal listener by default, because a library's listener changes what a signal does to its host. A host whose process those signals end calls `killMcpServersOnSignal()`: on the first `SIGINT`, `SIGTERM` or `SIGHUP` it kills every group, removes its own listeners and raises the signal again, so the process behaves as it would have without them, and a `signal-exit`-style listener, which re-raises only when it is alone, sees itself alone. Two earlier versions installed listeners by default. The first left the servers alone whenever the host had any listener. The second re-raised only when its listener was alone, so with `signal-exit` installed the host ignored `SIGTERM`, and the first Ctrl-C of a host that cancels turns ended every server (security pass).
- **A server's exit waits for the rest of its output.** Node does not promise that a child's output has been read when it exits, so the channel keeps reading until standard output ends, for at most `closeGraceMs`. The first version closed at the exit and lost output that came after it.
- **A close aborts handshakes.** `manager.close()` aborts every connect still running and closes every open connection, so a server that hangs can't hold up shutdown.
- **A changed tool list is logged, never applied.** The manager registers a handler for `notifications/tools/list_changed` that only calls `log`. N25 owns the pin and the diff, and re-registering here would have put HD14's revision, tools that change silently, back in place.
- **The Node-only file loads Node at call time.** `mcp/stdio.ts` reads `node:child_process` and `node:fs` through `process.getBuiltinModule()`, as `sandbox/spawn-env.ts` does, so the `./mcp` entry still loads on Cloudflare, where an in-process server works. The gateway's portability scan and Biome's `noRestrictedGlobals` list the file beside its sandbox neighbours. A separate `./mcp/node` entry was the alternative; the plan fixes the export list, and the sandbox entry already follows this pattern.

**Threat model.** A server is untrusted code, and everything it sends is untrusted data.

- *What a hostile server cannot do.* It cannot read a parent variable its config does not declare, or the real `HOME`, which the test proves with a canary. It cannot name a tool that shadows a built-in or another server's tool. Every name starts `mcp__<server>__`, a server name holds no `_`, non-MCP sources can't take the `mcp__` prefix, and the registry hashes a name that needs cleaning. It cannot slip in two names that look alike: names equal after NFKC and lower case are refused, and so are names with control characters. Its annotations change no scheduling. Its input schema can't freeze the harness, since no pattern of its runs. It cannot receive a call the pipeline denied. It cannot flood the harness: a line is capped at 8 MiB, the list at 256 tools, a schema at 64 KiB, a description at 4,096 characters, standard error at 64 KiB kept, and its error messages at 500 characters. A server that hangs meets the connect, probe and request timeouts. One that ignores the close is killed with its whole process group.
- *What it can still do.* It can return any text a tool result may hold, which reaches the model as `untrusted` output. Taint tracking for that output waits on HD16. It can change what a tool does after the harness registered it, since only N25 pins definitions. It can use anything its declared variables and its own process can reach, because a stdio server runs outside the sandbox. A tool's description, cut to 4,096 characters, still reaches the model when tool search activates the tool. Its output schema is never compiled. It can send requests to the client: a legacy client answers sampling, roots and elicitation with -32601 and answers `ping`, and a 2026-07-28 client drops them. Keys such as `__proto__` in its JSON become plain properties and pollute nothing. It can claim the legacy era to avoid the 2026-07-28 rules, which costs the harness nothing, since no check depends on the era.

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

The first code review's fixes have their own mutations, and each fails its test:

| Mutation | Fix | Result |
| --- | --- | --- |
| R1 close at the exit, without waiting for output | output after the exit is delivered | fails |
| R2 no signal listeners; R2b kill even when the host listens | servers end with a signalled host, and a host with its own listener keeps control | both fail |
| R3 register one by one; R3b no rollback in `registerAll()` | all or none against the real registry | both fail |
| R4 restart after any exit | a crash runs once | fails |
| R5 the variable-name error left unmapped | `invalid_mcp_config` | fails |
| R6 no probe clamp; R6b no refusal | a probe shorter than the connect | both fail |
| R7 close waits for the handshakes | a hung handshake can't hold shutdown | fails |
| A1 the client's own validator | output schema never compiled | fails: the call hangs on the pattern |

The security pass's fixes, each with a mutation that fails its test:

| Mutation | Fix | Result |
| --- | --- | --- |
| S1 the server's schema passed as it is; S1b draft 7 `items` lists not walked | no server regex runs; a denied catastrophic input ends at once with the deny logged | both fail |
| S2 signal listeners installed by default; S2b re-raise only when alone; S2c no kill on the signal | opt-in only; works beside `signal-exit` | each fails |
| S4 the client's own page walk | pages read one at a time and stopped at the limit | fails: more pages are asked for |
| S5 description in the result; S5b full description score; S5c no per-source share | tool search with untrusted descriptions | each fails |
| S7 a plain `slice()` | a cut never splits a surrogate pair | fails: the list is refused |

The medium review's fixes, each with a mutation that fails its test:

| Mutation | Fix | Result |
| --- | --- | --- |
| M-1 check only `register()` | a registry without `registerAll()` or `list()` is refused when the manager is made | fails |
| M-3 kill only when the harness's listener is alone; M-3b never remove the listeners | groups end under a host's no-op listener; listeners leave with the last server | both fail |
| M-4 no `cwd` check; M-4b no NUL check | a bad `cwd`, or a NUL in the command, an argument or `cwd`, is an invalid config | both fail |

**Named limits.**

- A request for user input fails the call, so a server that needs a confirmation can't finish its tool.
- A server that exits stays down until the harness connects it again; nothing reconnects it.
- A tool-list change is logged, and the registered tools stay as they were.
- If the harness process is killed with `SIGKILL`, no handler can run, and a server that ignores its closed input outlives it. Under a host that listens for `SIGINT`, `SIGTERM` or `SIGHUP` itself, the servers end on the signal and the host decides whether the process does; a host that means to keep working after such a signal reconnects its servers.
- A tool list is counted after the client gathers it: up to 8 pages, each at most `maxLineBytes`, are held before `maxTools` applies.
- A stdio server runs on the host, with the harness's user, outside any sandbox. `spawnEnv()` limits what it inherits, not what it can do.
- A server that exits with a non-zero code on the probe is not started again, and fails to connect.
- Group kills need POSIX process groups. A descendant that leaves the group, by `setsid` or a detached spawn, survives a close, and on Windows the harness kills the server alone, so every descendant survives there.
- Without `killMcpServersOnSignal()`, a server that ignores its closed input outlives a host that a signal ends. A host that opts in loses its servers on the first `SIGINT`.
- A server's schema reaches the model without `pattern`, `patternProperties` and `format`, so the model loses those hints and the server's own check is the only one.
- The record's command hash is not salted: a reader of the log can confirm a guessed argument, such as a short PIN, by hashing it. Secrets belong in `setEnv`.
- "Stored as untrusted" is a mark on the log entry only; nothing in a request tells the model which results are untrusted, which waits on HD16.
- The bounds on lines and standard error apply to stdio. An in-process channel delivers what its host's server sends.
- Only 2026-07-28 counts as a modern era. A server that negotiates a later revision fails to connect until the client knows it.

**Other changes.** `@modelcontextprotocol/client` 2.4.0 moved from a dev to a runtime dependency of the harness, and `@modelcontextprotocol/server` 2.4.0 is a new dev dependency. Both were published on 2026-10-23, are Apache-2.0 and have no install script. They add no package to the lockfile, and `pnpm audit` finds nothing through them; its two advisories were already on `main`. No changeset: the harness is private, and the changeset gate counts only packages that are not. ADR 0021 is accepted, and HD14 is confirmed with a revision that lists how the built API differs from §3.3's sketch.

**The owner's answers (2026-11-22).** The three open questions were answered by the owner on 2026-11-22, agreeing with the manager's advice; the plan's [§6.6](../../plans/build-harness.md#66-the-owner-answered-n24s-three-questions-on-2026-11-22) records them.

1. *May a server's request for user input pause a turn?* No, not now: the call keeps failing with `failure: "input_required"`. A server-supplied prompt is untrusted text a person would read as the harness's own question. A safe pause needs binding to the call and to N13's signed pause, a wire form (N28 has none for grouped or sticky answers, nor an "authorization required" request) and HD16's taint handling, so the question returns with the connectors work. This stays a named limit.
2. *Should project-supplied configs need project trust?* Yes, as N22's extensions do: denied by default, with the exact command and args shown, and pinned by content hash so a change asks again. N24 takes configs from host code only, so it builds none of this; [N54](../done/N54-project-mcp-configs.md) adds `.mcp.json` loading with that gate as an acceptance criterion. Its [Outcome](../done/N54-project-mcp-configs.md#outcome) says which part holds: the pin lives in the project's lock file, so a change nobody pinned asks again, but a `git pull` that changes the config and the lock file together starts the new command without asking, and whether approvals should live outside the project is left open for the owner.
3. *Should a connected server write an `extension_loaded` entry of tier `mcp`?* Yes, and N24 builds it:
   - **What it holds.** The protocol's `ExtensionLoadedEntry` gains an optional `mcp` member, `McpServerRecord`: `transport` (`stdio` or `in_process`), `commandHash` (stdio only), `era` and `toolsHash`. `name` is the server's name and `contentHash` is the hash of `mcp`. No argument and no `env` or `setEnv` value is ever in it.
   - **The hashes.** Each is `sha256:` and the SHA-256 of the RFC 8785 canonical JSON that the SDK's `canonicalInputHash()` computes, the hash the permission pipeline already uses, with no Node import. `commandHash` covers `[command, ...args]`. `toolsHash` covers the registered tools sorted by name, each as `{ name, description, inputSchema }`, with the description as cut to 4,096 characters and the annotations left out, since they change nothing the harness does.
   - **When it is written.** `manager.records()` returns one record per connected server, after its tools are registered. A host passes them in `extensionRecords`, and the runner writes an entry for each record whose name and hash the log does not hold yet, as for in-process extensions. A server that fails to connect has no record: its status says why, and none of its code ran in a turn. A failed marker was the alternative, rejected because the log records what ran.
   - **Validation.** The entry union, the zod mirror, the generated JSON Schema and a fixture changed together, and the schema tests check the new member.
   - **Limits.** A hash of a short argument, such as a four-digit PIN, can be guessed by hashing every candidate, so a secret belongs in `setEnv`, never in the args. The new member is optional and no reader must understand it, so under the session format's rules it needs no `formatVersion` bump, and `FORMAT_VERSION` stays 1. The JSON Schema before this change, which allows no extra member, would refuse it; the change lands before the first release, so no published schema is affected. `docs/session-format.md` documents the member.

The record's tests are `test/mcp/record.test.ts` (6). Each was checked by a mutation that fails it: raw args in the record, args or the command left out of `commandHash`, a `toolsHash` that ignores the tools or is not stable, the wrong tier, records that are not kept, and a record for a failed server.
