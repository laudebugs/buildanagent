# Web/React frameworks and libraries for agent and chat UIs (as of November 2026)

Scope: how each library implements its UI — client state model, wire format, tool/generative UI, human-in-the-loop (HITL), resumable streams, shared state, persistence, backends, license, version. Versions come from the npm/PyPI registries fetched on 2026-11-18. Doc pages were fetched the same day; mirrored pages cite the upstream tag/commit recorded in this repo's `docs/reference/<sdk>/source/_manifest.json`.

Source note: the GitHub API was not reachable from this session (403 from the session proxy), so star counts and GitHub release lists are missing. Raw files from raw.githubusercontent.com, the npm registry, PyPI and the docs sites were reachable.

## Versions and licenses (as of November 2026)

### Takeaway
Every major React library is MIT or Apache-2.0 and ships releases weekly or faster. Two exceptions stand out: Open WebUI uses its own branding-preserving license, and Vercel's `ai-elements` repo is being deprecated in favour of shadcn/ui at the end of November 2026.

### Cited Findings
- `ai` 7.0.176 (2026-11-17, Apache-2.0); `@ai-sdk/react` 4.0.180 (2026-11-17); `@ai-sdk/rsc` 3.0.176 (2026-11-17). Older lines are kept on dist-tags `ai-v6` (6.0.333) and `ai-v5` (5.0.291) — [npm registry: ai](https://registry.npmjs.org/ai), [@ai-sdk/react](https://registry.npmjs.org/@ai-sdk/react), [@ai-sdk/rsc](https://registry.npmjs.org/@ai-sdk/rsc)
- `resumable-stream` 2.2.13 (2026-09-16, ISC) — [npm](https://registry.npmjs.org/resumable-stream)
- `ai-elements` CLI 1.9.1 (2026-10-14, Apache-2.0) — [npm](https://registry.npmjs.org/ai-elements)
- `@copilotkit/react-core` and `@copilotkit/react-ui` 1.89.0 (2026-11-17, MIT). `@copilotkitnext/react` (last 1.54.1, 2026-03-26) is deprecated with the message "Moved into @copilotkit/react-core. Import from '@copilotkit/react-core/v2'." — [npm: react-core](https://registry.npmjs.org/@copilotkit/react-core), [npm: @copilotkitnext/react](https://registry.npmjs.org/@copilotkitnext/react)
- `@ag-ui/core` and `@ag-ui/client` 1.0.5 (2026-11-17, MIT) — [npm](https://registry.npmjs.org/@ag-ui/core)
- `@assistant-ui/react` 0.15.37, `@assistant-ui/react-ai-sdk` 1.4.24 and `@assistant-ui/react-langgraph` 0.14.41 (all 2026-11-18, MIT) — [npm](https://registry.npmjs.org/@assistant-ui/react)
- `@langchain/langgraph-sdk` 1.17.0 (2026-11-17, MIT); `@langchain/react` 1.3.0 (2026-11-17, MIT, with an `rc` tag at 2.0.0-rc.1) — [npm: langgraph-sdk](https://registry.npmjs.org/@langchain/langgraph-sdk), [npm: @langchain/react](https://registry.npmjs.org/@langchain/react)
- Cloudflare `agents` 0.33.0 (2026-11-03, MIT); `@cloudflare/ai-chat` 0.12.2 (2026-10-20, MIT) — [npm: agents](https://registry.npmjs.org/agents), [npm: @cloudflare/ai-chat](https://registry.npmjs.org/@cloudflare/ai-chat)
- `@openai/chatkit` 1.9.0 and `@openai/chatkit-react` 1.6.1 (both 2026-07-31, MIT) — [npm](https://registry.npmjs.org/@openai/chatkit-react)
- `@mastra/client-js` 1.61.1 and `@mastra/react` 1.15.2 (2026-11-18, Apache-2.0 per npm metadata) — [npm](https://registry.npmjs.org/@mastra/react)
- `@llamaindex/chat-ui` 0.6.1, last published 2025-08-28 (MIT), so no release in about 15 months — [npm](https://registry.npmjs.org/@llamaindex/chat-ui)
- PyPI: `google-adk` 2.14.1 (2026-11-12); `gradio` 6.32.0 (2026-11-12); `streamlit` 1.67.0 (2026-11-05); `chainlit` 2.12.0 (2026-08-25, Apache-2.0); `open-webui` 0.13.4 (2026-11-17, "Open WebUI License") — [PyPI google-adk](https://pypi.org/pypi/google-adk/json), [gradio](https://pypi.org/pypi/gradio/json), [streamlit](https://pypi.org/pypi/streamlit/json), [chainlit](https://pypi.org/pypi/chainlit/json), [open-webui](https://pypi.org/pypi/open-webui/json)
- Open WebUI's README: "Includes code under the Open WebUI License, which requires preserving the Open WebUI branding" — [open-webui README](https://raw.githubusercontent.com/open-webui/open-webui/main/README.md)
- adk-web carries an Apache-2.0 badge — [google/adk-web README](https://raw.githubusercontent.com/google/adk-web/main/README.md)

### Inferences
- Chainlit's PyPI cadence (last release in August 2026) is slower than Gradio's or Streamlit's; that fits community reports that it moved to community maintenance, but I did not verify those reports (see Gaps).

### Gaps
- GitHub stars and release lists could not be fetched (GitHub API blocked in this session).
- The PyPI `license` field was empty for gradio, streamlit and google-adk; I did not re-verify their LICENSE files (all three are widely known to be Apache-2.0, but that comes from prior knowledge, not a source fetched here).

## Vercel AI SDK UI (`@ai-sdk/react` useChat, UIMessage, UI message stream, transports, resumable streams, approval) and AI SDK RSC

### Takeaway
AI SDK UI is the reference design: the client holds `UIMessage[]`, each message made of typed `parts` (text, reasoning, `tool-<name>` with a seven-state lifecycle, `data-*`, sources, files, step markers). It consumes an SSE "UI message stream" of typed JSON chunks (`x-vercel-ai-ui-message-stream: v1`) through a pluggable `ChatTransport` (HTTP default, WebSocket and in-process Direct in v7). Resumption needs Redis plus the `resumable-stream` package. RSC `streamUI` is still "experimental" and not recommended for production.

### Cited Findings
**State model**
- `UIMessage<METADATA, DATA_PARTS, TOOLS>` has `id`, `role: 'system'|'user'|'assistant'`, optional typed `metadata`, and `parts`. `UIMessagePart` = `TextUIPart | CustomContentUIPart | ReasoningUIPart | ToolUIPart<TOOLS> | DynamicToolUIPart | SourceUrlUIPart | SourceDocumentUIPart | FileUIPart | ReasoningFileUIPart | DataUIPart<DATA_TYPES> | StepStartUIPart` — `ai@7.0.162` `dist/index.d.ts` (installed at `node_modules/.pnpm/ai@7.0.162_zod@4.6.7`), source [vercel/ai @ ai@7.0.162](https://github.com/vercel/ai/tree/ai@7.0.162)
- Tool part states in the typings: `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`, `output-error`, `output-denied` — same `index.d.ts`
- `useChat` returns `status` with values `submitted`, `streaming`, `ready` and `error`, plus `stop()`, `regenerate()`, `setMessages`, `error`, and an `experimental_throttle` option for UI updates — [Chatbot docs @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/02-chatbot.mdx)

**Wire format**
- The "Data Stream Protocol" is SSE, enabled with the response header `x-vercel-ai-ui-message-stream: v1`. Chunks: `start` (messageId), `text-start/-delta/-end` (id), `reasoning-start/-delta/-end`, `reasoning-file`, `source-url`, `source-document`, `file`, `custom` (provider-specific `kind`, e.g. `openai.compaction`), `data-<name>`, `error`, `tool-input-start/-delta/-available`, `tool-approval-request` (toolCallId, approvalId, approvalDescriptor, reason), `tool-approval-response`, `tool-output-available`, `tool-output-denied`, `start-step`, `finish-step`, `reset-step`, `finish`, `abort`. The stream ends with `data: [DONE]`. A plain text stream protocol also exists — [Stream Protocols @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/50-stream-protocol.mdx)
- On the server, `createUIMessageStream({ execute({ writer }) })` and `createUIMessageStreamResponse` write custom parts. Data parts with the same `id` are reconciled (updated in place), and `transient: true` parts reach `onData` but are not added to message history — [Streaming Custom Data @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/20-streaming-data.mdx)

**Transports**
- `DefaultChatTransport` (HTTP POST, configurable `api`, headers, body and `prepareSendMessagesRequest`). `WebSocketChatTransport` shares one persistent WebSocket across turns, with a documented wire protocol, `WebSocketChatTransportRequest/Response` types and `safeValidateWebSocketChatTransportRequest`; its `reconnectToStream` "requests a complete replay of the retained response". `DirectChatTransport({ agent })` calls an Agent's `stream()` in-process without HTTP — [Transport @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/21-transport.mdx)

**Tool rendering and HITL**
- Tools render by switching on `part.type === 'tool-<name>'` and `part.state`. Client-side tools are handled in `onToolCall` and answered with `addToolOutput` (errors with `state: 'output-error'`). `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` resubmits automatically once all results are in. Check `toolCall.dynamic` first for dynamic tools — [Chatbot Tool Usage @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx)
- Approval: a server tool with an approval requirement surfaces as `state: 'approval-requested'`, and the UI answers with `addToolApprovalResponse({ id, approved, reason })`. Automatic approvals and denials flow through the same states with `part.approval.isAutomatic === true`. A denied tool ends in `output-denied`, and `part.approval.descriptor` carries scope metadata — same page

**Resumable streams**
- `useChat({ resume: true })` sends `GET /api/chat/[id]/stream` on mount. The server uses `consumeSseStream` with `createResumableStreamContext` from `resumable-stream` (Redis pub/sub) and stores `activeStreamId` on the chat. Resumed streams are full replays by default (`resumeStreamIsReplay: false` for tail-only). The hook also reconnects when the page becomes visible again after a network drop — [Chatbot Resume Streams @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx)
- Caveat: "In a resumable stream setup, client-side aborts are treated as disconnects." `stop()` only closes the HTTP connection, so a real stop needs a dedicated stop endpoint — same page

**Persistence**
- Persistence is app-owned. Load the stored `UIMessage[]` and pass it to `useChat`. Validate on the server with `validateUIMessages`, convert with `convertToModelMessages`, and save in `toUIMessageStreamResponse({ originalMessages, onFinish })`. Server-side IDs come from `createIdGenerator`/`generateMessageId` — [Message Persistence @ ai@7.0.162](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/03-chatbot-message-persistence.mdx)

**RSC**
- "AI SDK RSC is currently experimental. We recommend using AI SDK UI for production." The migration guide says "we do not recommend using it for stable production environments" and "strongly recommend migrating to AI SDK UI" — [RSC overview](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/05-ai-sdk-rsc/01-overview.mdx), [Migrating to UI](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/05-ai-sdk-rsc/10-migrating-to-ui.mdx)
- `@ai-sdk/rsc` is still published in lockstep (3.0.176 on 2026-11-17) with no npm deprecation flag — [npm](https://registry.npmjs.org/@ai-sdk/rsc)

**AI Elements**
- "AI Elements is moving to shadcn/ui. This project will be deprecated at the end of November 2026 and replaced by AI Elements from shadcn/ui." It is a shadcn-registry component library (conversation, message, code block, reasoning displays, etc.) installed with `npx ai-elements@latest` or the shadcn CLI — [vercel/ai-elements README](https://raw.githubusercontent.com/vercel/ai-elements/main/README.md)

### Inferences
- Approval is part of the tool part state machine and the wire chunks (`tool-approval-request/response`), not a side channel. That design lets any AI-SDK-compatible backend (Cloudflare `AIChatAgent`, Mastra, assistant-ui's AI SDK runtime) reuse the same UI.
- Since v7 the SDK covers WebSocket transport itself, which narrows the gap with Cloudflare's WebSocket chat.

### Gaps
- I did not read the `WebSocketChatTransport` reference page with the frame-level wire protocol, or the generative-user-interfaces page (it is not at the guessed path at the tag).

## CopilotKit

### Takeaway
CopilotKit is now a "v2" API inside `@copilotkit/react-core/v2` (the separate `@copilotkitnext/*` packages were folded in). It speaks AG-UI to any backend through `@copilotkit/runtime` and `HttpAgent`. It has seven generative-UI primitives, two HITL hooks (`useHumanInTheLoop` for LLM-initiated pauses, `useInterrupt` for graph-initiated ones), and two-way shared state via `useAgent().agent.state/setState`. Durable replay and reconnect are a paid hosted add-on ("Intelligence").

### Cited Findings
- `@copilotkitnext/react` is deprecated: "Moved into @copilotkit/react-core. Import from '@copilotkit/react-core/v2'." — [npm](https://registry.npmjs.org/@copilotkitnext/react)
- Generative UI primitives: Components as Tools (`useComponent`), Tool Call Rendering (`useRenderTool` for backend tools), State Rendering, Reasoning, A2UI (declarative schema against a registered catalog, fixed or dynamic schema), MCP Apps (sandboxed iframe) and Open Generative UI (agent-generated sandboxed HTML/CSS/JS) — [CopilotKit Generative UI overview](https://docs.copilotkit.ai/concepts/generative-ui-overview.md)
- HITL: "`useHumanInTheLoop` — The LLM, by calling a registered client-side tool (Zod schema + render)"; "`useInterrupt` — Your agent code … for example LangGraph `interrupt()` or Mastra `suspend()`" — [CopilotKit HITL overview](https://docs.copilotkit.ai/human-in-the-loop.md)
- Shared state: `const { agent } = useAgent(); agent.state…; agent.setState({...})`. Components re-render when the agent emits state — [CopilotKit Shared State](https://docs.copilotkit.ai/shared-state.md)
- ADK wiring in the ADK docs: Python `ag_ui_adk.ADKAgent.from_app(...)` plus `add_adk_fastapi_endpoint(app, agent, path="/ag-ui")`; the TS runtime uses `new HttpAgent({ url })` from `@ag-ui/client` with `@copilotkit/runtime/v2`; the React side uses `<CopilotKit>`, `<CopilotChat>`, `useFrontendTool`, `useAgentContext` and `useAgent` from `@copilotkit/react-core/v2` — [ADK docs: CopilotKit integration @ ff7a5f5](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/integrations/copilotkit.md)
- Persistence and resumption: "AG-UI Streams" (formerly "Rich Threads") in CopilotKit Intelligence record AG-UI events for "Reconnect and catch up", "Continue in the background", and cross-device delivery. "These are capabilities of CopilotKit Intelligence, not guarantees provided by the AG-UI protocol alone." It is not execution recovery after a server failure — [CopilotKit AG-UI Streams](https://docs.copilotkit.ai/AG-UI-Streams.md); a free plan is mentioned in [CopilotKit llms.txt](https://docs.copilotkit.ai/llms.txt)
- Backends via AG-UI: LangGraph, Google ADK, Mastra and custom backends, plus a built-in agent — [CopilotKit llms.txt](https://docs.copilotkit.ai/llms.txt)
- AG-UI event families (protocol docs on main): lifecycle (`RunStarted`, `RunFinished`, `RunError`, `StepStarted/Finished`), text message (`TextMessageStart/Content/End/Chunk`), tool call (`ToolCallStart/Args/End/Result/Chunk`), state (`StateSnapshot`, `StateDelta`, `MessagesSnapshot`), activity (`ActivitySnapshot/Delta`), reasoning (`ReasoningStart/MessageStart/Content/End/EncryptedValue`, with "Thinking" events deprecated), subagent (`SubagentStarted/Finished/Error`), and `Raw`/`Custom` — [ag-ui docs/concepts/events.mdx (main)](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/docs/concepts/events.mdx)

### Inferences
- CopilotKit's v1 hooks (`useCopilotAction`, `useCoAgent`) appear only as legacy names; the current docs use `useFrontendTool`, `useComponent`, `useRenderTool`, `useHumanInTheLoop`, `useInterrupt` and `useAgent`. I did not open a v1-to-v2 migration page to confirm a 1:1 mapping.
- `StateDelta` is JSON Patch in AG-UI (prior knowledge; I did not re-read that section).

### Gaps
- Exact v1 vs v2 status (is v1 deprecated or only "legacy"?) was not confirmed from a migration page.
- I did not read the AG-UI `StateDelta` payload format or the event JSON field names.

## assistant-ui

### Takeaway
assistant-ui is a headless primitives layer (Radix/shadcn-style `Thread`, `Message`, `Composer`, `ThreadList`, message parts) over a swappable "runtime" that owns conversation state (messages, branching, editing, run lifecycle). First-party adapters cover the AI SDK, LangGraph, LangChain `useStream`, Google ADK, A2A and AG-UI. `LocalRuntime`/`ExternalStoreRuntime` are the escape hatches, and Assistant Cloud provides hosted persistence.

### Cited Findings
- Three pillars: frontend components (shadcn-based), a Runtime ("A React state management context … handles data conversions between the local state and calls to backends"), and Assistant Cloud (hosted thread persistence and history). "The runtime owns or adapts conversation state: messages, thread state, composer state, run lifecycle, branching, editing, regeneration." UI primitives "read and write through the runtime context, not directly against the backend" — [assistant-ui Architecture](https://www.assistant-ui.com/docs/architecture.md)
- First-party adapters: Vercel AI SDK ("v7 current; v6 / v5 / v4 legacy"), Eve, LangGraph ("Direct integration with @langchain/langgraph-sdk. Subgraph events, UI messages"), LangChain useStream ("Wraps @langchain/react's useStream"), Google ADK ("Tool confirmations, auth flows, multi-agent"), A2A v1.0, AG-UI and OpenCode (experimental). Integration guides route the OpenAI Agents SDK, Mastra and Cloudflare Agents through the AI SDK runtime, Pydantic AI through AG-UI, and Claude Managed Agents through the external store runtime ("event-log replay, approval gates, sessions as threads") — [assistant-ui: Picking a runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime.md)
- Tool UI API pages exist for component tools, rendering, status, toolkits and "interactables", and the runtime API covers ThreadRuntime, ThreadListRuntime, MessagePartRuntime and ExternalStore message conversion — [assistant-ui llms.txt](https://www.assistant-ui.com/llms.txt)

### Inferences
- assistant-ui is the most backend-agnostic option. It does not define a wire format; each adapter maps a backend protocol (UI message stream, LangGraph stream modes, AG-UI, A2A) onto its internal thread and message-part model.

### Gaps
- I did not read the tool-approval rendering page or the ExternalStoreRuntime contract in detail (the `convertMessage` signature, and the `onNew`/`onEdit`/`onReload` callbacks are from prior knowledge).

## LangChain / LangGraph: `useStream`, agent-chat-ui, Generative UI, interrupts, server stream modes

### Takeaway
LangChain's v1 frontend SDK (`@langchain/react` `useStream`, plus Vue, Svelte and Angular versions) binds a UI to a LangGraph **thread**. It exposes typed graph state (`values`), messages, tool-call lifecycle, `stream.interrupt` and checkpoint history. HITL resumes with `stream.submit(null, { command: { resume } })`, and rejoining a running thread is native (`stream.disconnect()` vs `stop()`). Generative UI is server-pushed (`push_ui_message`/`typedUi`); components are bundled by the platform from `langgraph.json` and loaded into a shadow DOM with `LoadExternalComponent`.

### Cited Findings
- "The same hook that renders messages also exposes the agent's durable thread state, tool-call lifecycle, interrupts, checkpoint history, and custom state values." Capabilities: durable threads, typed agent state, tool-call lifecycle, interrupts, checkpoints (edit/retry/branch/time-travel), nested execution (subagents) and framework-native reactivity (React, Vue, Svelte, Angular). The pages use "the v1 frontend SDK packages" with migration guides in `langgraphjs/libs/sdk-react/docs/v1-migration.md` — [LangChain Frontend overview](https://docs.langchain.com/oss/javascript/langchain/frontend/overview.md)
- The hook is imported from `@langchain/react` (`import { useStream } from "@langchain/react"`), typed as `useStream<typeof myAgent>`. An interrupt surfaces as `stream.interrupt`, and the UI resumes with `stream.submit(null, { command: { resume: response } })`. The default is batched interrupts, with `interruptMode: "per_call"` available — [LangChain Frontend: Human-in-the-loop](https://docs.langchain.com/oss/javascript/langchain/frontend/human-in-the-loop.md)
- Join/rejoin: bind with `threadId`, persist new IDs with `onThreadId`, and call `stream.disconnect()` (alias for `stop({ cancel: false })`) to leave while the run continues; remount with the same `threadId` to reattach. "By default, `stream.stop()` cancels the active run" — [LangChain Frontend: Join & rejoin](https://docs.langchain.com/oss/javascript/langchain/frontend/join-rejoin.md)
- Other frontend pattern pages: tool-calling cards, headless (client-executed) tools, reasoning tokens, structured output, branching chat, message queues, time travel, and three generative-UI styles (controlled, declarative, open-ended), plus integration pages for AI Elements, assistant-ui, CopilotKit and OpenUI — [LangChain TS docs index](https://docs.langchain.com/_llms/agent-development-lifecycle/build/type-script.txt)
- Generative UI (LangSmith deployments): declare `"ui": { "<name>": "./src/ui.tsx" }` in `langgraph.json`, and the platform "will automatically bundle your UI components code and styles and serve them as external assets". In Python, nodes call `push_ui_message("weather", props, message=message)` with state `ui: Annotated[Sequence[AnyUIMessage], ui_message_reducer]`; in JS, `typedUi<typeof ComponentMap>(config)`. The client renders `<LoadExternalComponent stream={thread} message={ui} />` from `@langchain/langgraph-sdk/react-ui`, which "will fetch the JS and CSS … and render them in a shadow DOM". Updates stream before a node finishes through `onCustomEvent` and pushes with the same ID — [LangSmith: Generative UI in React](https://docs.langchain.com/langsmith/generative-ui-react.md)
- Server stream modes: `values` (full state per super-step), `updates` (per-node deltas), `messages-tuple` (LLM tokens + metadata), `debug`, `custom`, `events`; you can pass several modes as a list — [LangSmith Streaming API](https://docs.langchain.com/langsmith/streaming.md). OSS LangGraph also lists `tasks`, `checkpoints` and `tools` modes in its streaming docs — [langgraph/streaming.mdx @ 9d9747d](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langgraph/streaming.mdx)
- In-process HITL streaming: the `updates` stream yields `__interrupt__` with `action_requests`; resume with `Command(resume={interrupt.id: {"decisions": [...]}})`, keeping decisions in action order — [langchain/streaming.mdx @ 9d9747d](https://github.com/langchain-ai/docs/blob/9d9747d0cf241e086c616a16d5ce230ad8f8f31d/src/oss/langchain/streaming.mdx)
- agent-chat-ui: "a Next.js application which enables chatting with any LangGraph server with a `messages` key". Configured by `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_ASSISTANT_ID` (plus `NEXT_PUBLIC_AUTH_SCHEME=langsmith-api-key` for Agent Builder), it supports hidden messages and renders artifacts in a side panel via `thread.meta?.artifact` (`useArtifact`). Hosted at agentchat.vercel.app, scaffolded with `npx create-agent-chat-app` — [agent-chat-ui README](https://raw.githubusercontent.com/langchain-ai/agent-chat-ui/main/README.md)
- Deep Agents frontend pages cover subagent streaming cards, a todo list synced from agent state, a sandbox IDE, and an AG-UI exposure — [LangChain TS docs index](https://docs.langchain.com/_llms/agent-development-lifecycle/build/type-script.txt)

### Inferences
- Unlike the AI SDK, LangGraph's UI state is the graph state itself (checkpointed on the server per thread), so persistence and resumption come from the platform. The trade-off is that the full experience needs LangGraph Server (Agent Server/LangSmith Deployment) or a compatible API.
- `useStream` now lives in `@langchain/react`. `@langchain/langgraph-sdk/react` was the earlier home (prior knowledge); `react-ui` (LoadExternalComponent) still lives in the SDK package.

### Gaps
- I did not confirm the wire-level reconnection mechanism (e.g. `Last-Event-ID`/`stream_resumable` on `runs.joinStream`) from a page fetched this session.
- I did not check whether `useStream` from `@langchain/langgraph-sdk/react` is formally deprecated.

## Cloudflare Agents: `useAgent` and `@cloudflare/ai-chat` `useAgentChat`

### Takeaway
Cloudflare puts the whole conversation in a Durable Object. `useAgent` is a PartySocket WebSocket with auto-reconnect and two-way `state`/`setState` sync. `useAgentChat` layers the AI SDK `useChat`/`UIMessage` model over that socket with `cf_agent_*` frames. Messages and stream chunks persist to the DO's SQLite, so resume (with `replay: true` and `seq` dedupe) works without Redis.

### Cited Findings
- Client SDK: `useAgent`/`AgentClient` connect over WebSocket ("Auto-reconnection – Built on PartySocket"), with `agentFetch` for HTTP. Routes follow `/agents/<kebab-agent>/<name>`. State sync: `agent.setState()` sends to the agent, the server's `onStateChanged()` runs and the new state is broadcast; clients get `onStateUpdate(state, source)` — [Client SDK @ agents@0.33.0](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/client-sdk.md)
- Chat: `AIChatAgent` (server) and `useAgentChat` (client). "Messages are automatically persisted to SQLite, streams resume on disconnect, and tool calls work across server and client." `this.messages` is an array of AI SDK `UIMessage`. Also documented: `maxPersistedMessages`, `messageConcurrency` (`latest`/`debounce`/`drop`), `persistMessages`/`saveMessages`, `onChatResponse`, `autoContinue` for continuation turns after tool results, and `onChatRecovery` for "interrupted fiber" recovery after eviction — [Chat Agents @ agents@0.33.0](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/chat-agents.md)
- Resumable streaming: chunks persist to SQLite in batches of 10. The stream continues server-side on disconnect, and on reconnect the client gets buffered chunks flagged `replay: true` and applies them in one batch. A `seq` field dedupes continuation replays. `resume: true` is the default. `cancelOnClientAbort: false` is the default, while an explicit `stop()` cancels the server turn — [Resumable Streaming @ agents@0.33.0](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/resumable-streaming.md)
- Wire frames observed in the installed `@cloudflare/ai-chat@0.12.2` and `agents@0.33.0` dist bundles include `cf_agent_use_chat_request`, `cf_agent_use_chat_response`, `cf_agent_chat_messages`, `cf_agent_chat_clear`, `cf_agent_chat_request_cancel`, `cf_agent_tool_result`, `cf_agent_tool_approval`, `cf_agent_message_updated`, `cf_agent_stream_resume_request/_ack/_none`, `cf_agent_stream_resuming`, `cf_agent_stream_pending`, `cf_agent_chat_recovering`, `cf_agent_state`, `cf_agent_state_error`, `cf_agent_identity` and `cf_agent_mcp_servers` — local grep of `node_modules/.pnpm/@cloudflare+ai-chat@0.12.2_*/…/dist` and `agents@0.33.0_*/…/dist` (source: [cloudflare/agents @ @cloudflare/ai-chat@0.12.2](https://github.com/cloudflare/agents/tree/%40cloudflare/ai-chat%400.12.2))
- assistant-ui wires Cloudflare Agents "through the Vercel AI SDK runtime" — [assistant-ui: Picking a runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime.md)

### Inferences
- Tool approval reuses AI SDK `needsApproval` semantics and parts. The client sends a `cf_agent_tool_approval` frame instead of an HTTP resubmit. That frame name comes from the code; the docs page I grepped did not describe it. This repo's own `cloudflare-agents` skill and fact-check cover the approval flow in detail.

### Gaps
- I did not read the frame payload schemas.

## Google ADK web UI (`adk web`) and AG-UI integration

### Takeaway
`adk web` is a dev-only Angular-era debugging UI (google/adk-web, Apache-2.0) over ADK's FastAPI API server. Its views are chat, sessions, session-state inspection and editing, the event log, execution traces, eval sets, an agent graph and (Python) a Visual Builder. The data is ADK `Event` objects from `/run` or `/run_sse`. For production UIs, ADK points to AG-UI (`ag-ui-adk`) with CopilotKit, or to assistant-ui's ADK runtime.

### Cited Findings
- "ADK Web is not meant for use in production deployments." Features: chat interface, session management, "State inspection: View and modify session state", "Event history", and a Visual Builder (Python only). The telemetry list mentions builder mode, the "execution trace or event log viewers", "creating evaluation sets" and "the agent structure graph view". The Go flags include `-sse-write-timeout` and `-trace_capacity` (in-memory traces, default 10000) — [ADK Use the Web Interface @ ff7a5f5](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/runtime/web-interface/index.md)
- API server: `POST /run` returns all events as a list; `POST /run_sse` returns Server-Sent Events, one ADK `Event` JSON per `data:` line (`content.parts[]` with `text`/`functionCall`/`functionResponse`, `invocationId`, `author`, `actions.stateDelta`, `actions.artifactDelta`, `requestedAuthConfigs`, `longRunningToolIds`, `id`, `timestamp`). `"streaming": true` turns on token-level partial events. Sessions are created at `POST /apps/{app}/users/{user}/sessions/{session}` — [ADK Use the API Server @ ff7a5f5](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/runtime/api-server.md)
- "ADK web is the built-in dev UI that comes along with adk for easier development and debug" (google/adk-web, Apache-2.0) — [adk-web README](https://raw.githubusercontent.com/google/adk-web/main/README.md)
- AG-UI: "an open protocol that handles streaming events, client state, and bi-directional communication". The quickstart is `npx copilotkit@latest create -f adk`, which runs a UI on :3000 and the ADK agent API on :8000. The integration is listed for Python, TypeScript, Go and Java — [ADK AG-UI integration @ ff7a5f5](https://github.com/google/adk-docs/blob/ff7a5f56469a81f3e43a8fc54668d8dc84300192/docs/integrations/ag-ui.md)
- assistant-ui has a first-party Google ADK runtime ("Tool confirmations, auth flows, multi-agent, code execution") — [assistant-ui: Picking a runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime.md)

### Inferences
- The dev UI reads the same REST and SSE endpoints as `adk api_server` (the web-interface and API-server pages share options), so the "events view" renders raw ADK `Event` objects, and the trace view uses the server's in-memory trace store.
- The description of adk-web as "Angular-era" comes from prior knowledge; the README fragment I read did not name the framework.

### Gaps
- I did not verify which endpoints the trace and eval views call (e.g. `/debug/trace/...`).

## OpenAI ChatKit (brief)

### Takeaway
ChatKit is a drop-in, framework-agnostic chat component (`@openai/chatkit` web component plus `@openai/chatkit-react`). It authenticates with a server-minted client token and ships widgets, tool and workflow visualization, attachments and thread management. The last release was July 2026 (another researcher covers the protocol).

### Cited Findings
- "ChatKit is a framework-agnostic, drop-in chat solution." Features: "Deep UI customization", "Built-in response streaming", "Tool and workflow integration for visualizing agentic actions and chain-of-thought reasoning", "Rich interactive widgets rendered directly inside the chat", attachments, "Thread and message management" and "Source annotations and entity tagging". The quickstart generates a client token on the server — [openai/chatkit-js README](https://raw.githubusercontent.com/openai/chatkit-js/main/README.md)
- Versions: `@openai/chatkit` 1.9.0 and `@openai/chatkit-react` 1.6.1, both dated 2026-07-31, MIT — [npm](https://registry.npmjs.org/@openai/chatkit-react)

### Gaps
- Client tools and the widget schema were not re-read (out of scope; covered by another researcher).

## Others: Mastra, LlamaIndex chat-ui, Gradio, Streamlit, Chainlit, Open WebUI, LibreChat (brief)

### Takeaway
Most of these either reuse the AI SDK stream (Mastra, LlamaIndex chat-ui) or put tool display into message metadata (Gradio's `ChatMessage.metadata`). Open WebUI and LibreChat are full self-hosted apps, not libraries; LibreChat has added inline approvals, Ask-User questions and resumable background subagents.

### Cited Findings
- Mastra: assistant-ui wires Mastra "through the Vercel AI SDK runtime", and CopilotKit's `useInterrupt` maps to Mastra `suspend()` — [assistant-ui: Picking a runtime](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime.md), [CopilotKit HITL](https://docs.copilotkit.ai/human-in-the-loop.md). `@mastra/client-js` 1.61.1 and `@mastra/react` 1.15.2 — [npm](https://registry.npmjs.org/@mastra/react)
- LlamaIndex `@llamaindex/chat-ui`: "a React component library that provides ready-to-use UI elements for building chat interfaces", installable through a shadcn registry (`npx shadcn@latest add https://ui.llamaindex.ai/r/chat.json`) — [run-llama/chat-ui README](https://raw.githubusercontent.com/run-llama/chat-ui/main/README.md); last npm release 0.6.1 on 2025-08-28 — [npm](https://registry.npmjs.org/@llamaindex/chat-ui)
- Gradio: `gr.ChatMessage(content, role, metadata, options)`, where `MetadataDict` has `title`, `id`, `parent_id`, `log`, `duration` and `status: "pending"|"done"`. "If this dictionary includes a title for the message, it will be displayed in a collapsible accordion"; `parent_id` nests thoughts. This pattern works with `gr.Chatbot` and `gr.ChatInterface` — [Gradio guide: Agents and tool usage](https://www.gradio.app/guides/agents-and-tool-usage)
- Open WebUI: self-hosted app under the Open WebUI License (branding preservation); a sibling project, "Open WebUI Computer", offers "files, editor, terminal, git, and optional AI agents" — [open-webui README](https://raw.githubusercontent.com/open-webui/open-webui/main/README.md)
- LibreChat README highlights: "Agent Channels (beta)" for Slack "with linked accounts, approvals"; "SDK-backed Agents (experimental): Register local or remote runtimes with authorized host-tool access"; "MCP Apps, deferred Tool Search, clearer approvals"; "Answer inline Ask User questions and follow resumable background Subagents" — [LibreChat README](https://raw.githubusercontent.com/danny-avila/LibreChat/main/README.md)

### Inferences
- The industry has converged on two tool-display models. Typed tool parts with a state machine (AI SDK, LangChain, CopilotKit, assistant-ui) suit React apps. Metadata-annotated assistant messages that render as collapsible "thought" blocks (Gradio, likely Chainlit's Steps) suit Python app builders.

### Gaps
- Chainlit: the README grep returned nothing useful. The Step/`@cl.step` model, its Socket.IO transport, and its community-maintenance status are unverified here.
- Streamlit: `st.chat_message`/`st.write_stream` are from prior knowledge and were not fetched this session.
- Mastra playground/Studio internals and `@mastra/react` hooks were not read.

## Cross-cutting comparison

### Takeaway
Resumability and persistence decide the architecture more than the component library does. The AI SDK leaves both to the app (Redis plus `resumable-stream`). Cloudflare and LangGraph make the server-side thread the source of truth and get rejoin for free. CopilotKit sells it as a hosted layer over AG-UI. assistant-ui sits on top of any of them.

### Cited Findings
- Stop semantics differ in a way that matters. In the AI SDK with resume, `stop()` is only a disconnect, so a cancel endpoint is needed — [AI SDK Resume Streams](https://github.com/vercel/ai/blob/ai@7.0.162/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx). In LangChain, `stop()` cancels the run and `disconnect()` leaves it running — [Join & rejoin](https://docs.langchain.com/oss/javascript/langchain/frontend/join-rejoin.md). In Cloudflare, explicit `stop()` cancels the server turn and other client aborts are local-only by default — [Resumable Streaming](https://github.com/cloudflare/agents/blob/agents@0.33.0/docs/agents/resumable-streaming.md)
- Replay strategy: the AI SDK replays the full stream by default (`resumeStreamIsReplay`); Cloudflare replays buffered chunks with `replay: true` and `seq` dedupe; CopilotKit Intelligence replays recorded AG-UI events — sources as above

### Inferences
- For our harness (an append-only session event log, see AGENTS.md), the closest UI matches are Cloudflare's chunk log with `seq` and assistant-ui's ExternalStoreRuntime "event-log replay" pattern. Emitting the AI SDK UI message stream or AG-UI from the harness would give us off-the-shelf frontends: AI SDK UI, assistant-ui, CopilotKit and Cloudflare-compatible UIs.

### Gaps
- No primary source gives adoption numbers (downloads or stars) in this session.
