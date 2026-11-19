# TypeScript gaps: the ports miss batteries more than core loop features

*As of November 2026. Each gap cites the primary-language source or docs at a recorded tag, and the TypeScript package's `.d.ts` at the version pinned in `verify/<sdk>/package.json`. Paths that start with `dist/` are relative to that package in `verify/<sdk>/node_modules/`.*

Every reference in this repo covers the TypeScript package, because our stack is TypeScript ([language policy](../plans/sdk-references.md#language-policy-typescript-references-with-a-parity-check-decided-2026-11-18)). Three of the eight SDKs are Python first, though, and the Claude and Copilot SDKs ship official packages in other languages. A team that reads a Python page, or a bilingual one, can plan on a feature that its npm package lacks. For each SDK with a non-TypeScript primary or sibling, this report lists three kinds of gap: features the TypeScript package lacks, features it has in a weaker form, and features it has that the docs show only for the primary language. The core loop is at parity everywhere we looked: agents, function tools, handoffs or sub-agents, guardrails or middleware, approvals, sessions, MCP and tracing all exist in TypeScript. The gaps sit in the batteries, the ready-made parts around the loop, such as storage backends, voice pipelines, shell helpers and test suites. Google ADK trails furthest, OpenAI and LangChain trail on batteries, and the Claude and Copilot TypeScript packages match or exceed their siblings.

## Summary: Google ADK has the most gaps, and Claude's TypeScript package leads its Python sibling

| SDK | Primary language | Versions compared | Lacks | Weaker | Docs-only |
|---|---|---|---|---|---|
| [Google ADK](#google-adk-the-port-trails-python-by-14-features-but-the-docs-undersell-it-by-15) | Python | `google-adk` 2.14.1 vs `@google/adk` 2.5.0 | 14 | 2 | 15 |
| [OpenAI Agents SDK](#openai-agents-sdk-typescript-lacks-storage-backends-the-voice-pipeline-and-developer-utilities) | Python | `openai-agents` 0.24.0 vs `@openai/agents` 0.21.0 | 9 | 2 | 0 |
| [LangChain](#langchain-typescript-lacks-the-shell-and-file-search-middleware-checkpoint-encryption-and-test-suites) | Python | `langchain` 1.4.8 and `langgraph` 1.2.19 vs `langchain` 1.6.1 and `@langchain/langgraph` 1.6.0 | 8 | 2 | 4 |
| [GitHub Copilot SDK](#github-copilot-sdk-typescript-is-a-first-class-sdk-and-lacks-only-rust-extras) | TypeScript, with five sibling SDKs | Rust and four others vs `@github/copilot-sdk` 1.0.31 | 1 | 2 | 0 |
| [Claude Agent SDK](#claude-agent-sdk-typescript-leads-python-and-trails-it-in-two-small-places) | TypeScript and Python, both first-party | `claude-agent-sdk` 0.2.183 vs `@anthropic-ai/claude-agent-sdk` 0.3.327 | 0 | 2 | 0 |

**Lacks** means no `.d.ts` file in the pinned package declares the feature. **Weaker** means TypeScript has it with less behavior or fewer options. **Docs-only** means TypeScript exports it, but the docs show it only for the primary language. For the three new comparisons (OpenAI, LangChain, Claude), I paired each TypeScript pin with the newest primary-language release published on or before the pin's npm publish date. Newer releases exist on both sides; see [what this report could not verify](#what-this-report-could-not-verify).

Three SDKs need no gap section, because TypeScript is their primary and only language:
- **Vercel AI SDK:** ships as the `ai` and `@ai-sdk/*` npm packages from [vercel/ai](https://github.com/vercel/ai) ([reference](../reference/vercel-ai-sdk/README.md)).
- **Pi:** ships as three npm packages from [earendil-works/pi](https://github.com/earendil-works/pi), and other languages drive its CLI instead ([guide §11](../reference/pi/guide.md#11-four-process-modes-wrap-the-same-agent)).
- **Cloudflare Agents:** Cloudflare publishes no Python Agents SDK ([fact-check](../reference/cloudflare-agents/fact-check.md#what-we-could-not-verify)).

## Google ADK: the port trails Python by 14 features, but the docs undersell it by 15

The S7 reference already holds this comparison: [guide §14](../reference/google-adk/guide.md#14-typescript-parity-250-lacks-14-python-features-has-2-in-weaker-form-and-has-15-the-docs-show-only-for-python), with the evidence for every row in [`verify/google-adk/results/parity-draft.md`](../../verify/google-adk/results/parity-draft.md). It compares `@google/adk` 2.5.0 with Python `google-adk` 2.14.1 at tag `v2.14.1`, starting from the docs' 152 "Supported in ADK" tags that list Python but not TypeScript. In short:
- **Lacks (14):** for models and context, the LiteLLM connector, context caching, app-level event compaction and `set_default_model`. For the runtime, session rewind, Agent Config (YAML agents) and ambient-agent triggers. For tools and auth, toolset-level authentication, `McpInstructionProvider`, the Bash tool and environment toolset, the Pub/Sub, Spanner and Bigtable toolsets, the GKE code executor and `AuthenticatedFunctionTool`, which adk-js main already exports. For evaluation, user simulation and custom metrics.
- **Weaker (2):** `outputSchema` violations are only logged, and tool calls from one model turn run in sequence rather than in parallel. Behavioral examples 06 and 01 verify both.
- **Docs-only (15):** among them `requireConfirmation`, resumability, `runLive`, planners, code execution, the database and Vertex AI session services, and plugins on an `App`.
- **TypeScript-only:** `ChromeBuiltInLlm`, `WebMCPToolset` and `RoutedLlm`.
- **Live (voice) parts documented for Python only (added 2026-11-19):** the voice research (U20) searched the 2.5.0 typings and found none of three live parts that ADK's live docs show for Python. First, `CascadeLive`, which chains speech-to-text, a text model and text-to-speech, and after an interruption saves "Only the words the user heard". Second, the non-blocking tool options, `response_scheduling` and `behavior`. Third, handling of Gemini's `toolCallCancellation`: a search of the compiled TypeScript live flow finds no code that acts on it, although the server sends it when a client interrupts a turn with tools in flight. U20 read the Python side from the docs mirror only, not from `adk-python` source ([voice report](../research/voice/voice-and-realtime.md#two-sdks-ship-a-voice-agent-two-ship-experimental-live-layers-and-four-leave-voice-to-the-builder); [SDK notes](../research/voice/notes/sdks-adk-vercel-langchain-claude-copilot-pi.md)). The owner approved recording them on 2026-11-19, and they add to the counts above without changing them.

ADK is the one SDK where a TypeScript builder should distrust the docs in both directions. Check the 2.5.0 `.d.ts` before you drop a feature for a Python-only tag, and re-validate structured output yourself.

## OpenAI Agents SDK: TypeScript lacks storage backends, the voice pipeline and developer utilities

`@openai/agents` 0.21.0 matches Python `openai-agents` 0.24.0 on every core feature I compared. Both have function tools and the same hosted tools, from web search and code interpreter to computer use, shell, apply-patch and tool search. Both also have input, output and tool guardrails with `runInParallel`, handoffs with input filters, and MCP over stdio, SSE and streamable HTTP. Trace processors, realtime agents, retry policies, `ScriptedModel`, the Codex tool and sandbox agents with the same mounts exist on both sides too. The gaps are batteries that Python ships and JavaScript leaves to you.

**Sources:** Python source and docs at [`openai/openai-agents-python`](https://github.com/openai/openai-agents-python) tag `v0.24.0` (commit `17d994bd`, 2026-10-15), rendered at [openai.github.io/openai-agents-python](https://openai.github.io/openai-agents-python/). Python paths are relative to `src/agents/`. TypeScript types from `@openai/agents-core`, `-openai`, `-realtime` and `-extensions` 0.21.0 (published 2026-10-20). JavaScript docs from the [mirror](../reference/openai-agents-sdk/source/) at tag `v0.21.0`.

### Lacks: nine features

| Feature | Python 0.24.0 | TypeScript 0.21.0 |
|---|---|---|
| Database session backends | `SQLiteSession` (`memory/sqlite_session.py:18`), plus `AsyncSQLiteSession`, `RedisSession`, `SQLAlchemySession`, `MongoDBSession` and `DaprSession` in `extensions/memory/`; listed in `docs/sessions/index.md` | Only `MemorySession` (`agents-core dist/memory/memorySession.d.ts`), `OpenAIConversationsSession` and `OpenAIResponsesCompactionSession` (`agents-openai dist/memory/`). The JS sessions page points to sample backends under the repo's `examples/memory/` (`guides/sessions.mdx:23`) |
| Branching session with usage analytics | `AdvancedSQLiteSession` (`extensions/memory/advanced_sqlite_session.py:59`), with `create_branch_from_turn` and `store_run_usage`; `docs/sessions/advanced_sqlite_session.md` | No branching session in any `.d.ts` |
| Encrypted session wrapper | `EncryptedSession` (`extensions/memory/encrypt_session.py:116`), encryption plus TTL over another backend; `docs/sessions/encrypted_session.md` | No `EncryptedSession` |
| Nested handoff history (beta) | `RunConfig.nest_handoff_history` and `handoff_history_mapper` (`run_config.py:385`, `:400`), and the `nest_handoff_history` filter (`extensions/handoff_filters.py:28`); `docs/handoffs.md:122` | `agents-core dist/extensions/handoffFilters.d.ts` declares only `removeAllTools`; no history-nesting option on the runner |
| Tool-output trimmer | `ToolOutputTrimmer` (`extensions/tool_output_trimmer.py:88`), a ready-made `call_model_input_filter` that shortens old tool outputs | No trimmer. `callModelInputFilter` exists (`agents-core dist/run.d.ts:165`), so you write the filter yourself |
| Voice pipeline (speech-to-text, agent, text-to-speech) | `VoicePipeline` (`voice/pipeline.py:24`) with `OpenAISTTModel` and `OpenAITTSModel`; `docs/voice/pipeline.md` | No `VoicePipeline`. JavaScript voice agents are realtime agents only (`guides/voice-agents.mdx`) |
| Terminal REPL | `run_demo_loop` (`repl.py:15`); `docs/repl.md` | No `runDemoLoop` |
| Agent-graph visualization | `draw_graph` (`extensions/visualization.py:406`), Graphviz output; `docs/visualization.md` | No graph helper |
| Runloop sandbox client | `RunloopSandboxClient` (`extensions/sandbox/runloop/sandbox.py:1563`); `docs/sandbox/clients.md:152` | `@openai/agents-extensions` exports Blaxel, Cloudflare, Daytona, E2B, Modal and Vercel sandbox clients, but no Runloop client (`package.json` `exports`) |

Python's LiteLLM and any-llm model adapters (`extensions/models/`) have no JavaScript port. The JavaScript SDK reaches other providers through `aisdk()` instead, so I count that difference as a different design rather than a gap.

### Weaker: two features

| Feature | Python 0.24.0 | TypeScript 0.21.0 |
|---|---|---|
| Per-run history limit | `SessionSettings(limit=N)` through `RunConfig.session_settings` (`memory/session_settings.py:31`; `docs/sessions/index.md:100`) | `Session.getItems(limit?)` exists (`agents-core dist/memory/session.d.ts:33`), but the run options have no limit; trim history in a `sessionInputCallback` (`dist/run.d.ts:160`) |
| Listed tracing integrations | 31 third-party processors under "External tracing processors list" (`docs/tracing.md:223`) | 5 on the same list (`guides/tracing.mdx:126`). The processor API is the same, `addTraceProcessor` and `setTraceProcessors` (`agents-core dist/tracing/index.d.ts`), so the gap is in vendor support, not in the SDK |

### Docs-only: none found

The JavaScript SDK has its own docs site, so Python-only pages don't hide JavaScript features. Every JavaScript feature I checked has its own page or example, including tool namespaces, programmatic tool calling, retry policies, `callModelInputFilter`, tool search and the Codex tool.

### TypeScript-only: browser and telephony transports and the AI SDK bridge

- **Browser WebRTC:** `OpenAIRealtimeWebRTC` (`agents-realtime dist/openaiRealtimeWebRtc.d.ts:69`). The Python docs state that the Python SDK provides no browser WebRTC transport (`docs/realtime/transport.md:7`).
- **Telephony and edge transports:** `TwilioRealtimeTransportLayer` and `CloudflareRealtimeTransportLayer` in `@openai/agents-extensions`. Python ships no such class in `src/agents/`.
- **Vercel AI SDK bridge:** `aisdk()` runs an agent on any AI SDK provider model (`agents-extensions dist/ai-sdk/index.d.ts:99`), and `createAiSdkUiMessageStreamResponse` streams a run to AI SDK UI (`dist/ai-sdk-ui/uiMessageStream.d.ts:19`).

A TypeScript builder on this SDK should plan to write a durable `Session`, because only memory and OpenAI-hosted sessions ship. Start from the repo's `examples/memory/` samples, and add encryption and history limits in that class.

## LangChain: TypeScript lacks the shell and file-search middleware, checkpoint encryption and test suites

`langchain` 1.6.1 has every middleware hook and nearly every provider-agnostic built-in that Python `langchain` 1.4.8 has: summarization, human-in-the-loop, call limits, retries, fallback, PII, context editing, tool selection, tool emulation, todo lists and tool errors. LangGraph JS 1.6.0 also matches Python `langgraph` 1.2.19 on the graph and functional APIs, interrupts, the store, node caching and delta channels. The gaps cluster in two Python-only middleware, checkpoint tooling and a few LangGraph conveniences.

**Sources:** [`langchain-ai/langchain`](https://github.com/langchain-ai/langchain) at tag `langchain==1.4.8` (commit `5dcec185`, 2026-11-02), whose `libs/core` declares `langchain-core` 1.7.4. [`langchain-ai/langgraph`](https://github.com/langchain-ai/langgraph) at tag `1.2.19` (commit `5bd231cb`, 2026-10-30). Python paths start at `libs/`. TypeScript types from `langchain` 1.6.1, `@langchain/core` 1.3.4, `@langchain/langgraph` 1.6.0 and its `@langchain/langgraph-checkpoint` 1.2.3. Docs from the bilingual [mirror](../reference/langchain/source/) at `langchain-ai/docs` commit `9d9747d0` (2026-11-17), cited as `src/oss/...`. A `:::python` block with no `:::js` counterpart marks a Python-only section.

### Lacks: eight features

| Feature | Python | TypeScript |
|---|---|---|
| Shell tool middleware, with host, Docker and Codex-sandbox execution policies | `ShellToolMiddleware` (`langchain_v1/langchain/agents/middleware/shell_tool.py:518`); `HostExecutionPolicy`, `CodexSandboxExecutionPolicy`, `DockerExecutionPolicy` (`_execution.py:92`, `:191`, `:267`); `:::python` section "Shell tool" (`langchain/middleware/built-in.mdx:2503`) | No shell middleware among the 21 factories in `langchain dist/agents/middleware/index.d.ts` |
| File search middleware (glob and grep) | `FilesystemFileSearchMiddleware` (`middleware/file_search.py:108`); `:::python` "File search" (`built-in.mdx:2828`) | No file-search middleware |
| Per-middleware trace policy | `TracePolicy`, `omit_payload` and `configure_trace_policy` (`middleware/_trace_policy.py:22`); `:::python` "Configure tracing" (`langchain/middleware/custom.mdx:1179`) | `@langchain/core` declares a `TracePolicy` type (`dist/tracers/trace_policy.d.ts:9`), but no `langchain` `.d.ts` mentions it, so middleware can't set one |
| Encrypted checkpoints | `EncryptedSerializer` (`checkpoint/langgraph/checkpoint/serde/encrypted.py:8`); `:::python` "Encryption" (`langgraph/checkpointers.mdx:787`) | `langgraph-checkpoint dist/serde/` holds only `base`, `types` and `jsonplus` |
| Checkpointer conformance suite | The `langgraph-checkpoint-conformance` package: `checkpointer_test` and `validate` (`checkpoint-conformance/.../initializer.py:59`, `validate.py:45`); `:::python` "Testing with the conformance suite" (`checkpointers.mdx:1226`) | No conformance helper in any installed `.d.ts` |
| Managed step values | `RemainingSteps` and `IsLastStep` (`langgraph/langgraph/managed/is_last_step.py:15`, `:24`); the JS docs call it "Python `RemainingSteps`" (`langgraph/graph-api.mdx:656`) | No `RemainingSteps` or `IsLastStep` in `@langchain/langgraph`; read the step from config instead |
| Redis node cache | `RedisCache` (`checkpoint/langgraph/cache/redis/__init__.py:10`) | `langgraph-checkpoint dist/cache/` holds only `InMemoryCache` |
| Unified `version="v2"` stream format | `stream(..., version="v2")` yields `StreamPart` dicts (`langgraph/langgraph/pregel/main.py:2720`; `types.py:352`); `:::python` sections in `langgraph/streaming.mdx:100` and `langchain/streaming.mdx:1096` | `PregelOptions` has no `version` option (`langgraph dist/pregel/types.d.ts:114`). Event streaming, `streamEvents(..., { version: "v3" })`, exists in both and is the docs' recommended path (`langchain/event-streaming.mdx:8`) |

Python's `ModelRouterMiddleware` and `AutoModeMiddleware` appear under `:::python` headings (`built-in.mdx:2293`, `:2326`), but they require `langchain>=1.5.0`, which is newer than the Python pin. TypeScript 1.6.1 already exports OpenAI-specific versions, `openAIModelRouterMiddleware` and `openAIAutoModeMiddleware`. Checkpointer backends are at rough parity: both languages list SQLite, Postgres and MongoDB, Python adds Azure Cosmos DB, and JavaScript adds Redis (`checkpointers.mdx:722-733`).

### Weaker: two features

| Feature | Python | TypeScript |
|---|---|---|
| Client-side rate limiting | `InMemoryRateLimiter` (`core/langchain_core/rate_limiters.py:67`), passed to any chat model as `rate_limiter`; `:::python` "Rate limiting" (`langchain/models.mdx:1753`) | Only `maxConcurrency` on the async caller (`core dist/utils/async_caller.d.ts:16`), which caps parallel calls but not requests per second |
| Typed model errors | Eight `ModelError` subclasses, from `ModelAuthenticationError` to `ContextOverflowError` (`core/langchain_core/exceptions.py:68-123`); `:::python` "Model exceptions" (`models.mdx:1721`) | Three classes, `LangChainError`, `ModelAbortError` and `ContextOverflowError`, plus string codes such as `MODEL_RATE_LIMIT` (`core dist/errors/index.d.ts`) |

### Docs-only: four features

| Feature | Python-only docs | TypeScript evidence |
|---|---|---|
| Tool-error middleware | The "Tool error" section under `built-in.mdx:74` has a `:::python` body and no `:::js` body | `toolErrorMiddleware` (`langchain dist/agents/middleware/index.d.ts`) |
| Runtime-configurable models | `:::python` "Configurable models" (`models.mdx:2066`) | `initChatModel` takes `configurableFields` (`langchain dist/chat_models/universal.d.ts:130`) |
| Sub-agent attribution in streams | `:::python` "Streaming from sub-agents", which reads `lc_agent_name` (`langchain/streaming.mdx:916`) | The sub-agent transformer records `lc_agent_name` (`langchain dist/agents/transformers/subagent.d.ts:11`) |
| Delta channels in custom checkpointers | `:::python` "Delta channel support" (`checkpointers.mdx:1084`) | `DeltaChannel` (`langgraph dist/channels/delta.d.ts:63`) |

### TypeScript-only: provider middleware ships in the core package

`langchain` 1.6.1 exports `anthropicPromptCachingMiddleware`, `bedrockPromptCachingMiddleware`, `openAIModerationMiddleware`, `openAIModelRouterMiddleware` and `openAIAutoModeMiddleware` from `langchain` itself. Python offers prompt caching and moderation through the provider packages instead (`built-in.mdx:3281-3297`), and it added provider-agnostic router and auto-mode middleware in 1.5.0. The difference is packaging and release timing more than capability.

A TypeScript builder on LangChain should treat every `:::python` section as unconfirmed and check the 1.6.1 `.d.ts` first. Python-only headings both hide real gaps, such as checkpoint encryption, and hide exports that JavaScript has, such as `toolErrorMiddleware`. Plan to write your own shell and file-search tools, and encrypt checkpoints in your storage layer.

## GitHub Copilot SDK: TypeScript is a first-class SDK and lacks only Rust extras

GitHub ships the Copilot SDK in six languages from one repository, and all six drive the same runtime over the same JSON-RPC protocol, so TypeScript is a peer rather than a port. The S8 reference compared the six READMEs at tag `v1.0.31` ([guide §15](../reference/copilot-sdk/guide.md#15-six-official-sdks-share-one-runtime-and-typescript-is-first-class); evidence in [`verify/copilot-sdk/results/parity-draft.md`](../../verify/copilot-sdk/results/parity-draft.md)). Its findings, against `@github/copilot-sdk` 1.0.31 `dist/types.d.ts`:
- **Lacks (1):** connecting over caller-supplied streams, Rust's `Client::from_streams`. `RuntimeConnection` offers only `forStdio`, `forTcp`, `forUri` and `forInProcess`.
- **Weaker (2):** permission policy builders, where Rust has `deny_all` and `approve_if` and TypeScript has only `approveAll`; and command-line arguments, where Rust has separate `prefix_args` and `extra_args` and TypeScript has one `args` list.
- **Not gaps:** Rust's transport enum, typed IDs and pre-start event observers have TypeScript equivalents or are language idioms.

The Rust README calls cross-SDK parity for these extras "a post-release conversation" (`rust/README.md`). A TypeScript builder keeps every core feature here and needs only a small permission handler in place of the missing builders.

## Claude Agent SDK: TypeScript leads Python and trails it in two small places

The Claude Agent SDK runs the same Claude Code CLI from both languages, and the TypeScript package is the richer of the two. So this section runs the comparison both ways. I compared `@anthropic-ai/claude-agent-sdk` 0.3.327 (`sdk.d.ts`, published 2026-11-17) with Python `claude-agent-sdk` 0.2.183 at [`anthropics/claude-agent-sdk-python`](https://github.com/anthropics/claude-agent-sdk-python) tag `v0.2.183` (commit `3e19ce8d`, 2026-11-16). Python paths are relative to `src/claude_agent_sdk/`. Docs are cited by URL, because their license bars us from copying them.

Python `ClaudeSDKClient` (`client.py:26`) and TypeScript's streaming `query()` cover the same ground, and every Python session helper, such as `list_sessions`, `fork_session`, `tag_session` and their `SessionStore` variants, has a TypeScript twin in `sdk.d.ts`. Python's custom `Transport` class (`_internal/transport/__init__.py:8`) maps onto TypeScript's `spawnClaudeCodeProcess` option (`sdk.d.ts:2654`), which can return any process-like stream pair, for example one that runs in a VM.

### Weaker: two features

| Feature | Python 0.2.183 | TypeScript 0.3.327 |
|---|---|---|
| Session-store conformance suite | `run_session_store_conformance` ships in the package (`testing/session_store_conformance.py:54`) | No export. The [session storage page](https://code.claude.com/docs/en/agent-sdk/session-storage) tells TypeScript users to copy `shared/conformance.ts` from the TypeScript repo's examples |
| Run the CLI as another OS user | `ClaudeAgentOptions.user`, passed to the subprocess as `user=` (`_internal/transport/subprocess_cli.py:835`) | No `user` option on `Options` (`sdk.d.ts:1658`); do it inside `spawnClaudeCodeProcess` |

### TypeScript-only: most hooks and the runtime control methods

The TypeScript package declares four kinds of surface that Python lacks:
- **Hooks:** `HOOK_EVENTS` lists 33 events (`sdk.d.ts:1032`), and Python's `HookEvent` lists 10 (`types.py:286`). The [hooks page](https://code.claude.com/docs/en/agent-sdk/hooks) marks the other 23, among them `SessionStart`, `SessionEnd`, `PostToolBatch` and `PermissionDenied`, as TypeScript-only.
- **Runtime control:** the `Query` interface (`sdk.d.ts:3165`) adds methods that `ClaudeSDKClient` lacks, such as `applyFlagSettings`, `setMcpServers`, `supportedModels` and `reloadPlugins`. The [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) marks `applyFlagSettings` as TypeScript-only.
- **Options:** `persistSession` (`sdk.d.ts:1955`), marked TypeScript-only on the [sessions page](https://code.claude.com/docs/en/agent-sdk/sessions), as are binary MCP resource blobs on the [custom tools page](https://code.claude.com/docs/en/agent-sdk/custom-tools).
- **Packaging:** browser and bridge entry points (`package.json` `exports`: `./browser`, `./bridge`).

A TypeScript builder on Claude gets the fuller SDK. Copy the conformance file if you write a `SessionStore`, and set the OS user in your spawner.

## What this report could not verify

- **Primary-language behavior.** No Python, Rust or other non-TypeScript code ran. Each "lacks" row rests on a class or option name in the primary source and its absence from the TypeScript `.d.ts`; each "weaker" row rests on declared options.
- **Separate TypeScript packages outside the pins.** LangChain's JavaScript MCP adapter (`@langchain/mcp-adapters`) and the Postgres, SQLite, MongoDB and Redis checkpointers are separate npm packages that our harness doesn't install. Python's built-in `langchain.mcp.MCPAdapter` (`langchain_v1/langchain/mcp/adapter.py:125`) and its Python-only connection patterns (`langchain/mcp/connections.mdx:41`) therefore stay unclassified.
- **Newer releases.** As of 2026-11-18, `openai-agents` 0.25.0, `langchain` 1.5.0, `langgraph` 1.2.22 and `claude-agent-sdk` 0.2.184 are out on PyPI, and `@openai/agents` 0.22.0, `langchain` 1.6.6 and `@langchain/langgraph` 1.7.5 are out on npm. Some gaps may have closed or opened since the pins.
- **Partner packages.** LangChain's provider middleware (`langchain-anthropic`, `langchain-aws`, `langchain-openai`) and ADK's third-party integrations were read from docs only.
- **Kotlin, Go and Java ADK, and the non-Rust Copilot siblings,** beyond their READMEs.

## What a TypeScript builder should do: check the `.d.ts`, then budget for the batteries

The TypeScript packages give you the same agent loop as their primaries, so no SDK on this list should be ruled out on parity alone. What you will write yourself depends on the SDK: durable and encrypted sessions for OpenAI, shell and file-search tools and checkpoint encryption for LangChain, and context caching, rewind and parallel tool calls for ADK. Before you design around a feature, find it in the pinned package's `.d.ts`, because Python-first docs mislead in both directions. They list Python features the port lacks, and they hide port features behind Python-only tags, which ADK does 15 times and LangChain 4. Then record each gap you hit in that SDK's fact-check, and re-run this comparison at each upgrade.
