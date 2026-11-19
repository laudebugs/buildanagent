# A2A support in our eight TypeScript SDKs (as of November 2026)

Research notes, gathered 2026-11-19 from the worktree on branch `todo/U19-research-a2a` (commit `f52ef2f`), at the versions pinned in `verify/<sdk>/package.json`: `@anthropic-ai/claude-agent-sdk` 0.3.327; `agents` 0.33.0, `@cloudflare/think` 0.23.0 and `@cloudflare/ai-chat` 0.12.2; `@github/copilot-sdk` 1.0.31; `@google/adk` 2.5.0 (which pulls in `@a2a-js/sdk` 0.3.14 and `express` 5.3.0); `langchain` 1.6.1, `@langchain/langgraph` 1.6.0 and `@langchain/core` 1.3.4; `@openai/agents` 0.21.0; `@earendil-works/pi-*` 1.5.2; and `ai` 7.0.162 with `@ai-sdk/harness` 1.0.173. Every installed file was read as text. No package code ran. The A2A spec tags are v1.0.0 (2026-03-12) and v1.0.1 (2026-05-28). `@a2a-js/sdk` 0.3.x implements protocol 0.3, and 1.0.0 (2026-07-22) through 1.3.0 (2026-09-29) implement protocol 1.0 (see [a2a-js-sdk.md](a2a-js-sdk.md) and [spec-v1.md](spec-v1.md)).

Method. Each `verify/<sdk>/node_modules/` tree was searched recursively, following pnpm symlinks, for `a2a` as a word or prefix, `agent-card`, `AgentCard` and `"message/send"`, in every file type (typings, JS bundles, docs, changelogs). For the native runtimes shipped by Claude and Copilot (the `-darwin-arm64` platform packages), `strings` output was searched for `agent2agent`, `agent-card.json`, `"message/send"`, `a2a-js`, `a2aproject` and `A2A`. Matches inside hex hashes, base64 or minified identifiers were discarded by hand. The newest npm release of each SDK was downloaded and searched the same way.

The tags mean:
- **[d.ts]**: installed typings. The path is relative to the worktree. Each `verify/<sdk>/node_modules/...` path is a pnpm symlink into `node_modules/.pnpm/`.
- **[js]**: installed bundled JavaScript, same path convention.
- **[docs]**: official docs, either the mirrored copy under `docs/reference/<sdk>/source/` (pinned in its `_manifest.json`) or a page fetched on 2026-11-19 at a named commit.
- **[repo]**: a source repo file, issue or pull request, at a named tag, commit SHA or date.
- **[npm]**: the npm registry (`https://registry.npmjs.org/<pkg>`), read 2026-11-19.
- **[secondary]**: anything else not checked against a primary source.

Downloads are saved under `/private/tmp/claude-501/-Users-laudebugs-git-agent-speak-git/13349893-3ab5-443b-8939-e45188938409/scratchpad/u19/sdks/` (`npm/` registry JSON, `latest/` unpacked newest tarballs, `adk-js/`, `cf/`, `oai/`, `lc/`, `vercel/`, `gh/` for GitHub API responses).

## Claude Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.327)

### Takeaway
No A2A support, as client or server, in the installed package, in its bundled native runtime, in the newest release (0.3.328), or in our docs mirror. The only multi-agent surface is in-process subagents. Reaching an A2A agent would mean writing a custom tool or MCP server on top of `@a2a-js/sdk` yourself.

### Cited findings
- **Installed package.** The recursive search of `verify/claude-agent-sdk/node_modules/` found a single match: a hex key in `@anthropic-ai/claude-agent-sdk/bridge.mjs:80` (`...d7d09a2abc2d43`). It is not A2A [js].
- **Native runtime.** In `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.327/.../claude`, `strings` finds no `agent2agent`, `agent-card.json`, `"message/send"`, `a2a-js`, `a2aproject` or `A2A` token. A looser case-insensitive search hits only minified identifiers such as `A2a`, `R2a` and `agentCardMark` (a UI card) [js].
- **Newest release.** 0.3.328 (2026-11-18) is the latest. Its tarball has no A2A match, and no version declares an `@a2a-js/*` dependency [npm].
- **Docs.** `grep -riE 'a2a|agent2agent|agent-to-agent'` over `docs/reference/claude-agent-sdk/` returns nothing. `guide.md` has no match either [docs].
- **Issues.** A GitHub issue search for `a2a` in `anthropics/claude-agent-sdk-typescript` returned 0 results on 2026-11-19 [repo].

## Cloudflare Agents (agents 0.33.0, Think 0.23.0, ai-chat 0.12.2)

### Takeaway
None of the three packages has A2A code. Cloudflare's own repo does ship an official **example** that exposes an `Agent` as an A2A **server**, written directly on `@a2a-js/sdk` ^0.3.13, so it speaks protocol 0.3. Its "client" is a browser UI that hand-rolls JSON-RPC `fetch` calls. An open PR (#2374) adds a production A2A 1.0 server example on `@a2a-js/sdk` ^1.2.0, but it has not been merged. The SDK's own "agent-to-agent calls" are Durable Object RPC, not A2A.

### Cited findings
- **Installed packages.** Searching `verify/cloudflare-agents/node_modules/` finds no A2A code in `agents`, `@cloudflare/think` or `@cloudflare/ai-chat`. Every match was a false positive: commit hashes in changelogs (`58a2ad7`), base64 in `miniflare/dist/src/index.js:31998`, a sourcemap in `agents/dist/harness/ai-sdk/index.js.map`, and the AI SDK provider list in `ai/docs/...` (see Vercel below) [d.ts]/[js]. `@a2a-js/sdk` is not installed in this harness.
- **Docs mirror.**
  - The agents README lists the example: "**Workflows & approvals** — `workflows/`, `a2a/`" (links to `examples/workflows` and `examples/a2a` in the original) — [docs] [`../../../reference/cloudflare-agents/source/agents/README.md:150`](../../../reference/cloudflare-agents/source/agents/README.md). The mirror does not include `examples/a2a/`.
  - "Agent-to-Agent Calls" in `callable-methods.md` means `getAgentByName(this.env.WorkerAgent, taskId)` and then a direct DO method call, not A2A — [docs] [`../../../reference/cloudflare-agents/source/agents/docs/agents/callable-methods.md:499`](../../../reference/cloudflare-agents/source/agents/docs/agents/callable-methods.md).
  - The only cloudflare-docs hit is a community MCP server page that links "`/.well-known/agent.json` — A2A Agent Card" — [docs] `.../cloudflare-docs/src/content/docs/agents/model-context-protocol/cloudflare/servers-for-cloudflare/community-mcp-server.mdx:103`. Nothing documents A2A as a feature of the SDK.
  - `docs/reference/cloudflare-agents/guide.md` has no A2A match [docs].
- **Official example at tag `agents@0.33.0`** (commit `5684e278e44abfb592a6ae6ef3e2f5250feacd8c`) [repo]:
  - `examples/a2a/package.json`: `"@a2a-js/sdk": "^0.3.13"` and `"agents": "*"`. Main (`81726f7`, 2026-11-19) still pins `^0.3.13`.
  - `examples/a2a/README.md`: "**Agent Card discovery** at `/.well-known/agent-card.json`", "**JSON-RPC transport** (`message/send`, `message/stream`) via the `@a2a-js/sdk` server", "**DO-backed TaskStore** using Durable Object SQLite", "**Workers AI** (GLM 4.7 Flash)".
  - `examples/a2a/src/server.ts`:
    - Imports `DefaultRequestHandler`, `JsonRpcTransportHandler`, `AgentExecutor` and `TaskStore` from `@a2a-js/sdk/server` (lines 8–15).
    - The card has `protocolVersion: "0.3.0"` and `url: "http://localhost:5173/a2a"` (lines 31, 50).
    - It uses v0.3 `kind: "task"`, `kind: "status-update"` and `kind: "message"` objects (lines 98, 111, 137).
    - `class MyA2A extends Agent<Env>` (line 172) builds `new DefaultRequestHandler(agentCard, taskStore, executor)` and a `JsonRpcTransportHandler` (lines 182–183).
    - `onRequest` serves both `/.well-known/agent-card.json` and the legacy `/.well-known/agent.json` (lines 190–192), and handles JSON-RPC POSTs with an SSE stream for async-iterable results (line 212 on).
    - The Worker `fetch` routes `/.well-known/*` and `/a2a` to `getAgentByName(env.MyA2A, "default")` (lines 258–264).
  - `examples/a2a/src/client.tsx` fetches `${baseUrl}/.well-known/agent-card.json` (line 33) and posts raw JSON-RPC with `method: "message/send"` and `"message/stream"` (lines 48, 70). It does not use the SDK client.
- **Open PR.** cloudflare/agents#2374, "feat(examples): add production A2A server", opened 2026-09-25 and still open (head `4a1c395`). It describes "a reusable Agent-backed A2A 1.0 server runtime with durable, context-sharded tasks", and `examples/a2a-server/package.json` there pins `"@a2a-js/sdk": "^1.2.0"` [repo].
- **Related issue.** cloudflare/agents#2748 (closed 2026-10-27) reports that the "www.cloudflare.com A2A card [is] missing required fields" [repo]. This concerns a website card, not the SDK.
- **Newest release.** `agents` 0.33.0, `@cloudflare/think` 0.23.0 and `@cloudflare/ai-chat` 0.12.2 are all still the npm `latest`. No version declares an `@a2a-js/*` dependency [npm].

## GitHub Copilot SDK (@github/copilot-sdk 1.0.31)

### Takeaway
No A2A in the TypeScript SDK or its bundled runtime. Copilot's docs mention A2A only as a feature of Microsoft Agent Framework (MAF), and they say the MAF integration packages exist for .NET and Python only. For TypeScript they tell you to "use the Copilot SDK directly". MAF's npm name `@microsoft/agent-framework` holds only a 0.0.1-beta placeholder from 2025. One open user question asks for A2A with Foundry agents and has no answer.

### Cited findings
- **Installed package.** Searching `verify/copilot-sdk/node_modules/` (the `@github/copilot-sdk` JS and typings) finds nothing. The `strings` scan of the platform package `@github+copilot-sdk-darwin-arm64@1.0.31` (`runtime.node`, `schemas/api.schema.json`, `schemas/session-events.schema.json`, `copilot-sdk/generated/rpc.d.ts`, plugins) finds no `agent2agent`, `agent-card.json`, `"message/send"`, `a2a-js` or `A2A` token. The looser search hits only base64 inside `libOneAuthInterop.dylib` and an unrelated policy string in `runtime.node` [js].
- **Docs mirror** ([`../../../reference/copilot-sdk/source/docs/integrations/microsoft-agent-framework.md`](../../../reference/copilot-sdk/source/docs/integrations/microsoft-agent-framework.md), tag `v1.0.31`, commit `15de061`) [docs]:
  - Line 14: "| **A2A protocol** | Agent-to-Agent communication standard supported by the framework |"
  - Lines 17–18: "MAF integration packages are available for **.NET** and **Python**. For TypeScript, Go, Java, and Rust, use the Copilot SDK directly".
  - The page covers .NET and Python only. `guide.md` has no A2A match.
- **MAF on npm.** `@microsoft/agent-framework` has only `0.0.1-beta` (2025-12-11, "Microsoft agent-framework for JavaScript"). `@microsoft/agents-a2a` returns "Not found" [npm].
- **Issue.** The repo now redirects to `microsoft/copilot-sdk`. Issue #2270, "Support for A2A communication with Foundry Agents", was opened 2026-08-05, is still open, is labelled `question`, and has 0 comments. It concerns the C# SDK [repo].
- **Newest release.** 1.0.34 (2026-11-14) is `latest`. Its main tarball has no A2A match; the platform binary for 1.0.34 was not scanned. No version declares an `@a2a-js/*` dependency [npm].

## Google ADK (@google/adk 2.5.0)

### Takeaway
ADK is the only one of the eight SDKs with first-party A2A in TypeScript, and it covers both roles over protocol **0.3**:
- **Server.** `toA2a(agent, options)` returns an Express app. It serves the agent card at `${basePath}/.well-known/agent-card.json`, JSON-RPC at `${basePath}/jsonrpc` and HTTP+JSON (REST) at `${basePath}/rest`. `A2AAgentExecutor` is the `@a2a-js/sdk` `AgentExecutor` underneath it.
- **Client.** `RemoteA2AAgent` is a `BaseAgent` that resolves a card and calls `sendMessageStream`, or `sendMessage` when the card says it cannot stream, over the SDK's JSON-RPC or REST transport factories.
- **Protocol version.** It depends on `@a2a-js/sdk` `^0.3.10` (0.3.14 installed), and generated cards say `protocolVersion: "0.3.0"`. Neither the 2.5.0 tag nor main (`281670e`, 2026-11-18) has moved to 1.x. An open PR (#1365, opened 2026-11-17) moves to `@a2a-js/sdk` ^1.3.0, serving A2A 1.0 with a 0.3 compatibility layer. It is a breaking change, because ADK exposes the SDK's types in its own API.
- **Docs.** The official adk-docs A2A section covers Python, Go, Java and Kotlin only. TypeScript has a short section in the adk-js repo's agents guide, plus a full `docs/guides/a2a/` guide that landed on main after 2.5.0 was tagged.
- **Offline testing.** Feasible: see below.

### Cited findings
- **Package metadata.** `verify/google-adk/node_modules/@google/adk/package.json` declares `"@a2a-js/sdk": "^0.3.10"` in `dependencies`, `"express": "^4.22.1 || ^5.1.0"` as an optional peer, and an `./a2a` subpath export [d.ts]. pnpm resolved `@a2a-js+sdk@0.3.14_@grpc+grpc-js@1.14.7_express@5.3.0`.
- **Public surface** — [d.ts] `verify/google-adk/node_modules/@google/adk/dist/types/a2a/index.d.ts:10–19`: `AGENT_CARD_PATH`, `RemoteA2AAgent`, the types `A2AStreamEventData`, `AfterA2ARequestCallback`, `BeforeA2ARequestCallback` and `RemoteA2AAgentConfig`, `getA2AAgentCard`, `ResolveAgentCardOptions`, `A2AAgentExecutor`, `AgentExecutorConfig` and its callbacks, `AdkDefaultRequestHandler`, `getA2aRequestMetadata`, `toA2a`, `A2aUserBuilder`, `ToA2aOptions`, `bearerTokenUserBuilder` and `ExecutorContext`. The doc comment reads: "`@google/adk/a2a` subpath: the A2A surface only, without the full ADK barrel. Also re-exported from `@google/adk`" (line 7). The root barrel has `export * from './a2a/index.js';` (`dist/types/index.d.ts:6`).
- **Server: `toA2a`** — [d.ts] `.../dist/types/a2a/agent_to_a2a.d.ts`:
  - The declaration is `export declare function toA2a(agent: RunnableRoot, options?: ToA2aOptions): Promise<express.Application>;` (line 94).
  - `ToA2aOptions` (lines 32–86) has `host` (default "localhost"), `port` (default 8000), `protocol` (default "http"), `basePath` (documented as `default: "a2a"`), `agentCard?: AgentCard | string`, `resolveAgentCardOptions`, `runner`, `sessionService`, `memoryService`, `artifactService`, `app?: express.Application`, `authentication?: A2aUserBuilder` and `allowUnauthenticated?: boolean`. The doc says "When omitted, `toA2a` fails closed and throws unless ... `allowUnauthenticated` is explicitly set to `true`."
  - `A2aUserBuilder = UserBuilder` comes from `@a2a-js/sdk/server/express` (lines 7, 28).
- **Server implementation** — [js] `.../dist/esm/a2a/agent_to_a2a.js`:
  - Express is loaded as an optional peer: `loadOptionalPeer({ packageName: "express", feature: "toA2a" }, ...)`, together with `@a2a-js/sdk/server/express` (lines 46–53).
  - The auth check (`resolveA2aUserBuilder`) throws "toA2a: refusing to mount the A2A server without authentication" unless `allowUnauthenticated === true`, which logs a warning and uses `UserBuilder.noAuthentication` (lines 60–74).
  - Defaults: `host` is `"localhost"`, `port` is `8e3`, `protocol` is `"http"`, and **`basePath = options.basePath || ""`** (lines 79–82). The d.ts says the `basePath` default is `"a2a"`, but the code defaults to the empty string. This is a typings/doc drift.
  - The generated card lists `{ url: \`${rpcUrl}/jsonrpc\`, transport: "JSONRPC" }` and `{ url: \`${rpcUrl}/rest\`, transport: "HTTP+JSON" }` (lines 85–92).
  - The executor runs with `streamingMode: StreamingMode.SSE` (line 103). The request handler is `new AdkDefaultRequestHandler(agentCard, new InMemoryTaskStore(), agentExecutor)`.
  - The app uses `express.json({ limit: "50mb" })` and mounts `agentCardHandler` at `` `${basePath}/${AGENT_CARD_PATH}` `` (line 116), `restHandler` at `` `${basePath}/rest` `` (line 120) and `jsonRpcHandler` at `` `${basePath}/jsonrpc` `` (line 128).
  - There is no gRPC transport, although `@a2a-js/sdk` 0.3.14 exports `./server/grpc`.
- **Card.** `getA2AAgentCard(agent, transports)` returns a card with `protocolVersion: "0.3.0"`, `version: "1.0.0"`, `url: transports[0].url`, `preferredTransport: transports[0].transport` and `capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false }` — [js] `.../dist/esm/a2a/agent_card.js:178` (and the surrounding lines). `ResolveAgentCardOptions` has `allowInsecureRpc` and `allowCrossOriginRpc`, which "both default to failing closed". `resolveAgentCard` refuses link-local hosts and redirects, and allows loopback and private addresses — [d.ts] `.../dist/types/a2a/agent_card.d.ts:14–63`.
- **Executor.** `export declare class A2AAgentExecutor implements AgentExecutor` from `@a2a-js/sdk/server`, with `execute(ctx: RequestContext, eventBus: ExecutionEventBus)` and `cancelTask(_taskId)`. `AgentExecutorConfig` has `runner: RunnerOrRunnerConfig`, `runConfig?`, `beforeExecuteCallback?`, `afterEventCallback?` and `afterExecuteCallback?` — [d.ts] `.../dist/types/a2a/agent_executor.d.ts:7, 31–46`. `AdkDefaultRequestHandler extends DefaultRequestHandler` overrides `sendMessage` and `sendMessageStream` to stash request metadata — [js] `.../dist/esm/a2a/request_metadata.js`.
- **Client: `RemoteA2AAgent`** — [d.ts] `.../dist/types/a2a/a2a_remote_agent.d.ts`:
  - Imports `AGENT_CARD_PATH, AgentCard, Message, MessageSendConfiguration, MessageSendParams, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent` from `@a2a-js/sdk` and `Client, ClientFactory` from `@a2a-js/sdk/client` (lines 6–7). These are the v0.3 type names.
  - `RemoteA2AAgentConfig extends BaseAgentConfig` has `agentCard?: AgentCard | string`, `resolveAgentCardOptions?`, `client?: Client`, `clientFactory?: ClientFactory`, `messageSendConfig?: MessageSendConfiguration`, `beforeRequestCallbacks?`, `afterRequestCallbacks?` and `metadata?` (lines 44–88).
  - The class is `export declare class RemoteA2AAgent extends BaseAgent<RemoteA2AAgentConfig>` (line 96). `runLiveImpl` is declared (line 104).
- **Client implementation** — [js] `.../dist/esm/a2a/a2a_remote_agent.js`:
  - The default factory is `new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, { transports: [new JsonRpcTransportFactory({ fetchImpl }), new RestTransportFactory({ fetchImpl })] }))` with a trace-propagating `fetch` (lines 36–44).
  - It calls `this.client.sendMessageStream(params)` when `card.capabilities.streaming !== false` (line 134), and `this.client.sendMessage(params)` otherwise (line 160).
  - Event discrimination uses v0.3 `kind` values: `event.kind === "status-update"`, `"artifact-update"`, `"message"` and `"task"`, with lowercase states such as `"input-required"` — [js] `.../dist/esm/a2a/a2a_event.js:17–39, 66`.
- **@a2a-js/sdk 0.3.14 protocol markers** — [d.ts] `node_modules/.pnpm/@a2a-js+sdk@0.3.14_.../node_modules/@a2a-js/sdk/dist/`:
  - `index.d.ts:15`: `declare const AGENT_CARD_PATH = ".well-known/agent-card.json";`
  - `extensions-APfrw8gz.d.ts:420`: `method: "message/send";`
  - Same file, line 657: `method: "message/stream";`
  - Same file, line 501: `kind: "message";`
  - Same file, line 1133: `protocolVersion: string;`
  - Exports: `.`, `./server`, `./server/express`, `./server/grpc`, `./client` and `./client/grpc`.
- **Other A2A hooks in the package.**
  - The Agent Registry integration has `getRemoteA2AAgent(agentName, ...)`: Promise<RemoteA2AAgent> — [d.ts] `.../dist/types/integrations/agent_registry/agent_registry.d.ts:90–93`.
  - `InvocationContext.a2aMetadata` — [d.ts] `.../dist/types/agents/invocation_context.d.ts:60, 229`.
  - `RunConfig.allowRemoteToolConfirmation` — [d.ts] `.../dist/types/agents/run_config.d.ts:126`.
- **CLI (not installed in our harness).** `@google/adk-devtools` 2.5.0 (2026-11-12) adds `--a2a [boolean]` ("Whether to enable A2A for web/api server. Default: false") and `--a2a-auth-token` ("If unset, the A2A surface is served WITHOUT authentication"). The dev server mounts `toA2a(agent, { basePath: \`/a2a/${appName}\` ... })` — [js] `scratchpad/u19/sdks/latest/_google_adk-devtools/package/dist/esm/cli/cli.js:229–236` and `dist/esm/server/adk_api_server.js:237–241` [npm tarball].
- **Docs mirror, TypeScript.**
  - The adk-js README says "Delegate to remote agents via the A2A protocol" — [docs] [`../../../reference/google-adk/source/adk-js/README.md:47`](../../../reference/google-adk/source/adk-js/README.md) (tag `main-v2.5.0`, commit `b1b94c0`).
  - The agents guide has a "Delegating execution with `RemoteA2AAgent`" section with a `new RemoteA2AAgent({ name, description, agentCard: 'https://billing-agent.example.invalid/.well-known/agent.json' })` example — [docs] [`../../../reference/google-adk/source/adk-js/docs/guides/agents/index.md:325–335`](../../../reference/google-adk/source/adk-js/docs/guides/agents/index.md). The example uses the pre-0.3 path `agent.json`, while the SDK constant is `agent-card.json`. That is minor doc drift.
  - The core changelog records A2A work from "A2A integration: add toA2a util function (#205)" and "A2A Remote agent (#190)" through 2.5.0's "**a2a:** propagate trace context across A2A calls (#1226)". It also records "**security:** require authentication when mounting A2A server (#529)" — [docs] [`../../../reference/google-adk/source/adk-js/core/CHANGELOG.md:8, 421, 562–564`](../../../reference/google-adk/source/adk-js/core/CHANGELOG.md).
- **Docs mirror, other languages.** The adk-docs A2A landing page is tagged "Supported in ADK Python Go Java" — [docs] [`../../../reference/google-adk/source/adk-docs/docs/a2a/index.md:3–4`](../../../reference/google-adk/source/adk-docs/docs/a2a/index.md) (commit `ff7a5f5`). Every page under `docs/a2a/` carries a Python, Go, Java or Kotlin tag, and none is TypeScript. Version notes on those pages:
  - Python works with "`a2a-sdk` 0.3.x and 1.x.x" — `quickstart-consuming.md:8–19`.
  - "the Java SDK currently uses A2A Protocol 0.3" — `quickstart-consuming-java.md:29`.
  - "The Kotlin client reads **A2A 1.0** cards" — `quickstart-consuming-kotlin.md:62`.
  - `docs/reference/google-adk/guide.md` has no A2A match.
- **adk-js repo** [repo]:
  - `core/package.json` declares `"@a2a-js/sdk": "^0.3.10"` at tag `main-v2.5.0`, at tag `adk-v2.5.0`, and on `main` at `281670ea771ee4e9a63441039bda4e676b7c3128` (2026-11-18). Main has not moved to 1.x.
  - Issue google/adk-js#1364 (open, 2026-11-17) is "Support A2A protocol v1.0 (@a2a-js/sdk 1.x): adk-js only speaks A2A 0.3". It says "The agent card it publishes says `protocolVersion: '0.3.0'` ... `toA2a` / `A2AAgentExecutor` serve the 0.3 JSON-RPC methods and payloads (`message/send`, `kind` discriminators, lowercase task states)". It reports that in the reporter's cross-language suite "all 63 A2A tests that involve TypeScript have to be skipped as unsupported".
  - PR google/adk-js#1365 (open, not draft, head `b7a124b`) is "feat(a2a)!: support A2A protocol v1.0 with @a2a-js/sdk 1.x". It "moves `core/src/a2a` from `@a2a-js/sdk` `^0.3.10` to `^1.3.0`". The server would serve `SendMessage`/`SendStreamingMessage`, `TASK_STATE_*` and `A2A-Version: 1.0`, with four `supportedInterfaces` (JSON-RPC and HTTP+JSON at 1.0 and at 0.3) and `legacyCompat: {enabled: true}`. `RemoteA2AAgent` would speak 1.0 when the card declares it and fall back to v0.3 transports otherwise. It lists breaking changes because "adk-js accepts and exposes `@a2a-js/sdk` types".
  - PR #1300 (merged 2026-11-13, after the 2.5.0 tag) added `docs/guides/a2a/index.md` and an "offline sample (`samples/a2a/agent.ts`)". On main, that guide also names newer APIs (`AgentCardBuilder`, `rpcPath`, `timeoutMs`, `AgentCardResolutionError`) that are not in the 2.5.0 typings. PR #1309, "Release: v2.6.0", is open.
- **Our harness.** `verify/google-adk/examples/` has `01-function-tool.ts` through `08-triage-agent.ts` plus `lib/check.ts`. None mentions A2A (searched with `grep -ril a2a`). `lib/check.ts:2–15` provides `ScriptedLlm extends BaseLlm` ("@google/adk@2.5.0 ships no fake model").
- **Newest release.** `@google/adk` 2.5.0 (2026-11-12) is `latest`. All 18 versions that reference A2A, from 0.4.0 (2026-02-25) through 2.5.0, declare `@a2a-js/sdk@^0.3.10` [npm].
- **Offline test: feasible at the pin.** Two routes:
  - **Loopback HTTP.** Call `toA2a(agent, { allowUnauthenticated: true, host: '127.0.0.1', port })` with an agent driven by `ScriptedLlm` or a deterministic `BaseAgent`. Express 5.3.0 is resolvable as ADK's peer (`node_modules/.pnpm/@google+adk.../node_modules/express`). Then `app.listen(port, '127.0.0.1')`, and run `new RemoteA2AAgent({ name, agentCard: \`http://127.0.0.1:${port}/.well-known/agent-card.json\` })` under an `InMemoryRunner`. The card host must match the fetch origin, because `allowCrossOriginRpc` defaults to false. Plain http is allowed on loopback.
  - **No socket.** Pass `RemoteA2AAgent` a hand-made `client` whose `sendMessageStream` feeds an `A2AAgentExecutor` through an in-memory `ExecutionEventBus`, as the main-branch guide does [repo] (`docs/guides/a2a/index.md:22–119` at `281670e`). It uses only 2.5.0 exports (`A2AAgentExecutor`, `getA2AAgentCard`, `RemoteA2AAgent`, `InMemoryRunner`).
  - Either route needs `@a2a-js/sdk` importable from the example for its types and `RequestContext`. It is currently only a transitive dependency, so `verify/google-adk/package.json` would have to add it (`pnpm add @a2a-js/sdk@0.3.14`).

## LangChain JS (langchain 1.6.1, @langchain/langgraph 1.6.0, @langchain/core 1.3.4)

### Takeaway
The JS libraries have no A2A client or server. The `a2a` string in LangGraph's stream typings is only an example channel name in a comment. LangChain's A2A support is a feature of the hosted LangSmith **Agent Server** (`/a2a/{assistant_id}`). The docs say it speaks A2A 1.0 JSON-RPC and also accepts four v0.3 method names, but its response wire shape "is still v0.3". The docs state the requirement as the Python package `langgraph-api >= 0.4.21`, and all examples are Python. The JS dev server `@langchain/langgraph-api` 1.8.0 contains no A2A code. Whether a LangSmith deployment of a JS graph exposes the endpoint was not verified.

### Cited findings
- **Installed packages.** The only real match is a doc comment in `@langchain/langgraph` — [d.ts] `verify/langchain/node_modules/@langchain/langgraph/dist/stream/types.d.ts:229` ("Events emitted via `emit()` use an application-chosen method name (e.g. `emit("a2a", data)`) and are accessible to remote clients via `session.subscribe("custom:<name>")`"). This is a naming example for custom stream channels, not A2A protocol support. The other matches are commit hashes in `@langchain/core/CHANGELOG.md:715` and `@langchain/openai/CHANGELOG.md:500` [d.ts]/[js].
- **Newest releases.** `langchain` 1.6.7, `@langchain/core` 1.4.2 and `@langchain/langgraph` 1.7.5 (2026-11-17/18): the only match is the same comment. `@langchain/langgraph-sdk` 1.17.0 has an equivalent comment ("e.g. `"custom:a2a"`") in `dist/client/stream/index.d.ts:19`. `@langchain/langgraph-api` 1.8.0 and `@langchain/langgraph-cli` 1.8.0 have no `a2a`, `/a2a`, `agent-card`, `message/send` or `SendMessage` string [npm tarballs].
- **Docs mirror.** `docs/reference/langchain/source/` mirrors only `src/oss/**` and some snippets of langchain-ai/docs at `9d9747d`, and it has no A2A match. `guide.md` has no match [docs].
- **LangSmith docs** at langchain-ai/docs commit `9d9747d0cf241e086c616a16d5ce230ad8f8f31d`, `src/langsmith/server-a2a.mdx` (fetched 2026-11-19) [docs]:
  - "The A2A endpoint is available in [Agent Server](/langsmith/agent-server) at `/a2a/{assistant_id}`" (line 9).
  - "Agent Server speaks the A2A **v1.0** JSON-RPC binding and also accepts the v0.3 method names" (line 13). The card declares `protocolBinding: "JSONRPC"` and `protocolVersion: "1.0"` (lines 17–23).
  - Methods: `SendMessage`/`message/send`, `SendStreamingMessage`/`message/stream`, `GetTask`/`tasks/get`, `CancelTask`/`tasks/cancel`, `ListTasks` and `GetExtendedAgentCard`. `SubscribeToTask` and push config are "Not yet" (lines 37–46). "Only the JSON-RPC binding is available. gRPC and HTTP+JSON are not implemented" (line 52).
  - Card: `GET /.well-known/agent-card.json?assistant_id={assistant_id}` (line 199).
  - Requirements: "A2A endpoint | `langgraph-api >= 0.4.21`" and `pip install "langgraph-api>=0.16.0"` (lines 330, 341). Graph state needs a `messages` key (line 344).
  - Known TCK gaps: "Response wire shape is still v0.3 | Tasks, messages and parts carry `kind` and `mimeType`"; "`A2A-Version` request header | Not read" (lines 774, 781).
  - Opt-out: `"http": { "disable_a2a": true }` in `langgraph.json` (lines 787–793).
  - The examples are Python only (lines 363, 455, 581, 666).
  - `src/oss/deepagents/a2a.mdx` is only a redirect stub to `/langsmith/server-a2a` (6 lines).
- **Issues.** A search for `a2a` in `langchain-ai/langgraphjs` returned 2 unrelated PRs (#2309, #2471) [repo].
- **Offline test.** Not feasible in our harness: no A2A code ships in the JS packages, and the Agent Server endpoint needs the Python `langgraph-api` server.

## OpenAI Agents SDK (@openai/agents 0.21.0)

### Takeaway
There is no A2A in the pinned 0.21.0 or in the current npm `latest`, 0.22.0 (2026-11-12). There is substantial A2A work on an **unreleased branch**, `feat/codex-harness`, in openai/openai-agents-js. It adds `@openai/agents/a2a` and `@openai/agents/a2a/client`, which re-export from a new `@openai/agents-codex/a2a`, and it targets **A2A 1.0 JSON-RPC** via `@a2a-js/sdk` 1.0.1 as an optional dependency:
- **Client:** `connectA2A`.
- **Server:** `NativeA2AExecutor`, an official `AgentExecutor` for `DefaultRequestHandler`.
- **Deferred remote work:** `A2AJobProvider`.

The branch is 483 commits ahead of and 53 behind main. Its docs mention a "`0.22.0-alpha.2` release", but no such version exists on npm, and `@openai/agents-codex` is not published. Treat this as upcoming, not available.

### Cited findings
- **Installed package.** Searching `verify/openai-agents-sdk/node_modules/` finds only commit hashes in `openai/CHANGELOG.md` and `@ai-sdk/openai/CHANGELOG.md`, plus the AI SDK provider list [js]. The 0.21.0 exports are `.`, `./utils`, `./sandbox`, `./testing`, `./realtime`, `./sandbox/local` and `./realtime/testing` [npm].
- **Newest release.** The `@openai/agents`, `-core` and `-extensions` 0.22.0 tarballs have no A2A match. The 0.22.0 exports equal 0.21.0's. No version of `@openai/agents` declares `@a2a-js/*` or exports an `a2a` path [npm]. `packages/agents/package.json` on `main` and at tag `v0.22.0` has no `a2a` export [repo].
- **Docs mirror.** `docs/reference/openai-agents-sdk/` (tag `v0.21.0`, commit `304e436`) has no A2A match. `guide.md` has no match [docs].
- **Branch `feat/codex-harness`** (head `946e87b4874a0ec551f3bcc2ad8dc95cae26c0d0`, 2026-11-19) [repo]:
  - `packages/agents/package.json` exports `./a2a` and `./a2a/client`, and `packages/agents/src/a2a/index.ts` is `export * from '@openai/agents-codex/a2a';`.
  - `packages/agents-codex/package.json` has `optionalDependencies: { "@a2a-js/sdk": "1.0.1", ... }`.
  - `packages/agents-codex/A2A.md`:
    - Line 3: "`@openai/agents/a2a` connects native agents to remote A2A agents over A2A protocol 1.0 and JSON-RPC. It uses the official `@a2a-js/sdk@1.0.1` client and server interfaces."
    - Line 7: "The `0.22.0-alpha.2` release exports `@openai/agents/a2a`."
    - Lines 33–35 map roles to APIs: `connectA2A`, `NativeA2AExecutor` with the official `DefaultRequestHandler`, and `A2AJobProvider`.
    - Line 39: "The card must advertise that same RPC URL, protocol version `1.0`, and binding `JSONRPC`. Redirects, embedded URL credentials, other protocol versions ... are unsupported."
    - Line 78: "The host authenticates requests, builds `ServerCallContext`, serves the card, and owns HTTP routing."
    - Line 114: the deferred-thumbnail example "uses scripted model responses ... No API key or external service is needed."
  - Merged PRs into `feat/codex-harness`:
    - #2129 (2026-11-05): "add optional A2A 1.0 JSON-RPC support through `@openai/agents/a2a`, using the optional `@a2a-js/sdk` peer (qualified with 1.0.1)".
    - #2554 (2026-11-12): "Expose the native A2A client for Worker runtimes" (adds `@openai/agents/a2a/client`).
    - #2228, #2171, #2172, #2601 and #2610 are follow-ups.
  - The compare view shows `main...feat/codex-harness` as "diverged", 483 ahead and 53 behind.
- **npm.** `@openai/agents-codex` returns "Not found". `@openai/agents` has no `0.22.0-alpha.*` version; the only 0.22 version is `0.22.0` [npm].
- **Offline test.** Not feasible at our pin. A test against the branch would need a source build ("Build the native SDK from source ... with Node.js 24", A2A.md:7) of an unpublished package.

## Pi (@earendil-works/pi-* 1.5.2)

### Takeaway
No A2A in any installed Pi package or in our docs mirror, and 1.5.2 is still `latest`. The only ecosystem pointer is a community project, `any-a2a`, a Pi extension that uses a standalone Rust CLI for A2A delegation. A docs PR to list it in Pi's docs was closed without merging.

### Cited findings
- **Installed packages.** Searching `verify/pi/node_modules/` finds only base64 in `@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-VEJDBY3O.js:3` and a sourcemap in `dist/core/extensions/loader.d.ts.map` [js].
- **Docs mirror.** `docs/reference/pi/` (tag `v1.5.2`, commit `b4afddd`) has no A2A match. `guide.md` has no match [docs].
- **npm.** `@earendil-works/pi-coding-agent` 1.5.2 (2026-11-10) is `latest`. An npm search for "pi a2a extension" lists no Pi A2A package [npm].
- **Community.** earendil-works/pi#9831, "docs(packages): add External packages section with any-a2a as a community example", was closed unmerged. Its body describes any-a2a (github.com/mrone0/any-a2a) as "a Pi extension for remote A2A subagent delegation with the A2A transport in a standalone Rust CLI" [repo; the project itself was not inspected, so treat it as secondary].
- **Offline test.** Not applicable.

## Vercel AI SDK (ai 7.0.162, @ai-sdk/harness 1.0.173)

### Takeaway
No first-party A2A in `ai` or `@ai-sdk/harness`, pinned or latest. The AI SDK docs list a **community** provider, `a2a-ai-provider` (dracoblue), that makes a remote A2A agent look like a language model, so it is a client only. Its latest version (0.5.0-alpha.1, 2026-06-12) depends on `@a2a-js/sdk` ^0.3.13 (protocol 0.3), implements `LanguageModelV2`, and declares the peer range `ai >=5.0.0 <7.0.0`, which excludes our `ai` 7.0.162. AI SDK 7 still adapts v2 models at runtime, so it would probably work despite a peer-dependency warning, but this is untested. There is no A2A server in the AI SDK.

### Cited findings
- **Installed packages.** The only match is the provider list in the AI SDK's bundled docs: "- [A2A Provider](/providers/community-providers/a2a) (`a2a-ai-provider`)" — [docs] `verify/vercel-ai-sdk/node_modules/ai/docs/02-foundations/02-providers-and-models.mdx:86`. That is also in our mirror at [`../../../reference/vercel-ai-sdk/source/content/docs/02-foundations/02-providers-and-models.mdx:86`](../../../reference/vercel-ai-sdk/source/content/docs/02-foundations/02-providers-and-models.mdx). The other matches are commit hashes in changelogs. `guide.md` has no match.
- **Provider page.** At vercel/ai tag `ai@7.0.162` (commit `2feaeec`), `content/providers/05-community-providers/02-a2a.mdx` says "The [dracoblue/a2a-ai-provider] is a community provider" (line 8). It also says the provider supports "**Streaming Text Responses** via `sendSubscribe` and SSE", which is a pre-0.3 method name (line 16), and shows the usage `model: a2a('https://your-a2a-server.example.com')` (line 48) [docs].
- **Community package `a2a-ai-provider`** [npm] (tarball in `scratchpad/u19/sdks/vercel/tgz/`):
  - It is MIT-licensed. The latest is `0.5.0-alpha.1` (2026-06-12), with `peerDependencies: { ai: ">=5.0.0 <7.0.0" }` and `dependencies: { "@a2a-js/sdk": "^0.3.13" }`.
  - Its `@a2a-js/sdk` range has moved from ^0.2.2 (0.1.0-alpha.2, 2025-07-01) through ^0.2.5 and ^0.3.4 to ^0.3.13.
  - `dist/index.d.ts:9–10` declares `declare class A2aChatLanguageModel implements LanguageModelV2 { readonly specificationVersion = "v2";`.
  - The README usage is `a2a('https://your-a2a-server.example.com/.well-known/agent-card.json')`.
- **AI SDK 7 compatibility.** `asLanguageModelV4` contains `const v3Model = model.specificationVersion === "v2" ? asLanguageModelV3(model) : model;` — [js] `verify/vercel-ai-sdk/node_modules/ai/dist/index.js:782`. So a v2 provider is still accepted at runtime, subject to the peer range.
- **Issues.** vercel/ai#7442, "Feature request: Add support for the Agent2Agent protocol" (2025-07-21), is closed and was not implemented as a feature. PR #7751 (2025-08-04), "docs: add a2a community provider", was the response [repo].
- **Newest release.** `ai` 7.0.177 and `@ai-sdk/harness` 1.0.188 (2026-11-18) have no A2A code; the only match is the same docs line [npm tarballs].
- **Offline test.** Possible only with the community package plus a separate A2A server, for example one built directly on `@a2a-js/sdk` 0.3 over loopback. This would test a community add-on, not the SDK.

## Summary

| SDK | Pin | A2A client | A2A server | Protocol version | Offline-testable in our harness | Evidence |
|---|---|---|---|---|---|---|
| Claude Agent SDK | 0.3.327 (latest 0.3.328) | No | No | n/a | n/a | No match in d.ts, JS or native runtime strings; none in docs or issues |
| Cloudflare Agents | agents 0.33.0, Think 0.23.0, ai-chat 0.12.2 | No (example UI hand-rolls `fetch`) | Not in package. Official repo example `examples/a2a` uses `@a2a-js/sdk` server in an `Agent` DO | 0.3 (example `^0.3.13`, card `protocolVersion: "0.3.0"`). Open PR #2374 has a 1.0 server example on `^1.2.0` | Yes in principle (workerd/Miniflare, add `@a2a-js/sdk`, replace Workers AI with a mock), but that tests the example pattern, not an SDK API | [repo] `examples/a2a/src/server.ts` @ `5684e27`; [docs] README.md:150 |
| Copilot SDK | 1.0.31 (latest 1.0.34) | No | No | n/a (MAF has A2A in .NET/Python only) | n/a | No match in JS or runtime strings; [docs] microsoft-agent-framework.md:14, 17–18; open issue #2270 |
| Google ADK | 2.5.0 (latest) | Yes: `RemoteA2AAgent` (JSON-RPC + HTTP+JSON transports, streaming or blocking) | Yes: `toA2a` (Express; card, `/jsonrpc`, `/rest`), `A2AAgentExecutor`; CLI `--a2a` in `@google/adk-devtools` | 0.3 (`@a2a-js/sdk ^0.3.10`, 0.3.14 installed; card `"0.3.0"`). Main still 0.3; PR #1365 (open) moves to 1.x / A2A 1.0 | Yes: loopback `toA2a` + `RemoteA2AAgent` with `ScriptedLlm`, or the socket-free executor/client pattern; needs `@a2a-js/sdk` added as a direct dependency | [d.ts] `dist/types/a2a/*.d.ts`; [js] `agent_to_a2a.js:79–128`, `agent_card.js:178`; [repo] #1364/#1365 |
| LangChain JS | langchain 1.6.1, langgraph 1.6.0, core 1.3.4 | No | Not in JS packages. LangSmith Agent Server (`/a2a/{assistant_id}`), documented for Python `langgraph-api` | Server: 1.0 JSON-RPC plus four v0.3 method names; wire shape still v0.3 | No (needs the Python Agent Server) | [d.ts] langgraph `stream/types.d.ts:229` (comment only); [docs] `src/langsmith/server-a2a.mdx` @ `9d9747d` |
| OpenAI Agents SDK | 0.21.0 (latest 0.22.0) | No (released). Unreleased branch: `connectA2A` | No (released). Unreleased branch: `NativeA2AExecutor` | Branch: 1.0 JSON-RPC via `@a2a-js/sdk` 1.0.1 | No at the pin | [npm] 0.21.0/0.22.0 exports; [repo] `feat/codex-harness` @ `946e87b`, `packages/agents-codex/A2A.md` |
| Pi | 1.5.2 (latest) | No | No | n/a | n/a | No match; community `any-a2a` only (PR #9831 unmerged) |
| Vercel AI SDK | ai 7.0.162, harness 1.0.173 | Community only: `a2a-ai-provider` (peer `ai <7`) | No | Community provider: 0.3 (`@a2a-js/sdk ^0.3.13`) | Only for the community provider against a separate A2A server | [docs] providers-and-models.mdx:86; [npm] `a2a-ai-provider` 0.5.0-alpha.1 |
