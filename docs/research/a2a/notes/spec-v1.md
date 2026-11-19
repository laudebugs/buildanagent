# What the A2A 1.0 specification standardizes (as of November 2026)

Research notes, gathered 2026-11-19 on branch `todo/U19-research-a2a`. The specification was read at two tags of `a2aproject/A2A`: `v1.0.0` (commit `173695755607e884aa9acf8ce4feed90e32727a1`, released 2026-03-12) and `v1.0.1` (commit `3303592588e388e62e0f69f701af531d2f4e3991`, released 2026-05-28), the latest release as of November 2026. Files read at each tag: `docs/specification.md`, `specification/a2a.proto`, `docs/whats-new-v1.md`, `docs/topics/*.md` and `GOVERNANCE.md`. Line numbers refer to the `v1.0.0` files unless a line says `v1.0.1`.

The tags mean:
- **[spec]**: `docs/specification.md` at the tag named.
- **[proto]**: `specification/a2a.proto`, which the spec calls "the single authoritative normative definition of all protocol data objects".
- **[topic]**: a non-normative page under `docs/topics/` or `docs/whats-new-v1.md` at the same tag.
- **[release]**: the GitHub release notes, fetched from the GitHub API on 2026-11-19.
- **[site]**: a page on a2a-protocol.org fetched on 2026-11-19.

Downloads are saved under `/private/tmp/claude-501/-Users-laudebugs-git-agent-speak-git/13349893-3ab5-443b-8939-e45188938409/scratchpad/u19/src/`.

## Versions and status

### Takeaway
A2A 1.0.0 is a released, tagged specification under the Linux Foundation package name `lf.a2a.v1`, and 1.0.1 is a patch with no protocol change. The text at the `v1.0.0` tag still calls itself a release candidate, which the `v1.0.1` text fixes.

### Cited findings
- **Releases.** `v1.0.0` published 2026-03-12, `v1.0.1` published 2026-05-28; before them `v0.3.0` (2025-07-30) and `v0.2.x` (2025) — [release].
- **Header at `v1.0.0`.** "# Agent2Agent (A2A) Protocol Specification (Release Candidate v1.0)" and "Latest Released Version [`0.3.0`]" — [spec] lines 1 and 3. At `v1.0.1` the heading drops "Release Candidate" and the note reads "Latest Released Version [`1.0.0`]" — [spec v1.0.1] lines 1 and 3. The live site (`/latest/specification/`, `/v1.0.0/specification/`) returns HTTP 200 — [site].
- **Patch scope of 1.0.1.** Three bug fixes: "prefer application/a2a+json in HTTP binding", "recent transcoding-related error changes" and "TaskStatus values in the specification" — [release v1.0.1]. The diff changes the HTTP status codes in the error table (for example `TaskNotCancelableError` from `409 Conflict` to `400 Bad Request`), spells state names as `TASK_STATE_*`, and documents `tenant` as "an opaque string used for routing requests" — diff of [spec] and [proto] between tags.
- **Patch versions do not affect compatibility.** "Patch version numbers used by the specification, do not affect protocol compatibility. Patch version numbers SHOULD NOT be used in requests, responses and Agent Cards" — [spec] line 710.
- **Package.** `package lf.a2a.v1;` — [proto] line 3. The 1.0.0 release note lists "Add LF prefix to the package" as a breaking change — [release v1.0.0].
- **Governance.** "The Committee has eight seats", held by Google, Microsoft, Cisco, Amazon Web Services, Salesforce, ServiceNow, SAP and IBM Research — `GOVERNANCE.md` at `v1.0.1`, lines 3–14. Repository license Apache-2.0; 26,593 stars as of 2026-11-19 (GitHub API).
- **Normative source.** "the file `spec/a2a.proto` is the single authoritative normative definition of all protocol data objects and request/response messages" — [spec] line 109. The file actually lives at `specification/a2a.proto` in the tagged tree.

## Three layers: data model, operations, bindings

### Takeaway
The spec separates a protocol-neutral data model (the proto), eleven abstract operations, and three official bindings (JSON-RPC 2.0, gRPC, HTTP+JSON/REST) that must behave identically. Custom bindings are allowed.

### Cited findings
- **Layers.** "Layer 1: Canonical Data Model … Layer 2: Abstract Operations … Layer 3: Protocol Bindings" — [spec] lines 94–98.
- **Eleven RPCs.** `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`, `ListTaskPushNotificationConfigs`, `GetExtendedAgentCard`, `DeleteTaskPushNotificationConfig` — [proto] lines 19–131, `service A2AService`.
- **Method mapping.** JSON-RPC and gRPC use the same PascalCase names; REST maps them to `POST /message:send`, `POST /message:stream`, `GET /tasks/{id}`, `GET /tasks`, `POST /tasks/{id}:cancel`, `POST /tasks/{id}:subscribe`, push-config routes and `GET /extendedAgentCard` — [spec] §5.3, lines 1162–1176.
- **Equivalence.** "When an agent supports multiple protocols, all supported protocols **MUST**: Identical Functionality … Consistent Behavior … Same Error Handling … Equivalent Authentication" — [spec] §5.1, lines 1147–1154.
- **JSON-RPC binding.** "JSON-RPC 2.0 over HTTP(S)", "PascalCase method names matching gRPC conventions", streaming over "Server-Sent Events (`text/event-stream`)" — [spec] §9.1, lines 2209–2214.
- **Renames from 0.3.** `message/send` → `SendMessage`, `message/stream` → `SendStreamingMessage`, `tasks/get` → `GetTask`, `tasks/cancel` → `CancelTask`, `tasks/resubscribe` → `SubscribeToTask`; `tasks/list` is new — [topic] `whats-new-v1.md` lines 48–146; [release v1.0.0] "Add `tasks/list` method with filtering and pagination".

## The data model: Task, Message, Part, Artifact, Agent Card

### Takeaway
A client sends a `Message`; the server answers with either a direct `Message` or a `Task`, a server-owned unit of work with nine states. Results belong in `Artifact`s, not messages. A `Part` is one of text, raw bytes, a URL or JSON data.

### Cited findings
- **Send Message outputs.** "`Task`: A task object representing the processing of the message, OR `Message`: A direct response message (for simple interactions that don't require task tracking)" — [spec] §3.1.1, lines 170–171.
- **TaskState.** `TASK_STATE_UNSPECIFIED`, `SUBMITTED`, `WORKING`, `COMPLETED` (terminal), `FAILED` (terminal), `CANCELED` (terminal), `INPUT_REQUIRED` ("an interrupted state"), `REJECTED` (terminal), `AUTH_REQUIRED` ("an interrupted state") — [proto] lines 187–208.
- **Server-generated task IDs.** "Task IDs are **server-generated** … Client-provided `taskId` values for creating new tasks is **NOT** supported" — [spec] §3.4.2, lines 610–617.
- **Context.** "A `contextId` is an identifier that logically groups multiple related `Task` and `Message` objects"; "Agents **MAY** implement context expiration or cleanup policies and **SHOULD** document any such policies" — [spec] §3.4.1, lines 588–604.
- **Artifacts carry results.** "Messages SHOULD NOT be used to deliver task outputs. Results SHOULD BE returned using Artifacts associated with a Task" — [spec] §3.7, line 760. "Messages MUST NOT be considered a reliable delivery mechanism for critical information" — line 764.
- **Part.** `oneof content { string text = 1; bytes raw = 2; string url = 3; google.protobuf.Value data = 4; }` plus `metadata`, `filename` and `media_type` — [proto] lines 224–242. 1.0 removed the `kind` discriminator: "Version 1.0 introduces a breaking change in how polymorphic objects are represented" — [spec] Appendix A.2.1, line 3411.
- **Role.** `ROLE_USER` ("from the client to the server") and `ROLE_AGENT` — [proto] lines 245–252.
- **AgentCard required fields.** `name`, `description`, `supported_interfaces`, `version`, `capabilities`, `default_input_modes`, `default_output_modes`, `skills`; optional `provider`, `documentation_url`, `security_schemes`, `security_requirements`, `signatures`, `icon_url` — [proto] lines 356–393.
- **AgentInterface.** `url`, `protocol_binding` ("The core ones officially supported are `JSONRPC`, `GRPC` and `HTTP+JSON`"), `tenant`, `protocol_version` ("Examples: "0.3", "1.0"") — [proto] lines 336–350.
- **AgentCapabilities.** `streaming`, `push_notifications`, `extensions`, `extended_agent_card` — [proto] lines 406–415.
- **AgentSkill.** Required `id`, `name`, `description`, `tags`; optional `examples`, `input_modes`, `output_modes`, `security_requirements` — [proto] lines 430–447.
- **Card changes from 0.3.** `protocolVersion`, `preferredTransport`, `additionalInterfaces`, `supportsAuthenticatedExtendedCard` and `url` removed; `supportedInterfaces[]` added — [topic] `whats-new-v1.md` lines 376–420.

## Interaction: blocking, streaming, polling, push, multi-turn

### Takeaway
A2A is built for long tasks. A client can block, poll, stream over SSE or gRPC, or register a webhook, and an agent can pause a task to ask for input or for authorization. These pauses can chain through several agents.

### Cited findings
- **Blocking default.** "Operations are blocking by default"; blocking "MUST wait until the task reaches a terminal state … or an interrupted state (`INPUT_REQUIRED`, `AUTH_REQUIRED`)"; `return_immediately: true` returns at once — [spec] §3.2.2, lines 446–450; [proto] lines 155–160. This sits awkwardly beside §3.1.1's "The operation MUST return immediately with either task information or response message" (line 182); the two read consistently only if "immediately" in §3.1.1 means "without further client action".
- **Three delivery mechanisms.** Polling with Get Task, streaming (requires `capabilities.streaming`), and push notifications, where the "Agent sends HTTP POST requests to client-registered endpoints when task state changes" — [spec] §3.5.1, lines 652–679.
- **Stream shape.** A task stream "MUST begin with the Task object, followed by zero or more `TaskStatusUpdateEvent` or `TaskArtifactUpdateEvent` objects. The stream MUST close when the task reaches a terminal state" — [spec] §3.1.2, line 212.
- **Multiple streams.** "Events MUST be broadcast to all active streams for that task" — [spec] §3.5.2, line 693.
- **Push delivery.** "Agents MUST attempt delivery at least once for each configured webhook"; clients "SHOULD process notifications idempotently, as duplicate deliveries may occur" — [spec] §4.3.3, lines 886 and 880.
- **Idempotency.** "Send Message operations MAY be idempotent. Agents may utilize the messageId to detect duplicate messages." — [spec] §3.3.1, line 497.
- **Input required.** "Agents can request additional input mid-processing by transitioning a task to the `input-required` state. The client continues the interaction by sending a new message with the same `taskId` and `contextId`" — [spec] §3.4.3, lines 634–635.
- **Auth required and chains.** "If the client is itself an A2A agent actively processing a Task, the client may further delegate the authorization request to its client by transitioning its own Task to `TASK_STATE_AUTH_REQUIRED` … This enables forming a chain of Tasks in `TASK_STATE_AUTH_REQUIRED`" — [spec] §7.6.2, line 1921.
- **In-band credentials leak along chains.** "In-band credential exchange can allow credentials to be passed across chains of multiple A2A agents, exposing those credentials to each agent participating in the chain"; credentials "SHOULD be bound to the agent which originated the request" — [spec] §7.6.3, lines 1933–1937.

## Discovery, versioning and extensions

### Takeaway
An agent publishes an Agent Card, usually at `/.well-known/agent-card.json`. Registries are allowed, but the spec defines no registry API. Each interface states its own `Major.Minor` protocol version, and an empty `A2A-Version` header means 0.3, which lets one server serve old and new clients.

### Cited findings
- **Discovery.** "Well-Known URI: Accessing `https://{server_domain}/.well-known/agent-card.json` … Registries/Catalogs: Querying curated catalogs of agents … Direct Configuration" — [spec] §8.2, lines 1954–1956.
- **No registry standard.** "The current A2A specification does not prescribe a standard API for curated registries." — [topic] `agent-discovery.md` line 59.
- **Interface preference.** "The first entry in `supportedInterfaces` represents the preferred interface"; clients "select the first supported transport" — [spec] §8.3, lines 1964–1973.
- **Version header.** `A2A-Version` is a service parameter (an HTTP header or gRPC metadata); "Clients MUST send the `A2A-Version` header with each request … (except for 0.3 Clients - 0.3 will be assumed for empty header)"; "Agents MUST interpret empty value as 0.3 version"; "Agents CAN expose multiple interfaces for the same transport with different versions" — [spec] §3.2.6 and §3.6, lines 488 and 714–743.
- **SDK duty.** SDKs "MUST provide mechanisms to help clients manage protocol versioning", and clients needing new features should "avoid automatic fallback to older versions, to prevent silently losing functionality" — [spec] §3.6.3, line 747.
- **Extensions.** "Extensions are identified by a URI and defined by their own specification. Anyone is able to define, publish, and implement an extension." — [topic] `extensions.md` line 13. A required extension the client does not declare yields `ExtensionSupportRequiredError` — [spec] §3.3.4, line 578.
- **Card caching.** Servers "SHOULD include a `Cache-Control` response header" and an `ETag` — [spec] §8.6.1, lines 2193–2197.

## Security

### Takeaway
A2A leaves identity to standard web security. It declares auth schemes in the card, requires per-request authentication and authorization scoping, and offers optional JWS-signed cards. Beyond one generic rule to sanitize user-provided content, it does not address prompt injection between agents; that risk stays with the implementer.

### Cited findings
- **Identity outside the protocol.** "A2A treats agents as standard enterprise applications, relying on established web security practices. Identity information is handled at the protocol layer, not within A2A semantics." — [spec] §7, line 1849.
- **Credentials out of band.** "The client obtains the necessary credentials through an out-of-band process" — [spec] §7.3, line 1864. "MUST authenticate every incoming request" — §7.4, line 1871.
- **Security schemes.** API key, HTTP auth, OAuth 2.0, OpenID Connect and mutual TLS — [spec] §4.5, lines 942–996. 1.0 removed the implicit and password OAuth flows and added device code and PKCE — [release v1.0.0].
- **Scoping.** "Authorization checks **MUST** occur before any database queries or operations that could leak information about the existence of resources outside the caller's authorization scope" — [spec] §13.1, line 3075.
- **Signed cards.** "Agent Cards **MAY** be digitally signed using JSON Web Signature (JWS) as defined in RFC 7515"; JCS (RFC 8785) canonicalization; "Clients **SHOULD** verify at least one signature before trusting an Agent Card" — [spec] §8.4, lines 1979, 1983 and 2105.
- **Webhook SSRF.** Agents "SHOULD validate webhook URLs to prevent SSRF … Reject private IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)" — [spec] §13.2, lines 3090–3091.
- **Tracing.** "A2A Clients and Servers **should** participate in distributed tracing systems. For example, use OpenTelemetry to propagate trace context … such as W3C Trace Context headers" — [topic] `enterprise-ready.md` lines 107–110.
- **Prompt injection.** The word "prompt" does not occur in `docs/specification.md` at `v1.0.0` (`grep -i prompt`, 2026-11-19). The only mention of injection is generic, in the media-type registration: "Implementations MUST sanitize user-provided content to prevent injection attacks" — [spec] §14.1, line 3221 (line 3244 at `v1.0.1`). Nothing addresses text from a remote agent steering the calling model.

## A2A and MCP, in A2A's own words

### Takeaway
The A2A project frames MCP as agent-to-tool and A2A as agent-to-agent, and calls them complementary. The dividing line it draws is statefulness and opacity: tools are "often stateless" primitives with structured inputs, agents "reason, plan … maintain state" over multi-turn dialogue.

### Cited findings
- **Appendix B.** "A2A and MCP are complementary protocols"; MCP is "the 'how-to' for an agent to *use* a specific capability"; A2A is "how independent, often opaque, AI agents communicate and collaborate with each other as peers"; "The Server agent, in turn, might use MCP to interact with several underlying tools" — [spec] lines 3577–3583.
- **Topic page.** Tools are "typically primitives with well-defined, structured inputs and outputs. They perform specific, often stateless, functions"; agents "reason, plan, use multiple tools, maintain state over longer interactions, and engage in complex, often multi-turn dialogues" — [topic] `a2a-and-mcp.md`, "Why Different Protocols?".
- **Agents as tools.** "An A2A Server (a remote agent) could expose some of its skills as MCP-compatible resources, especially if those skills are well-defined and can be invoked in a more tool-like, stateless manner" — [topic] `a2a-and-mcp.md`, "Representing A2A Agents as MCP Resources".
- **Opacity.** A2A agents exchange information "without needing access to each other's internal state, memory, or tools" — [spec] line 24.
