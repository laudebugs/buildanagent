# Open protocols and vendor standards for carrying agent UI (backend to frontend), as of November 2026

Method note: every page below was fetched with curl on 2026-11-18. Package versions and dates come from the npm registry (`registry.npmjs.org/<pkg>`) and the PyPI JSON API. The GitHub REST API was not reachable from this session, so I took release dates from npm, PyPI and changelogs committed to the repos. Every claim cites a primary source unless it is marked **[secondary]**.

## AG-UI (Agent-User Interaction Protocol): events, transports, interrupts, adoption

### Takeaway
AG-UI is CopilotKit's runtime protocol between an agent and its frontend. Version 1.0 (published 17 Sep 2026) froze a normative, JSON-Schema-backed spec with 31 event types in eight families, SSE and Protobuf bindings, and an interrupt-and-resume model in which the run ends and a new run resumes it. It has the broadest framework adoption of any protocol in this survey, and it presents itself as the transport that carries A2UI and MCP Apps payloads rather than competing with them.

### Cited Findings
- **Publisher and license:** CopilotKit created AG-UI, which is "developed in the open with the community" under the MIT license. — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **Status:** "AG-UI 1.0 is here. The protocol now has a stable, frozen specification backed by a JSON Schema, and the TypeScript, Python, and .NET SDKs are generated from it. 1.0 is backwards compatible in both directions: 0.x agents work with 1.0 clients and vice versa." The spec lives at docs.ag-ui.com/spec/1.0, and a draft spec tracks what comes next. — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **Release dates:** npm `@ag-ui/core` 1.0.0 was published 2026-09-17, and the latest release is 1.0.5 (2026-11-17). The package was first created 2025-04-30. PyPI `ag-ui-protocol` 1.0.0 was uploaded 2026-09-17. — [npm registry @ag-ui/core](https://registry.npmjs.org/@ag-ui/core); [PyPI ag-ui-protocol](https://pypi.org/pypi/ag-ui-protocol/json)
- **Normative spec:** 1.0 makes behavior normative in BCP 14 (MUST/SHOULD) language. The schema is authoritative for structure and the prose for behavior. In 0.x, "behaviour lived in the TypeScript client." — [AG-UI 1.0 changelog](https://docs.ag-ui.com/spec/1.0/changelog.md)
- **Wire model:** "An AG-UI agent is any HTTP endpoint that accepts a `RunAgentInput` and streams events back." `RunAgentInput` carries the conversation, the tools the frontend offers, shared state and context. Only the run-lifecycle events are required. — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **Event taxonomy (1.0, 31 types in 8 families):**
  - Runs and steps: `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED`.
  - Text messages: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK`.
  - Tool calls: `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`, `TOOL_CALL_CHUNK`.
  - State: `STATE_SNAPSHOT`, `STATE_DELTA` (JSON Patch), `MESSAGES_SNAPSHOT`.
  - Reasoning: `REASONING_START`, `REASONING_MESSAGE_*`, `REASONING_ENCRYPTED_VALUE`, `REASONING_END`.
  - Activity: `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA`.
  - Subagents: `SUBAGENT_STARTED`, `SUBAGENT_FINISHED`, `SUBAGENT_ERROR`.
  - Passthrough: `RAW`, `CUSTOM`.

  — [ag-ui README, Event reference](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **What 1.0 changed from 0.x:**
  - `RUN_FINISHED` gained an optional `outcome` (success, interrupt or cancelled).
  - Subagent attribution arrived through `subagentRunId`.
  - The reasoning family replaces the 0.x `THINKING_*` events. Retired shapes are translated at a compatibility boundary rather than dropped.
  - Activity events carry structured progress, amended by JSON Patch.
  - Unknown events and fields are dropped with a warning, while a malformed known value is fatal.
  - The chunked form has rules: the first chunk must carry `messageId` (text) or `toolCallId` and `toolCallName` (tool calls).
  - A binary HTTP + Protobuf binding uses 4-byte length-prefixed frames.
  - `AgentCapabilities` is defined once in the schema.

  — [AG-UI 1.0 changelog](https://docs.ag-ui.com/spec/1.0/changelog.md)
- **Default transport (HTTP + SSE):**
  - The client POSTs `RunAgentInput` as JSON with `Accept: text/event-stream`.
  - Each SSE `data` payload is exactly one protocol event. Producers MUST use LF line endings, and consumers MUST ignore the SSE `event:`, `id:` and `retry:` fields.
  - Errors before the stream opens are HTTP status codes. Errors after it opens arrive in-stream as `RUN_ERROR`.
  - One response MAY carry several runs when the producer replays a thread's history.

  — [AG-UI HTTP+SSE binding](https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse.md)
- **Interrupts (human in the loop):** AG-UI uses "a terminal model where the run ends with an interrupt outcome, and the client starts a new run carrying per-interrupt responses."
  - The interrupt arrives as `RunFinished { outcome: { type: "interrupt", interrupts: [...] } }`.
  - The `Interrupt` type has fields `id`, `reason`, `message`, `toolCallId`, `responseSchema` (JSON Schema for the reply), `expiresAt`, `metadata` and `subagentRunId`.
  - The client resumes by sending `RunAgentInput.resume: [{interruptId, status: "resolved"|"cancelled", payload?, metadata?}]` on the same thread.
  - The rules:
    - The resume must use the same `threadId`.
    - It must address every open interrupt.
    - The agent may validate the payload against `responseSchema`.
    - A stale resume past `expiresAt` yields `RunError`.
    - The agent should emit `StateSnapshot`/`MessagesSnapshot` before the interrupting `RunFinished`.
    - `RunError` is the only error event.

  — [AG-UI Interrupts](https://docs.ag-ui.com/concepts/interrupts.md); [AG-UI events](https://docs.ag-ui.com/concepts/events.md)
- **Subagent suspension:** a subagent's `SUBAGENT_FINISHED` can carry `outcome: {type: "suspended", interruptIds?}`, after which the parent run ends with an interrupt outcome. — [AG-UI events](https://docs.ag-ui.com/concepts/events.md)
- **Features beyond chat:** shared state (a typed store synced by snapshots and JSON Patch deltas), frontend tools (the agent calls tools that run in the app), generative UI (typed components, or A2UI and MCP Apps), reasoning including encrypted round-trips, subagents, and multimodal input. — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **Integrations:**
  - Partners: LangChain/LangGraph and CrewAI.
  - "Built in": Microsoft Agent Framework, Google ADK (including JS), Google Antigravity and AWS Strands Agents.
  - Others: Mastra, Pydantic AI, LlamaIndex, Agno, AG2, Claude Agent SDK, Claude Managed Agents, IBM watsonx Orchestrate, Langroid, Spring AI, Cloudflare Agents and OpenAI Agents.
  - Spec: Oracle Agent Spec.
  - Deployment: Amazon Bedrock AgentCore, which has an AG-UI runtime page.
  - The README claims AG-UI "is adopted by Google, Microsoft, Amazon, and Oracle". This is a self-claim.

  — [ag-ui README, Integrations](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **SDKs and clients:**
  - Official SDKs: TypeScript (`@ag-ui/client`), Python (`ag-ui-protocol`) and .NET (`AGUI.Client`).
  - Community SDKs: Kotlin, Go, Java, Dart, Rust, Ruby, C++ and Swift.
  - Clients: CopilotKit (React, Angular, Vue, React Native), Slack and Teams through `channels-sdk`, and a terminal client.

  — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **Relation to other protocols:** AG-UI calls itself "the 3rd leg" next to MCP (agent to tools) and A2A (agent to agent), and "the 'kitchen sink' protocol". It has "handshakes" that let AG-UI front agents speaking MCP or A2A. — [AG-UI: MCP, A2A, and AG-UI](https://docs.ag-ui.com/agentic-protocols.md)
- **AG-UI is not a UI format:** "AG-UI is not a generative UI specification — it's a User Interaction protocol that provides the bi-directional runtime connection". It "natively supports" A2UI, MCP-UI and Open-JSON-UI. The same page attributes MCP-UI to "Microsoft + Shopify" and Open-JSON-UI to OpenAI as "an open standardization of OpenAI's internal declarative Generative UI schema". — [AG-UI generative UI specs](https://docs.ag-ui.com/concepts/generative-ui-specs.md)

### Inferences
- AG-UI's interrupt model (end the run, then start a new run with `resume[]`) matches a stateless harness loop with checkpointed sessions. It maps directly onto LangGraph's interrupt/Command and onto OpenAI Agents SDK RunState resumption.
- AG-UI's own attribution of MCP-UI to "Microsoft + Shopify" looks stale or wrong. The MCP-UI repo and the SEP-1865 authors point to Ido Salomon and Liad Yosef, with Anthropic and OpenAI co-authoring SEP-1865. Treat that table as **[secondary/self-description]**.

### Gaps
- I did not fetch the AG-UI Protobuf binding page or the capabilities page in full.
- "Adopted by Google, Microsoft, Amazon, Oracle" is AG-UI's own claim. I did not verify each vendor's docs, apart from the AgentCore link the README cites.

## A2UI (Google): component model, rendering, relation to A2A, status

### Takeaway
A2UI is an Apache-2.0 declarative format from Google for "UI as data": a stream of JSON messages that create and update surfaces built from a flat list of components. Each client renders the components natively from a catalog it controls. Spec v1.0 is marked "Current" (last updated 8 Jun 2026), the renderer packages are at 0.15.0 (Nov 2026), and A2UI binds to AG-UI, A2A and MCP as transports.

### Cited Findings
- **Status:** the spec header reads "Version: 1.0 · Status: Current · Created: Nov 20, 2025 · Last Updated: Jun 8, 2026". The previous version, v0.9.1, is still documented. The repo roadmap says protocol v1.1 requirements are being collected. — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/); [A2UI README](https://raw.githubusercontent.com/google/A2UI/main/README.md)
- **License and packages:** A2UI is Apache 2.0.
  - Python: `a2ui-core`, `a2ui-agent-sdk`, `a2ui-a2a` and `a2ui-adk`.
  - TypeScript: `@a2ui/web_core`, the `@a2ui/lit`, `@a2ui/angular` and `@a2ui/react` renderers, `@a2ui/agent`, `@a2ui/catalog-mcp` and `@a2ui/markdown-it` (which uses DOMPurify).
  - Dart/Flutter and Swift packages also exist.

  — [A2UI README](https://raw.githubusercontent.com/google/A2UI/main/README.md)
- **Versions:** npm `@a2ui/lit`, `@a2ui/react` and `@a2ui/web_core` are at 0.15.0 (2026-11-02). `@a2ui/lit` was first published 2025-12-16, and `@a2ui/react` 2026-03-17. — [npm @a2ui/lit](https://registry.npmjs.org/@a2ui/lit); [npm @a2ui/react](https://registry.npmjs.org/@a2ui/react)
- **Design stance:** "A2UI expresses UI using data, not code." A schema "enforces strict capability boundaries for the agent". A2UI suits agents that are "remote, third-party, or operate across a trust boundary". The README says: "WebViews or HTML are not required". Its stated security principle is "disallowing arbitrary executable code". — [A2UI README](https://raw.githubusercontent.com/google/A2UI/main/README.md)
- **Architecture:** A2UI has three layers.
  - Inference: the model emits UI in an inference format such as "A2UI Express".
  - Transport: the Agent SDK validates the output, expands macros and converts it to wire messages.
  - Rendering: a core library, a framework adapter and a widget catalog render the UI.

  — [A2UI README](https://raw.githubusercontent.com/google/A2UI/main/README.md)
- **Agent-to-renderer messages (v1.0):** `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface`, plus the function RPCs `callRendererFunction` and `agentFunctionResponse`. "End of agent turn is signaled by transport layer." — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Renderer-to-agent messages:** `action`, `callAgentFunction`, `rendererFunctionResponse` and `error`. User interactions "are handled separately, typically by sending events to a different endpoint". — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Changes from v0.9.1:**
  - The envelopes are renamed `agent_to_renderer` and `renderer_to_agent`.
  - Bindings take an `@` prefix: `@path`, `@call`, `@catalogId`, `@accessibility`, `@metadata` and `@checks`.
  - Bidirectional function RPC arrives.
  - A single `createSurface` can carry the whole tree and data model.
  - The `theme` property is removed, so styling defers to the native framework.
  - Identifiers follow UAX #31.

  — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Component model:** A2UI uses an "adjacency list model". The UI is a flat list of components whose containers (`Row`, `Column`, `List`, `Card`) reference child ids. Exactly one component must have id `root`, and updates are buffered until it exists. The agent can therefore send components in any order and render progressively. Data binding uses a separate data model with path resolution and two-way binding for inputs. — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Catalogs:** the renderer declares `supportedCatalogIds` in its capabilities. Catalog resolution goes component `@catalogId`, then the surface default `catalogId`, then an error. "There is no fallback" to the renderer's other catalogs. A Basic Catalog is defined. — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Transport bindings:**
  - "AG-UI is the standard transport binding for Agent-to-User Interaction."
  - The A2A Extension "maps A2UI over the A2A Protocol", covering metadata placement, capability negotiation and data-model sync.
  - The MCP binding carries A2UI in tool calls, tool outputs or resource subscriptions.
  - A2UI also runs over SSE with JSON-RPC, WebSockets and REST.
  - Capabilities are exchanged through "Agent Cards in A2A or initialization in MCP".

  — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **MCP interop:** the docs cover calling MCP tools from A2UI, serving A2UI layouts from an MCP server, embedding MCP Apps in A2UI surfaces and rendering A2UI inside an MCP App. The roadmap lists "Sandboxed logic" and two-way MCP Apps embedding. — [A2UI v1.0 spec nav](https://a2ui.org/specification/v1.0-a2ui/); [A2UI README roadmap](https://raw.githubusercontent.com/google/A2UI/main/README.md)

### Inferences
- A2UI and MCP Apps sit at opposite ends of a trust/expressiveness trade-off. A2UI sends declarative data rendered by the host's own components, so there is no agent code and the look is native. MCP Apps sends arbitrary HTML/JS in a sandboxed iframe: fully expressive, but the code is foreign. A host that wants both can carry A2UI inside AG-UI and embed MCP Apps as one component type.

### Gaps
- I could not fetch the A2UI A2A extension page: both guessed URLs returned 404. Its extension URI and MIME type are not recorded here.
- I did not enumerate the full Basic Catalog component list.

## MCP-UI and MCP Apps (official MCP extension)

### Takeaway
MCP Apps (SEP-1865, extension id `io.modelcontextprotocol/ui`) is the official MCP extension for interactive UI. Its spec revision 2026-01-26 is marked **Stable**. It links tools to `ui://` HTML resources (MIME type `text/html;profile=mcp-app`) that run in sandboxed iframes and talk to the host over JSON-RPC on `postMessage`. MCP-UI, the community project that pioneered the idea, now ships SDKs that implement MCP Apps. Claude, ChatGPT, VS Code Copilot, M365 Copilot, Goose and others host MCP Apps.

### Cited Findings
- **Core MCP revision:** `modelcontextprotocol.io/specification/latest` redirects to `/specification/2026-07-28`. — [MCP spec latest](https://modelcontextprotocol.io/specification/latest)
- **Extension lifecycle:** extensions use ids of the form `{vendor-prefix}/{extension-name}` and pass through Experimental, Beta and Stable stages under SEP-3392. A Stable extension changes "only with a new core protocol revision". — [MCP extensions overview](https://modelcontextprotocol.io/extensions/overview.md)
- **MCP Apps status:** MCP Apps is listed as **Stable** under Official Extensions (repo `modelcontextprotocol/ext-apps`). Server Cards is Beta. Several experimental-ext repositories exist (interceptors, variants, tool-annotations, file-uploads, filesystems). — [MCP extensions overview](https://modelcontextprotocol.io/extensions/overview.md)
- **SEP-1865:** "MCP Apps - Interactive User Interfaces for MCP", Status **Final**, Extensions Track, created 2025-11-21. The authors include Ido Salomon, Liad Yosef (MCP-UI), Olivier Chafik and others. — [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp.md)
- **Spec versions:** the 2026-01-26 revision is "Stable", and a draft is in "Development". — [ext-apps README](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md)
- **SDK versions:** npm `@modelcontextprotocol/ext-apps` 1.0.0 shipped 2026-01-26 (the same day as the spec revision) and 2.0.0 on 2026-09-08. The `latest` dist-tag is 2.0.4 (2026-10-27), although a 2.1.0 also appears in the registry's time map with the same date. The README says 1.x Views render in a 2.x host and vice versa. — [npm ext-apps](https://registry.npmjs.org/@modelcontextprotocol/ext-apps); [ext-apps README](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md)
- **Wire model:**
  - The tool description's `_meta.ui.resourceUri` points to a `ui://` resource, which the host can preload before the tool is called.
  - The host fetches the resource with `resources/read`. It holds HTML with bundled JS and CSS, plus optional `_meta.ui.csp` (allowed origins) and `_meta.ui.permissions` (for example microphone or camera).
  - Web hosts render the HTML in a sandboxed iframe.
  - View and host talk JSON-RPC 2.0 over `postMessage`, "its own dialect of MCP". Some methods are shared with MCP (`tools/call`), and most are new methods under `ui/`.

  — [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview.md); [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Message set (spec 2026-01-26):**
  - Handshake: `ui/initialize` and `ui/notifications/initialized`.
  - View to host: `ui/message`, `ui/open-link`, `ui/update-model-context`, `ui/request-display-mode` and `tools/call`.
  - Host to view: `ui/notifications/tool-input`, `tool-input-partial` (streaming tool arguments), `tool-result`, `tool-cancelled`, `host-context-changed`, `size-changed` and `ui/resource-teardown`.
  - Reserved for the sandbox proxy: `ui/notifications/sandbox-proxy-ready` and `sandbox-resource-ready`.
  - Hosts pass theming as standardized CSS variables. Display modes include inline and others.

  — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Tool visibility:** `visibility` defaults to `["model","app"]`.
  - The host MUST NOT list app-only tools to the model.
  - The host MUST reject `tools/call` from apps for tools without `"app"` visibility.
  - Cross-server calls to app-only tools are always blocked.

  — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Sandbox proxy (web hosts):** a web host "MUST wrap the View and communicate with it through an intermediate Sandbox proxy" on a different origin. The proxy holds `allow-scripts` and `allow-same-origin`. It loads the View's raw HTML with a CSP built from `ui.csp`: `frame-src 'none'` unless `frameDomains` is set, `base-uri 'self'`, `object-src 'none'`, and restrictive defaults. It forwards every non-`ui/notifications/sandbox-*` message. The host "MAY decide to block some messages or subject them to further user approval." — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Threat model:** the spec names five threats: malicious server HTML, sandbox escape, unauthorized tool execution, exfiltration of host data, and phishing or social engineering. Its mitigations:
  - Mandatory iframe sandboxing.
  - Auditable JSON-RPC: hosts validate and log View-initiated calls.
  - Predeclared resource review: hosts may hash resources and warn on suspicious content.
  - Hosts "MUST enforce Content Security Policies".
  - The host "MAY request user consent" for View-initiated actions.

  — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Client support:** Claude, Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam and Archestra.AI. The ext-apps README also lists ChatGPT. — [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview.md); [ext-apps README](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md)
- **VS Code date:** VS Code announced MCP Apps support in a blog post dated 2026-01-26, per the README's link path. **[secondary: date inferred from the URL]** — [ext-apps README](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md)
- **MCP-UI today:** "`mcp-ui` pioneered the concept of interactive UI over MCP... Alongside Apps SDK, the patterns developed here directly influenced the MCP Apps" standard. "The `@mcp-ui/*` packages implement the MCP Apps standard. `@mcp-ui/client` is the recommended SDK for MCP Apps Hosts."
  - The client offers `AppRenderer` for MCP Apps and `UIResourceRenderer` for legacy MCP-UI hosts.
  - The repo now sits under the MCP-UI-Org GitHub organization.

  — [mcp-ui README](https://raw.githubusercontent.com/idosal/mcp-ui/main/README.md); [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview.md)
- **MCP-UI versions:** npm `@mcp-ui/server` is at 6.1.0 (2026-02-13) and `@mcp-ui/client` at 7.1.1 (2026-05-09). 6.0.0 shipped 2026-01-26, the day the MCP Apps spec revision shipped. — [npm @mcp-ui/server](https://registry.npmjs.org/@mcp-ui/server); [npm @mcp-ui/client](https://registry.npmjs.org/@mcp-ui/client)
- **MCP Apps versus pre-SEP MCP-UI:** the handshake changes from `iframe-ready` to `ui/initialize`, capabilities are negotiated in `McpUiInitializeResult`, and tool data arrives as notifications. — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)

### Inferences
- MCP Apps has become the convergence point for iframe-based agent UI. OpenAI (Apps SDK), Anthropic (Claude) and Microsoft (VS Code, M365) all host it, and MCP-UI folded into it. For a harness that already has an MCP client, supporting MCP Apps means adding a sandbox-proxy iframe host and a `ui/*` JSON-RPC router.
- The approval point in MCP Apps is the host's handling of View-initiated `tools/call`. The spec leaves the policy to the host ("MAY ... further user approval"). That is the natural place to wire in our approval policy.

### Gaps
- I did not compare the draft MCP Apps spec with 2026-01-26, so draft-only changes are unknown.
- I did not fetch the client matrix page.

## OpenAI Apps SDK (apps in ChatGPT) and ChatKit

### Takeaway
OpenAI's Apps SDK now treats MCP Apps as the primary standard. `window.openai` survives as a compatibility alias and a home for ChatGPT-only extensions such as checkout, files, modals and widget state; the docs now call these "plugins". ChatKit is a separate product: an embeddable chat UI (Apache-2.0 JS) backed either by your own server, through the `openai-chatkit` Python server SDK, or by Agent Builder, which OpenAI is shutting down on 30 Nov 2026. It renders JSON "widgets" (Card, ListView and others) whose actions go back to your server.

### Cited Findings
- **MCP Apps first:** "ChatGPT implements the open MCP Apps standard for UI returned by an MCP server." The UI "communicate[s] with the host through the MCP Apps bridge" (`ui/*` JSON-RPC over `postMessage`). Developers should use `window.openai` "only for capabilities that" the standard does not cover. — [OpenAI: Add UI to your MCP server](https://developers.openai.com/apps-sdk/build/chatgpt-ui.md)
- **Compatibility aliases:**

  | Goal | MCP Apps standard | ChatGPT alias |
  | --- | --- | --- |
  | Link a tool to a UI resource | `_meta.ui.resourceUri` | `_meta["openai/outputTemplate"]` |
  | Receive tool input | `ui/notifications/tool-input` | `window.openai.toolInput` |
  | Receive tool results | `ui/notifications/tool-result` | `window.openai.toolOutput` |
  | Call a tool from the UI | `tools/call` | `window.openai.callTool` |
  | Send a follow-up message | `ui/message` | `window.openai.sendFollowUpMessage` |

  "New UI should use the shared fields." — [OpenAI: Add UI to your MCP server](https://developers.openai.com/apps-sdk/build/chatgpt-ui.md)
- **ChatGPT-only extensions:** `window.openai.requestCheckout` (Instant Checkout), `uploadFile`, `selectFiles`, `getFileDownloadUrl`, `requestModal`, `widgetState`/`setWidgetState`, `requestDisplayMode` (inline, picture-in-picture, fullscreen), `requestClose` and `openExternal` (with `redirect_domains`). — [OpenAI: Add UI to your MCP server](https://developers.openai.com/apps-sdk/build/chatgpt-ui.md); [Apps SDK reference](https://developers.openai.com/apps-sdk/reference.md)
- **Model versus widget data:** "Only `structuredContent` and `content` appear in the conversation transcript. The host forwards `_meta` to the component so you can hydrate UI without exposing the data to the model." `openai/userLocation` and `openai/userAgent` are hints and must not be used for authorization. — [Apps SDK reference](https://developers.openai.com/apps-sdk/reference.md)
- **Changelog, 2026:**
  - 2026-05-27: for tools that need user approval, ChatGPT now delivers widget tool input through `ui/notifications/tool-input` after approval, rather than preloading it.
  - 2026-05-28: ChatGPT supplies the standard MCP Apps host CSS variables.
  - 2026-06-12: users choose when apps ask permission ("always, before making changes, or only before important changes"), and admins set workspace defaults.
  - 2026-07-21: `_meta["openai/visibility"]` is deprecated in favor of `_meta.ui.visibility`.
  - 2026-08-21: stable OAuth callbacks and CIMD client IDs.

  — [OpenAI plugin UI changelog](https://developers.openai.com/apps-sdk/changelog.md)
- **Migration tooling:** the ext-apps repo ships a `migrate-oai-app` agent skill that "Converts an existing OpenAI App to use MCP Apps". — [ext-apps README](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/README.md)
- **ChatKit integration paths:** "Custom server integration" (ChatKit Python SDK, any agent backend, for example the Agents SDK) or an existing Agent Builder-hosted workflow. "OpenAI is deprecating Agent Builder... scheduled to shut down on November 30, 2026. ChatKit is still available." — [OpenAI ChatKit guide](https://developers.openai.com/api/docs/guides/chatkit.md)
- **ChatKit server protocol:** you subclass `ChatKitServer` and override `respond(thread, input: UserMessageItem | ClientToolCallOutputItem | None, context) -> AsyncIterator[Event]`. A store persists threads and items, and helpers such as `stream_agent_response` bridge to the Agents SDK. Client tool calls round-trip as `ClientToolCallOutputItem`. — [OpenAI advanced ChatKit integration](https://developers.openai.com/api/docs/guides/custom-chatkit.md)
- **ChatKit widgets:**
  - Widgets are JSON trees with one container (`WidgetRoot`: Card, ListView and others) and `WidgetNode` children.
  - A Card supports `status`, `confirm` and `cancel` with an `ActionConfig`, a built-in confirm/cancel affordance.
  - Clicks become action payloads, handled on the server or in the client's `widgets.onAction`.
  - ChatKit Studio's Widget Builder generates the JSON.

  — [OpenAI ChatKit widgets](https://developers.openai.com/api/docs/guides/chatkit-widgets.md)
- **ChatKit packages:** chatkit-js is Apache-2.0 and loads `chatkit.js` from `cdn.platform.openai.com`. npm `@openai/chatkit` is at 1.9.0 and `@openai/chatkit-react` at 1.6.1 (both 2026-07-31). PyPI `openai-chatkit` is at 1.6.5 (2026-05-19). — [chatkit-js README](https://raw.githubusercontent.com/openai/chatkit-js/main/README.md); [npm @openai/chatkit](https://registry.npmjs.org/@openai/chatkit); [PyPI openai-chatkit](https://pypi.org/pypi/openai-chatkit/json)
- **ChatKit session security:** the hosted path requires a per-end-user `user` parameter when the server creates a session and mints a client secret. — [OpenAI ChatKit guide](https://developers.openai.com/api/docs/guides/chatkit.md)

### Inferences
- ChatKit is a product protocol, not an open standard. Its widget JSON is closest to A2UI and Adaptive Cards (declarative, host-rendered), while its server protocol is a thread/item store plus an event stream, closer to AG-UI than to MCP Apps. AG-UI's docs describe "Open-JSON-UI" as an open standardization of OpenAI's declarative schema. That is plausibly related to ChatKit widgets, but I found no OpenAI primary source for "Open-JSON-UI".

### Gaps
- I did not fetch the ChatKit server-protocol event type list (chatkit-python `docs/server.md`).
- I found no OpenAI primary source for "Open-JSON-UI". The name appears only in AG-UI/CopilotKit docs **[secondary]**.

## A2A (Agent2Agent) and its UI-related extensions; ACP briefly

### Takeaway
A2A is a Linux Foundation project contributed by Google, at protocol 1.0.0 (12 Mar 2026; 1.0.1 on 26 May 2026). It is agent-to-agent, not agent-to-UI. It carries UI through extensions (A2UI's A2A extension), and its human-in-the-loop primitive is a task state (`TASK_STATE_INPUT_REQUIRED` or `AUTH_REQUIRED`) resumed by a new message with the same task id. ACP (Zed) is the editor-to-coding-agent protocol, at stable protocol version 1.

### Cited Findings
- **Governance:** "The A2A Protocol is an open source project under the Linux Foundation, contributed by Google", licensed Apache 2.0. — [A2A README](https://raw.githubusercontent.com/a2aproject/A2A/main/README.md)
- **Versions:** the latest released version is 1.0.0; earlier versions are 0.3.0, 0.2.6 and 0.1.0. — [A2A spec](https://a2a-protocol.org/latest/specification/)
- **Release dates:** the CHANGELOG lists 1.0.0 on 2026-03-12 and 1.0.1 on 2026-05-26. — [A2A CHANGELOG](https://raw.githubusercontent.com/a2aproject/A2A/main/CHANGELOG.md)
- **SDKs:** npm `@a2a-js/sdk` 1.0.0 shipped 2026-07-22 and is now at 1.3.0 (2026-09-29). PyPI `a2a-sdk` is at 1.3.1 (2026-11-17). — [npm @a2a-js/sdk](https://registry.npmjs.org/@a2a-js/sdk); [PyPI a2a-sdk](https://pypi.org/pypi/a2a-sdk/json)
- **Wire model:**
  - Bindings: JSON-RPC, gRPC and HTTP+JSON/REST.
  - Methods: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, push-notification configuration and `GetExtendedAgentCard`.
  - Data model: Task, TaskStatus, TaskState, Message, Part and Artifact, with `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` streaming events.
  - Extensions and custom protocol bindings are first-class documentation sections.

  — [A2A spec](https://a2a-protocol.org/latest/specification/)
- **Interruption:** "interrupted" states are `TASK_STATE_INPUT_REQUIRED` and `TASK_STATE_AUTH_REQUIRED`. Terminal states are COMPLETED, FAILED, CANCELED and REJECTED. "The client continues the interaction by sending a new message with the same taskId and contextId." — [A2A spec](https://a2a-protocol.org/latest/specification/)
- **UI over A2A:** A2UI's A2A binding "standardizes metadata placement, renderer-to-agent capability negotiation, and bidirectional data model synchronization", and capabilities travel through Agent Cards. — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **ACP:** ACP "standardizes communication between code editors... and coding agents". "The current stable ACP protocol version is `1`", negotiated through `protocolVersion` in `initialize`. JSON Schema artifacts exist for `schema/v1` and `schema/v2`. — [ACP README](https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/README.md)

### Inferences
- For a frontend, A2A is a backend-to-backend concern. A UI talks AG-UI (or an MCP Apps host), and the agent behind it may delegate over A2A. AG-UI's "A2A handshake" middleware exists to bridge exactly this.

### Gaps
- I did not verify whether A2A 1.0 defines any core UI part types beyond Parts and Artifacts.
- I found no other official A2A UX extension besides A2UI's.

## Other emerging formats: Vercel UI message stream, json-render, Adaptive Cards, Thesys C1/OpenUI

### Takeaway
Vercel's AI SDK UI message stream (SSE plus the header `x-vercel-ai-ui-message-stream: v1`) is a widely used de facto format. It has typed parts for text, tools (including tool approval) and custom `data-*` parts. I did not verify the other candidates against primary sources in this pass.

### Cited Findings
- **Vercel stream format:** a custom backend "need[s] to set the `x-vercel-ai-ui-message-stream` header to `v1`". Parts are SSE JSON objects:
  - `start` (with `messageId`).
  - `text-start`, `text-delta` and `text-end` (keyed by `id`).
  - `tool-input-start`, `tool-input-delta` and `tool-input-available`.
  - `tool-output-available` and `tool-output-denied`.
  - `tool-approval-request` (`toolCallId`, `approvalId`, optional `approvalDescriptor`, `reason` and `isAutomatic`).
  - `start-step` and `finish-step`.
  - An experimental `steering-message` part.
  - Custom `data-<name>` parts "that your frontend can handle specifically".
  - `error`.

  — [AI SDK stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- **Activity:** npm `@ai-sdk/react` is at 4.0.180 (2026-11-17). — [npm @ai-sdk/react](https://registry.npmjs.org/@ai-sdk/react)

### Inferences
- Vercel's format and AG-UI encode nearly the same things: streamed text blocks, streamed tool arguments, tool results, approval and custom data. The difference is resumption. Vercel puts approval inside the message stream as a part answered by the client, while AG-UI ends the run with an interrupt outcome and starts a new run with `resume[]`. An adapter between them is mechanical.

### Gaps
- json-render, Microsoft Adaptive Cards in agents (Copilot Studio/Teams) and Thesys C1/OpenUI were not researched for lack of budget. No claims are made about them.

## Overlaps, conflicts and security concerns

### Takeaway
The field has settled into two layers. The runtime/event protocols (AG-UI; Vercel's stream; ChatKit's server protocol; A2A between agents) carry runs, messages, tool calls, state and interrupts. The UI payload formats come in two models: declarative, host-rendered (A2UI, ChatKit widgets, Open-JSON-UI) or sandboxed code (MCP Apps). The main split in UI payloads is declarative data versus sandboxed HTML. The main split in approval is pausing in-stream (Vercel `tool-approval-request`, MCP Apps host consent) versus terminating and resuming the run (AG-UI interrupts, A2A `INPUT_REQUIRED`).

### Cited Findings
- **AG-UI's view:** A2UI, MCP Apps and Open-JSON-UI "describe what UI an agent wants to show. AG-UI is the runtime protocol that carries those payloads." — [ag-ui README](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/README.md)
- **A2UI's view:** A2UI names AG-UI as "the standard transport binding for Agent-to-User Interaction" and also binds to A2A and MCP. — [A2UI v1.0 spec](https://a2ui.org/specification/v1.0-a2ui/)
- **Convergence on MCP Apps:** OpenAI's UI layer has converged on MCP Apps, and `window.openai` is now an alias plus extensions. — [OpenAI: Add UI to your MCP server](https://developers.openai.com/apps-sdk/build/chatgpt-ui.md)
- **Security, A2UI:** A2UI's posture is no executable code, schema validation of inputs and outputs, and capabilities either built in or explicitly granted. The web renderers sanitize Markdown with DOMPurify. — [A2UI README](https://raw.githubusercontent.com/google/A2UI/main/README.md)
- **Security, MCP Apps:** the spec requires a cross-origin sandbox proxy, CSP built from declared domains, auditable JSON-RPC, predeclared resources and visibility rules for app-only tools. It names phishing and social engineering among its threats. — [MCP Apps spec 2026-01-26](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx)
- **Security, ChatGPT:** `_meta` reaches the widget but not the model, which separates the data channels. User-agent and location hints must not be used for authorization. Approval-gated tool input is withheld from widgets until the user approves. — [Apps SDK reference](https://developers.openai.com/apps-sdk/reference.md); [OpenAI plugin UI changelog](https://developers.openai.com/apps-sdk/changelog.md)

### Inferences
- **Prompt injection through UI:** an MCP App can call `ui/update-model-context` and `ui/message`, which feed text into the model's context. A malicious or compromised View is therefore a prompt-injection vector, which matches the "phishing/social engineering" threat in the spec. Hosts should treat View-originated context as untrusted tool output and gate View-initiated `tools/call` through the same approval policy as model-initiated calls.
- **Recommendation for our harness:** emit AG-UI (or an AG-UI-compatible event log) as the frontend wire format. Support A2UI for native, safe generative UI, and host MCP Apps behind a sandbox proxy for third-party tool UIs. Keep approval in a single place by mapping AG-UI interrupts, Vercel `tool-approval-request` and MCP Apps View tool calls onto one approval policy.

### Gaps
- I found no published incident reports or CVEs about UI-borne prompt injection in MCP Apps hosts in this pass.
