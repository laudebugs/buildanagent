# Interfaces and extensions: how a harness exposes itself and how it is extended

Research notes, 18 November 2026. Working material for the harness design; the main report and fact-check log supersede these notes where they disagree.

**Thesis.** Every mature harness studied here has one protocol-shaped core and several thin transports over it. The SDK, CLI, stdio RPC and HTTP server are views of a single command/event contract, not separate products. Codex runs its own `exec` CLI on an in-process copy of the app-server protocol. OpenCode's SDK runs the HTTP router in memory. Pi's print, JSON and RPC modes share one `AgentSession`. Extension splits the same way across all of them: in-process plugins get full power and no isolation, out-of-process MCP servers get isolation and a narrow contract, and skills are files the model reads on demand. Our harness should copy that shape. Build a typed in-process API first, give it a JSONL-over-stdio transport early, and add HTTP/WebSocket later as one more transport over the same contract.

Path abbreviations used below:

- `PI` = `verify/pi/node_modules/@earendil-works/pi-coding-agent` (1.5.2); `PIDOC` = `docs/reference/pi/source/coding-agent`
- `CAS` = `verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk` (0.3.327)
- `CX` = the Codex clone at commit `4389a52`, 18 Nov 2026, under `scratchpad/clones/codex`; the clone has no tags, so Codex claims refer to main as of November 2026
- `OC` = the OpenCode clone at commit `79bd2c6`, 18 Nov 2026; `OH` = the OpenHands software-agent-sdk clone at commit `7dd877e`, 18 Nov 2026
- `VAI` = `docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-harnesses`; `OAI` = `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist` (0.21.0)
- `MCPCORE` = `node_modules/.pnpm/@modelcontextprotocol+core@2.4.0/node_modules/@modelcontextprotocol/core/dist`

## 1. Four interface shapes recur, and each serves a different client

| Shape | Serves | Examples (as of November 2026) |
|---|---|---|
| In-process SDK | Same-language hosts that want full API access and no process boundary | Pi SDK (`PIDOC/rpc.md:5-10`); OpenCode `@opencode/sdk` 2.3.0 "executes Server's assembled HTTP router in memory, opening no listener" (`OC/packages/sdk/README.md:3`); Codex `in_process.rs` "replaces socket/stdio transports with bounded in-memory channels" to "preserve app-server semantics" (`CX/codex-rs/app-server/src/in_process.rs:1-6`) |
| One-shot CLI (text or JSONL events) | Scripts, CI, command substitution | `pi --print` and `pi --mode json` (`PIDOC/cli-integration.md:11-52`); `codex exec --experimental-json`, which the Codex TS SDK spawns (`CX/sdk/typescript/src/exec.ts:95`) |
| Long-lived JSONL-over-stdio RPC | Other languages, IDEs, process isolation, SDK wrappers | Pi `--mode rpc` (`PIDOC/rpc.md:3-16`); Claude Agent SDK spawns the CLI with `--output-format stream-json --input-format stream-json` (`CAS/sdk.mjs`, the literal `"--output-format","stream-json","--verbose","--input-format","stream-json"`); Codex app-server's default `stdio://` listen URL (`CX/codex-rs/app-server-transport/src/transport/mod.rs:123`) |
| Network server (HTTP+SSE or WebSocket) | Desktop and web apps, remote sandboxes, multiple concurrent clients | Codex `ws://IP:PORT` and `unix://` listen URLs (`.../transport/mod.rs:101-167`); OpenCode OpenAPI 3.1 surface with an SSE `/api/event` stream (`OC/packages/protocol/openapi.json:1-8,3851,10264`); OpenHands WebSocket `/events/{conversation_id}` (`OH/openhands-agent-server/openhands/agent_server/sockets.py:188`) |

A fifth shape is emerging as a wrapper target. Vercel's experimental `HarnessAgent` drives ten third-party harnesses through adapters. Cursor, GitHub Copilot and Grok Build run "Sandbox via ACP" (the Agent Client Protocol); Claude Code, Codex and OpenCode run over a "Sandbox bridge"; and Pi and Cline run as a "Host process" (`VAI/05-harness-adapters.mdx:15-47`). OpenHands also ships an `acp_router.py` (`OH/.../agent_server/acp_router.py:1`). These wrappers consume a harness through whichever stable interface it publishes. A harness without a documented headless protocol cannot be adapted this cheaply.

## 2. The headless-core pattern is literal: transports share one contract

- **Codex.** `codex exec` is a client of the app-server: `exec/src/lib.rs:20-22` imports `AppServerClient` and `DEFAULT_IN_PROCESS_CHANNEL_CAPACITY`. The in-process runtime keeps "the same JSON-RPC result envelope that `MessageProcessor` uses for stdio and websocket transports … rather than creating a second execution contract" (`CX/codex-rs/app-server/src/in_process.rs:19-24`). The TUI and exec are meant to go through `codex-app-server-client` (`:34-39`).
- **OpenCode.** The SDK "uses the same values, errors, request options, and `AsyncIterable` streams as `@opencode/client`" (`OC/packages/sdk/README.md:16`). The schema lives in a separate `packages/protocol` with generated OpenAPI (`OC/packages/protocol/script/generate-openapi.ts`).
- **Pi.** "All four modes use the same agent, sessions, resources, and tools. The mode determines how input enters Pi, how output is exposed, and whether the process remains available" (`PIDOC/cli-integration.md:5`). JSON and RPC stdout share one event type, `JsonAgentSessionEvent` (`PI/dist/modes/json-event.d.ts:21-24`).
- **Claude Agent SDK.** The SDK is a thin TypeScript client over the CLI's stream-json protocol. SDK 0.3.327 bundles CLI 2.1.327 (`CAS/manifest.json:2`).

The fact-check log already recommends adding a JSONL-over-stdio RPC mode early, because "every SDK in this space (Codex SDK, Claude Agent SDK, Pi RPC) embeds the harness" that way (`docs/research/fact-check-2026-11-18.md`, "Reference architecture review" item 5). The evidence above strengthens that recommendation. The RPC mode should be the core's native contract, not an adapter added later.

## 3. Protocol shapes: requests, events and server-initiated requests

### Three record families appear in every protocol

Every protocol separates (a) client commands with correlated responses, (b) uncorrelated session events, and (c) server-to-client requests, which carry approvals, dialogs and client-hosted tools.

- **Pi.** Pi uses bespoke JSONL records: a command `{id?, type, ...}`, a reply `{type:"response", command, success, data|error}`, session events, and `extension_ui_request`/`extension_ui_response` (`PIDOC/rpc.md:24-48`). As of 1.5.2 there are 33 `RpcCommand` variants (`PI/dist/modes/rpc/rpc-types.d.ts:14-136`), covering prompt, steer, follow_up, abort, session tree, fork and clone, model, compaction and bash. The UI subprotocol has 9 methods: 4 dialogs that block, and 5 fire-and-forget methods (`rpc-types.d.ts:407-462`; `PIDOC/rpc-extension-ui.md:5-10`).
- **Claude.** Conversation messages (`SDKMessage`) share one stream with `control_request {request_id, request}`, `control_response` and `control_cancel_request` records (`CAS/sdk.d.ts:5484-5497,4185-4192`). Either side may send a control request (`:5484`). The request union has 41 subtypes (`:5497`). Host-bound subtypes include `can_use_tool`, `hook_callback`, `mcp_message` and `elicitation`; CLI-bound subtypes include `initialize`, `interrupt`, `set_model`, `mcp_set_servers`, `reload_skills` and `rewind_files`.
- **Codex.** Codex uses JSON-RPC 2.0 framing but omits the `"jsonrpc"` field: "We do not do true JSON-RPC 2.0" (`CX/codex-rs/app-server-protocol/src/rpc.rs:1-2`). Ids may be strings or integers, and requests carry an optional W3C `trace` context (`rpc.rs:17-57`). Methods are namespaced as `noun/verb` (`thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`; `.../protocol/common.rs:575,1136,1149,1155`). `common.rs` contains about 280 distinct method strings. The server sends requests such as `item/commandExecution/requestApproval` and `item/tool/call` for client-hosted "dynamic tools" (`common.rs:1934,1965`), and announces completion with `serverRequest/resolved` (`:2145`).

### Prompt acceptance and run completion are separate signals

Pi's `prompt` reply reports a `disposition` (`started`, `queued` or `handled`), not completion. Clients must wait for `agent_settled`, because `agent_end` can be followed by retries, compaction or queued follow-ups (`PIDOC/rpc.md:58-71`; `PIDOC/rpc-commands.md:37-40`). Codex separates `turn/start` from the `turn/started` and `turn/completed` notifications (`common.rs` method list). The Codex TS SDK's JSONL events are `thread.started`, `turn.started|completed|failed`, `item.started|updated|completed` and `error` (`CX/sdk/typescript/src/events.ts:7-71`).

### Cancellation has three layers

Every protocol provides some of these:

1. Abort the run: Pi `abort` (waits for idle before it replies), `abort_retry` and `abort_bash` (`PIDOC/rpc-commands.md:94-100,434-440,511-514`); Claude `interrupt` (`CAS/sdk.d.ts:5050`); Codex `turn/interrupt`.
2. Withdraw one in-flight request: Claude `control_cancel_request`. "The sender stops waiting at once and ignores any control_response that still arrives"; it has no reply (`CAS/sdk.d.ts:4185`). Claude also lets a redelivered `request_id` supersede the in-flight run, "exactly one response per request_id" (`:5105`).
3. Kill the process: the Codex TS SDK passes an `AbortSignal` to `spawn` (`CX/sdk/typescript/src/exec.ts:36-37,205`). Pi defines orderly shutdown on stdin EOF or SIGTERM, and a second signal exits at once (`PIDOC/rpc.md:91-97`).

### Backpressure is usually explicit only in Codex

- **Pi.** Pi "honors stdout backpressure, but a client that stops reading can stall the process" (`PIDOC/rpc.md:56`).
- **Codex.** Codex bounds its queues (`CHANNEL_CAPACITY = 128`, `CX/codex-rs/app-server-transport/src/transport/mod.rs:24`). The in-process runtime rejects a full command queue with `-32001` "request queue is full" (`in_process.rs:748-757`; `error_code.rs:7`). It "may drop notifications under saturation", but server requests "are never silently abandoned … so approval flows do not hang" (`in_process.rs:26-32`). Clients can also opt out of notification methods per connection (`optOutNotificationMethods`, `CX/.../protocol/v1.rs:66-69`).
- **Pi payload size.** Pi strips cumulative snapshots from `message_update` on the wire, so event size stays constant (`PI/dist/modes/json-event.d.ts:25-31`).

### Framing details matter

Pi requires LF-only splitting and refuses Node `readline`, because readline also splits on U+2028 and U+2029, which are valid inside JSON strings (`PI/dist/modes/rpc/jsonl.js:1-20`; `PIDOC/rpc.md:50-56`). Stdout is reserved for protocol records and logs go to stderr (`:56`). Malformed input gets a `command:"parse"` error with no id (`:81-85`).

### Reconnection and replay are first-class in the multi-client servers

- **Claude.** The `initialize` response lists `pending_permission_requests`, pending dialogs and pending elicitations, so "a client joining an already-initialized session" can re-arm prompts. Receivers must dedupe by `request_id` (`CAS/sdk.d.ts:435-443`).
- **Codex.** Pending approvals "use the normal approval replay flow when a capable client reconnects"; with no capable client, the command is rejected (`CX/codex-rs/app-server/README.md:12-20`).
- **OpenHands.** The events WebSocket takes `resend_mode=all|since` and `after_timestamp` (`OH/.../sockets.py:188-233`).

## 4. Versioning: feature detection beats version numbers in practice

- **Claude** has no protocol version field. Compatibility is additive. Fields are "sent as a separate field so a CLI that predates it ignores it", and clients should "treat absence as an older CLI" (`CAS/sdk.d.ts:4877,435`). Startup can fail with typed reasons such as `cli_version_too_old` and `initialize_not_first` (`:6551-6553`).
- **Codex** combines four mechanisms (`CX/.../protocol/v1.rs:29-69`; `CX/codex-rs/app-server-protocol/src/experimental_api.rs:1-30`; `common.rs:528-530`):
  - a `v1`/`v2` module split for types;
  - `initialize {clientInfo{name,version}, capabilities}`;
  - per-method and per-field `#[experimental("thread/start.dynamicTools")]` gates, which reject a call unless the client set `experimentalApi: true`;
  - types derived to TypeScript and JSON Schema (`rpc.rs:4-5,13-16`).
- **Pi** has no protocol version on RPC. Session files carry `version?` (`PI/dist/core/session-manager.d.ts:7`), and the docs make the installed `pi --help` authoritative (`PIDOC/rpc.md:18`).
- **MCP** negotiates per request in 2026-07-28. The `_meta` key `io.modelcontextprotocol/protocolVersion` "must match the `MCP-Protocol-Version` header", capabilities are "declared per request rather than once at initialization", and `server/discover` replaces the handshake as the probe (`MCPCORE/schemas-DscsoNZN.mjs:19-47,352-362`).

## 5. Extension models split into in-process plugins and out-of-process servers, and the trust boundary differs

### In-process plugins have full power and no isolation

- **Pi extensions** are TypeScript modules loaded with jiti (`PI/dist/core/extensions/jiti-loader.js`). As of 1.5.2, `ExtensionAPI.on` has 41 events (`PI/dist/core/extensions/types.d.ts:1229-1269`): startup (`project_trust`, `resources_discover`), session, context and provider (`context`, `before_provider_request`), agent, turn, message, tool (`tool_call`, `tool_result`), and `input`. The API also has `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerProvider`, `registerMcpServer` and `registerVirtualModel` (`:1271-1449`). Handler composition is typed by pattern: notification, in-place mutation, chained transform, gate, and last override. Gates "should fail closed" (`PIDOC/extensions.md:412-425`). The docs state the trust model plainly: an extension "runs inside the Pi process with the same operating-system permissions" (`PIDOC/extensions.md:7`). Extensions can silently override built-in tools by registering the same name (`:2360`).
- **OpenCode plugins** come in Promise, Effect, RPC and TUI flavours. They share the host's `effect` instance, so a plugin must not bundle its own copy (`OC/packages/plugin/README.md:3-15`).
- **Codex plugins** use an "Agent Plugins" `plugin.json` with a `$schema`, fixed fields and namespaced `extensions` (`com.openai`) (`CX/codex-rs/core-plugins/src/agent_plugin_manifest.rs:17-29`). The default skills directory is `skills` (`loader.rs:74`).
- **Claude plugins** are local directories passed as `--plugin-dir` (`CAS/sdk.d.ts:6142-6156,2204-2210`). `skipMcpDiscovery` lets the host own a plugin's MCP connections (`:6150-6153`).
- **LangChain middleware** offers `beforeAgent`, `beforeModel`, `afterModel`, `wrapModelCall` and `wrapToolCall` (`docs/reference/langchain/source/src/oss/langchain/middleware/custom.mdx:51-70`). It is the library-level equivalent of the Pi hooks.

### Trust gates control what loads, not what runs

Pi's project trust keeps a folder from "silently loading executable extensions". It covers `.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions|skills|prompts`, `SYSTEM.md` and `.agents/skills`, but not `AGENTS.md` or `CLAUDE.md` (`PIDOC/security.md:27-57`). The decision order is a CLI flag, then an extension's `project_trust` handler, then a saved `~/.pi/agent/trust.json`, then `defaultProjectTrust` (`:59-73`). Headless modes cannot prompt, so `ask` means skip (`:75-82`). Pi says explicitly that trust "does not limit what tool calls can access" (`:33`). Codex similarly does not persist trust for a directory that has no project marker (`CX/codex-rs/app-server/README.md:254-259`). Claude scopes filesystem config with `settingSources: ('user'|'project'|'local')[]`; `[]` is "SDK isolation mode" (`CAS/sdk.d.ts:2452-2462,10200`).

### Out-of-process MCP servers are isolated by the process boundary but still trusted for content

Claude routes even in-process SDK MCP servers through the protocol. `mcp_message` carries raw MCP JSON-RPC between the CLI's MCP client and the host's `McpServer` instance (`CAS/sdk.d.ts:5163-5171,1330-1337`). That gives one code path for in-process and remote tools, but costs a round trip per call. A newer `sdkMcpServerManifests` field pre-caches handshakes to cut the startup round trips (`:4895`). Claude also calls its control channel "trusted": `mcp_call` runs "No permission check … unless check_permissions is set" (`:5105`). Whoever holds the stdio pipe is the operator.

## 6. Skills are procedural memory that the model loads lazily from files

- **Format.** A skill is a directory with `SKILL.md`, YAML frontmatter (`name` ≤64 lowercase-hyphen characters, `description` ≤1024 characters, plus optional `license`, `compatibility`, `metadata`, an experimental `allowed-tools` and `disable-model-invocation`), and optional `scripts/`, `references/` and `assets/` (`PIDOC/skills.md:9-85`). Field limits are as Pi documents the Agent Skills spec. agentskills.io was unreachable from this environment, so the spec itself was not read.
- **Loading.** At startup only "name, description, and path" go into the system prompt. The model then reads `SKILL.md` itself, and `/skill:name` forces a load (`PIDOC/skills.md:41-53`). Codex goes further and detects implicit invocation by parsing shell commands that read a `SKILL.md` or run a skill script (`CX/codex-rs/skills/src/invocation.rs:1-20`; the tests cover `cat`/`Get-Content` variants, `invocation_tests.rs:69-116`).
- **Discovery roots.** Pi reads user, project and `.agents/skills` from the working directory up through its ancestors to the repository root, and the first discovered skill wins a name collision (`PIDOC/skills.md:59-85`). Codex exposes `skills/list` and `skills/extraRoots/set` over RPC (`common.rs:973-979`). Claude filters skills with `skills: string[] | 'all'`, using `plugin:skill` for plugin skills, and warns that this "is a context filter, not a sandbox … files remain on disk" (`CAS/sdk.d.ts:2463-2485`). Vercel passes skills inline as `{name, description, content, files[]}` and lets the adapter materialize them in the runtime (`VAI/04-skills.mdx:14-48`).
- **Prompt templates** are the lighter sibling: a Markdown file becomes a `/command` with `${1:-default}` arguments and no supporting files (`PIDOC/prompt-templates.md:1-20`).
- **This repo.** `.agents/skills/<kebab-name>/SKILL.md` already follows the format, with a "when to load" description and a pinned version (`.agents/skills/README.md:5-19`). Our harness can read the format natively.

## 7. MCP client design: namespace tools, defer them, and support both protocol eras

### Transports

- **Claude** supports stdio, SSE, HTTP and in-process `sdk` servers (`CAS/sdk.d.ts:1290-1337,1444-1475`).
- **OpenAI Agents 0.21.0** supports `MCPServerStdio`, `MCPServerStreamableHttp` and `MCPServerSSE`, plus `hostedMcpTool`, in which the Responses API calls the server and approval is configured with `requireApproval` (`OAI/mcp.d.ts:139-174`; `OAI/tool.d.ts:470-500`).
- **Pi** supports stdio and streamable HTTP and rejects SSE outright (`PIDOC/mcp.md:75-82`).
- **`@ai-sdk/mcp` 2.0.90** names `2026-07-28` as `LATEST_PROTOCOL_VERSION` and still supports four older versions back to 2024-11-05 (`verify/vercel-ai-sdk/node_modules/@ai-sdk/mcp/dist/index.js:7-15`).
- **`@modelcontextprotocol/core` 2.4.0** still sets `LATEST_PROTOCOL_VERSION = "2025-11-25"` but ships the 2026-07-28 schemas (`MCPCORE/schemas-DscsoNZN.mjs:4-11,352-362,528-548`).
- **LangChain** calls the split "protocol eras": legacy (`initialize`) and modern (`server/discover`, 2026-07-28). Mixing both in one aggregate client drops the whole fleet to legacy, which is why it offers a per-server `ClientGroup` (`docs/reference/langchain/source/src/oss/langchain/mcp/connections.mdx:101-105,200-224`).

### What 2026-07-28 changes, from the installed SDK rather than the spec site

- **Discovery and capabilities.** `server/discover` is mandatory for servers. Capabilities and version travel in each request's `_meta`.
- **Subscriptions.** `subscriptions/listen` "replaces the previous HTTP GET endpoint and `resources/subscribe`" (`MCPCORE/schemas-DscsoNZN.mjs:19-60,352-362,528-548`).
- **Deprecations.** Sampling types and logging (`logLevel`, `setLevel`) are deprecated by SEP-2577: "Migrate to calling LLM provider APIs directly" (`:645-652,855-870,66-69`). The 2025-11-25 Tasks vocabulary is kept "for interoperability only" (`:13-18`).
- **Scaling.** Modern servers are stateless and can sit behind any load balancer. Legacy servers need sticky routing, and replicas must share a `requestState` signing key for elicitation (`docs/reference/langchain/source/src/oss/langchain/mcp/connections.mdx:161`).

modelcontextprotocol.io was unreachable here, so these points come from SDK code comments, not the specification.

### Namespacing differs by SDK, and collisions are the main failure

- **Pi** names tools `mcp__<server>__<tool>`, replaces non-identifier characters with `_`, and adds hash suffixes on collision (`PIDOC/mcp.md:77`).
- **LangChain** prefixes `server_tool` by default (`connections.mdx:119`).
- **OpenAI** does not prefix by default (`includeServerInToolNames = false`, `OAI/mcp.mjs:405`). It throws `Duplicate tool names found across MCP servers` (`:430-432`). With prefixing enabled, it hashes and shortens names (`:595-625`).

### Tool exposure is now a per-server policy, not all-or-nothing

- **Pi exposure modes:**
  - `codemode` (the default) makes a tool callable only from scripts.
  - `deferred` loads a tool through `tool_search`.
  - `direct` declares the tool to the model.
  - `hidden` registers the tool but keeps it unreachable.

  Server summaries are appended to the conversation instead of mutating tool declarations, "so earlier messages stay cached" (`PIDOC/mcp.md:191-209`).
- **Claude** defers MCP tools behind tool search by default, and `alwaysLoad: true` opts a server out (`CAS/sdk.d.ts:1300-1303`).
- **OpenAI** offers `toolFilter`, `cacheToolsList`, and per-server input and output guardrails (`OAI/mcp.d.ts:23-31`).
- **Pi** runs MCP as a replaceable built-in extension (`builtin:mcp`, `--no-mcp`; `PIDOC/cli.md:197-201`; `PI/dist/extensions/mcp/`). This is the "removable component" property our architecture asks for.

### Lifecycle

- **Connection.** Pi connects in the background. Only the first prompt waits, for up to 10 seconds, and only for `direct` servers. Pi retries 408, 429 and 5xx twice and kills stdio servers by process group (`PIDOC/mcp.md:96-102`).
- **Config.** Config is a JSON `mcpServers` map with `${ENV}` and `!command` secret expansion. Project `.pi/mcp.json` is read only in trusted projects (`PIDOC/mcp.md:75-82`; `PIDOC/cli.md:356`).
- **Out-of-band calls.** Codex exposes `mcpServer/tool/call` and Claude exposes `mcp_call`, so a client can call an MCP tool without a model turn (`common.rs:1386`; `CAS/sdk.d.ts:5105`).

## 8. MCP as a server is the weakest-supported direction

- **Codex.** At commit `4389a52` there is no `codex mcp-server` subcommand and no `mcp-server` crate. The CLI lists `exec`, `mcp` (manage *external* servers), `app-server` and others (`CX/codex-rs/cli/src/main.rs:149-248`); `git ls-tree` shows only `codex-mcp`, `rmcp-client` and `message-board-mcp`. Earlier Codex releases shipped an MCP server mode. Its removal is inferred from its absence, because the shallow clone has no history. Codex's stable embedding surfaces are app-server and `exec`.
- **Agents-as-tools.** Agents exposed as tools are in-process, not MCP: OpenAI's `Agent.asTool()` (`OAI/agent.d.ts:404-405`).
- **Multi-agent embedding** in practice goes through each harness's own RPC (Vercel adapters, ACP) rather than MCP (`VAI/05-harness-adapters.mdx:36-47`).

An MCP-server facade fits "expose our harness as one tool to someone else's agent". It is a poor main interface, because MCP lacks steering, session trees and approval replay.

## 9. Host-provided tools follow three patterns

1. **In-process function.** The host passes a function: Pi `registerTool`, Vercel `HarnessAgent({tools})`, which "executes the tool in your host process, then submits the result back" (`VAI/03-tools.mdx:52-85`), and Claude SDK MCP servers.
2. **Server-to-client request.** The core asks the client to execute the tool: Codex `thread/start.dynamicTools` (experimental) with `item/tool/call` requests (`CX/.../v2/thread.rs:148-154`; `common.rs:1965`).
3. **Suspend and continue.** A tool without `execute` suspends the turn into serializable continuation state, and the host resumes it with `continueStream({toolResultContinuations})` (`VAI/03-tools.mdx:134-172`). Host-only `toolsContext` is never serialized or shown to the model (`:87-130`).

Vercel also exposes the adapter-native tool name in `providerMetadata[harnessId].nativeToolName`, so approval gates can match it (`VAI/03-tools.mdx:285-310`). This argues for keeping a canonical tool name and a display or native alias as separate fields.

## Design implications for our harness

1. **Define one typed protocol package before any transport.** Use a discriminated union of commands, responses, events and server requests, and generate TypeScript types and JSON Schema from it, as Codex does (`rpc.rs:4-16`). Then implement the in-process API, stdio JSONL and, later, WebSocket or HTTP+SSE as transports over that one `MessageProcessor`-style dispatcher. Codex (`in_process.rs:19-24`) and OpenCode (`sdk/README.md:3,16`) show this keeps behaviour identical across transports. Our own CLI should be a client of the in-process transport, the way `codex exec` is (`exec/src/lib.rs:20-22`).
2. **Use JSON-RPC 2.0 framing over LF-only JSONL.** Keep the `jsonrpc` field. Codex shows that omitting it buys nothing (`rpc.rs:1-2`), and keeping it means generic JSON-RPC tooling and MCP-style libraries just work. Use `noun/verb` method names (`thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`), string or integer ids, and an optional `trace` field so OTel context crosses the boundary (`rpc.rs:46-57`). Write a custom LF splitter, not readline (`jsonl.js:1-20`). Reserve stdout for protocol records.
3. **Make acceptance, settlement and cancellation explicit.**
   - The `turn/start` reply should return a disposition (`started`, `queued` or `handled`).
   - Emit a terminal `turn/settled` event distinct from the low-level end, as Pi does with `agent_settled` (`rpc.md:58-71`).
   - Support `turn/interrupt` for runs and `$/cancelRequest` for any single request, so the requester can withdraw it, as Claude does with `control_cancel_request` (`sdk.d.ts:4185`).
   - Specify stdin-EOF graceful shutdown and immediate exit on a second signal (`rpc.md:91-97`).
4. **Bound every queue and specify what happens when it fills.** Reject commands with an overloaded error (`-32001`). Allow dropping or coalescing streaming deltas. Never drop approval or tool requests (`in_process.rs:26-32`). Send deltas, not cumulative snapshots, and make the `message_end` record authoritative (`json-event.d.ts:25-31`). Let clients opt out of notification methods (`v1.rs:66-69`).
5. **Version by capabilities, not numbers alone.**
   - `initialize` exchanges `clientInfo`, `serverInfo`, a protocol version string and capability flags.
   - New fields are additive, and readers ignore unknown fields.
   - Unstable methods and fields sit behind an `experimental` gate that the client must opt into (`experimental_api.rs`; `v1.rs:55-57`).
   - Startup failures return typed reasons (`sdk.d.ts:6551-6553`).
6. **Make server-to-client requests replayable.** Approvals, dialogs and client-hosted tool calls are server requests with stable ids. A reconnecting client gets the pending set in its `initialize` result (`sdk.d.ts:435-443`), and a `serverRequest/resolved` notification tells other clients to dismiss theirs (`common.rs:2145`). Event streams support `since=<seq>` resume (`sockets.py:193-233`). The event log's sequence numbers, from architecture item 3, become the resume cursor.
7. **Use three extension tiers with different trust.**
   - In-process TypeScript extensions with typed hooks (before and after model, before and after tool, context transform, input, steering), where each hook declares its composition rule: notify, mutate, chain, gate (fail-closed) or last-wins (`extensions.md:412-425`). Forbid silent overrides of built-in tools. Pi allows them (`extensions.md:2360`); we should require an explicit `override: true`.
   - MCP servers as the out-of-process, language-neutral tier.
   - Skills and prompt templates as the no-code tier.

   Gate all project-supplied tiers behind a project-trust decision. In headless mode the default is "skip" (`security.md:59-82`). Document that trust gates loading and is not a sandbox. Real isolation comes from architecture item 7.
8. **Implement the MCP client as a removable built-in extension.** Pi's `builtin:mcp` and `--no-mcp` are the model (`cli.md:197-201`).
   - Target the 2026-07-28 stateless revision (`server/discover`, per-request `_meta`, `subscriptions/listen`), with a per-server legacy fallback, never a fleet-wide one (`connections.mdx:101-105`).
   - Support stdio and streamable HTTP. Treat SSE as legacy-only (`mcp.md:79`).
   - Skip sampling and logging, which are deprecated by SEP-2577 (`schemas-DscsoNZN.mjs:645-652`).
   - Connect servers in the background, and wait at the first prompt only for directly exposed servers (`mcp.md:96-102`).
9. **Name tools canonically and give each source an exposure policy.**
   - Canonical names are `mcp__<server>__<tool>`, sanitized, with deterministic hash suffixes on collision (`mcp.md:77`). Never fail at runtime on duplicates as OpenAI does (`mcp.mjs:430-432`); refuse duplicates at registration time with a clear error.
   - Each source gets `direct`, `deferred` (via `tool_search`) or `hidden`, plus a `codemode` value if we ever add scripted tool calls (`mcp.md:191-209`).
   - Append changed server summaries to the conversation rather than rewriting the tool list, to keep the prompt cache (`mcp.md:209`).
   - Keep a native or display alias separate from the canonical name (`03-tools.mdx:285-310`).
10. **Adopt the Agent Skills format unchanged.** Advertise only `name`, `description` and `path`. Load the full body through the ordinary `read` tool, or force it with `/skill:name`. Record a `skill_loaded` event when a `SKILL.md` read is observed, as Codex does (`invocation.rs`). Discover skills from `~/.agents/skills` and from `.agents/skills` walking up to the repository root, with first-wins collisions plus a warning (`skills.md:41-85`). A `skills` allowlist is a context filter, not a security control (`sdk.d.ts:2463-2485`).
11. **Support all three host-tool patterns through one registry.** These are in-process functions, client-executed tools via a server request, and suspend/continue for tools with no executor (`03-tools.mdx:52-172`; `common.rs:1965`). Keep host-only context out of the session log and out of model-visible errors (`03-tools.mdx:87-130`).
12. **Defer MCP-server mode.** Expose the harness to other agents through the stdio protocol, so ACP and Vercel-style adapters can wrap it. Add a thin MCP-server facade (one `run_task` tool) only when a consumer needs one. Codex no longer ships one at HEAD (`cli/src/main.rs:149-248`).

## Unresolved gaps

- The MCP 2026-07-28 specification and the Agent Skills specification were not read directly: modelcontextprotocol.io and agentskills.io failed DNS resolution in this environment. Facts come from `@modelcontextprotocol/core` 2.4.0 code comments, `@ai-sdk/mcp` 2.0.90 constants, LangChain docs and Pi docs.
- When and why Codex removed `codex mcp-server` is unknown, because the shallow clone has no history. The Codex skill-root locations and plugin manifest semantics were only skimmed.
- ACP (Agent Client Protocol) was not studied. It appears as the transport for three Vercel adapters and in OpenHands, and deserves its own note.
- OpenCode's event SSE schema and OpenHands' REST surface were only sampled, not analysed.
- No harness found has measured how protocol overhead (for example Claude's `mcp_message` round trips) affects latency.
