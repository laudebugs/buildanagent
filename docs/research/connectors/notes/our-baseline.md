# Our baseline for agent connectors (as of 2026-11-18)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-connectors.md](../fact-check-agent-connectors.md) and applied in [the report](../agent-connectors.md), which supersede this note where they disagree.

What the agent-speak repository already plans, decides and verifies about connectors: integrations with outside apps through MCP servers, OAuth connections and API tools. It also lists what a connector feature would still need. Nothing here is built yet; every finding is a plan, a decision, a todo, a verified reference or a research note.

- **Source checkout:** `/Users/laudebugs/git/agent-speak-wt/connectors`, branch `docs/connectors-research`. The task named `c2ff8bc` as the base. During this research the worktree moved to `720e779`, "Plan a multi-user agent platform… (#18)", which merged the platform plan. `git diff docs/agent-platform-plan HEAD -- docs` is empty, so the platform files cited below are the same on `main` and on the PR branch, and they are cited by their repo paths.
- **Excluded:** mirrored upstream docs under `docs/reference/*/source/`, except where noted as "mirror check" to confirm what an SDK supports.
- **Citation style:** repo-relative path plus GitHub heading anchor.

---

## 1. Harness: the MCP client, tool registry, permission pipeline, credential proxy and extension trust

### Takeaway
The harness plan has a thorough design for an MCP client, but only for consuming servers. The client wraps `@modelcontextprotocol/client` 2.4.0 behind `McpConnection` and negotiates the protocol era per server. It names tools `mcp__<server>__<tool>`, exposes them as deferred by default and marks their output untrusted. Every call goes through the deny-first permission pipeline and the write cap, and a no-match call asks interactively or is denied headless. Servers are configured statically, by name and either a stdio command or an HTTP URL. Nothing covers OAuth for remote MCP servers beyond "what the client library provides". There is also no token storage, no per-user connection, no connector catalog and no per-server pinning. Content-hash pins exist only for in-process extensions (N22).

### Cited findings
- **HD14 / ADR 0021: the client base.** `@modelcontextprotocol/client` 2.4.0 sits behind our `McpConnection` interface, so "the registry sees only `McpConnection`". The choice was made partly because the alternative, writing our own client, "means writing stdio, streamable HTTP, SSE and OAuth transports ourselves". Status: decided, provisional until N24. — `docs/plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional`; `docs/decisions/0021-mcp-client-base.md#decision`
- **API sketch.** `McpServerConfig { name; transport: {kind:"stdio"; command; args; env?} | {kind:"http"; url}; exposure?; trusted? }`, with the comment "project-supplied servers need project trust (guide §7)". `McpConnection { era: "2026-07-28" | "legacy"; listTools; callTool; close }`. `createMcpManager({ servers, registry, directWaitMs? })`, default 10,000 ms. The HTTP transport has **no headers, auth or credential field**. — `docs/plans/build-harness.md#33-context-policy-and-tool-registry-apis`
- **Registry (N11).**
  - `ToolSource` includes `` `mcp:${string}` ``.
  - `exposure: "direct" | "deferred" | "hidden"`, and `setExposure` defaults MCP to `deferred`.
  - `outputTrust` defaults to `"untrusted"` for `mcp:*` sources.
  - An MCP name collision gets a deterministic hash suffix.
  - `toolSearchTool()` activates deferred tools through `ModelCallPatch.activeTools`.
  - `approvalReuse` defaults to `"both"`.
  — `docs/todos/done/N11-tool-registry.md#scope`; `docs/plans/build-harness.md#33-context-policy-and-tool-registry-apis`
- **N24 (stdio).** In scope:
  - the `server/discover` probe with an `initialize` fallback, recording the era;
  - `mcp__<server>__<tool>` names with exposure `deferred`;
  - servers spawned with `spawnEnv` plus each server's declared variables;
  - `readOnlyHint` and other annotations ignored for scheduling;
  - an `mcp: false` switch.

  Acceptance criteria: "A denied MCP call never reaches the server", a 200 KiB MCP result is capped, and "No parent environment variable reaches the server process unless declared". — `docs/todos/ready/N24-mcp-stdio.md#scope`, `#acceptance-criteria`
- **N25 (HTTP, SSE, background connect).**
  - In scope: streamable HTTP and legacy SSE, "HTTP servers reached through the egress proxy's allowlist (N20)", and a background connect where the first prompt waits up to 10 s only for `direct` servers. `tools/list_changed` re-registers tools at the next turn boundary.
  - **Out of scope: "OAuth flows beyond what the client library provides".**
  - Risk: "Remote servers hold their own credentials; the harness passes none unless a credential route names the host."

  — `docs/todos/ready/N25-mcp-http-background.md#scope`, `#risks-and-open-questions`
- **Harness guide §4 rationale.**
  - Collisions are "the main MCP failure".
  - Deferred loading cut tool definitions from about 77K to 8.7K tokens, and one practitioner counted "Linear: 23 tools (~12,935 tokens)".
  - "Practitioners prefer CLIs and skills for local work and keep MCP for remote, authenticated services", and "A growing minority treats remote MCP with OAuth as the credential boundary".
  - Annotations and output are untrusted, and "every tool, MCP or not, passes the permission pipeline".

  — `docs/guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension`
- **Permission pipeline (HD12, N12).**
  - Order: hooks (which can deny or ask, never allow), then deny, ask, mode, allow, and the host callback.
  - With no match, the call asks when `interactive` and is denied otherwise. Every `decide()` writes a `permission_decision` entry.
  - There is **no harness-level tier default for MCP tools**; tiers are a product concern ("the tier table … P3 decides them").

  — `docs/plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback`; `docs/plans/build-harness.md#34-permission-approval-and-sandbox-apis`; `docs/todos/done/N12-permission-pipeline.md#scope`; `docs/plans/build-harness.md#1-goal-and-non-goals`
- **HD15 / N20 (credential proxy).**
  - A tool calls `http://127.0.0.1:<port>/<route>/…`, and the host-side proxy forwards it to the route's HTTPS host, "adding the credential header when the sentinel in the request matches and the method is allowed".
  - `CredentialRoute { route; host; methods; header; secret: () => Promise<string> }`. The `secret` thunk is the only hook a token source could use, and **nothing is planned behind it**: no vault, no refresh, no per-user lookup.
  - `scrubSecrets()` runs before every append.

  — `docs/plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls`; `docs/todos/ready/N20-credential-proxy.md#scope`
- **N43: `EgressPolicy { allow, routes }` compiled per backend.** It adds "a `routes` entry kind for git over HTTPS with a ref filter". — `docs/todos/ready/N43-remote-sandbox-egress-policy.md#tasks`
- **Guide §6 rule:** "the harness takes API keys or proxy-injected credentials, never consumer-subscription OAuth". — `docs/guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both`
- **Extensions and trust (guide §7, N22).**
  - There are three tiers (in-process, MCP and skills) "behind one project-trust gate". Headless runs skip project extensions by default, and "trust is not a sandbox".
  - Supply-chain evidence: about 47 HN authors, postmark-mcp, and "No lock files. Nothing".
  - N22 builds `extensions.lock.json` with a SHA-256 per extension. Its scope is in-process only, and MCP servers are explicitly "Out of scope … (N24)". N24 itself has **no pin or lock** for a server's command, package version or tool list.
  - The `extension_loaded` entry has `tier: "in_process" | "mcp" | "skill"; contentHash`, so the log shape anticipates MCP hashes.

  — `docs/guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution`; `docs/todos/ready/N22-in-process-extensions.md#scope`; `docs/plans/build-harness.md#32-session-log-api`
- **Non-goal: "An MCP-server facade"** ("a thin `run_task` facade can follow a consumer"). — `docs/plans/build-harness.md#1-goal-and-non-goals`; `docs/guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport`
- **Portability.** N46a includes "A workerd smoke test that loads pi-schema and the MCP client". — `docs/todos/ready/N46a-cloudflare-state-adapters.md`; `docs/plans/build-coding-agent.md#4-changes-to-the-sdk-and-harness-plans`
- **Ablation.** `AblationConfig` has `mcp: boolean` and `extensions.mcp`, and N39 measures the run with MCP switched off. — `docs/plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis`

### Inferences
- The MCP design treats servers as an operator's static configuration in a single-user process. Nothing models the user who owns a connection, the OAuth state, or a token's lifetime.
- `@modelcontextprotocol/client` 2.4.0 ships OAuth client helpers, so "what the client library provides" probably means an `authProvider` hook. The harness gives no `OAuthClientProvider` implementation, store or redirect handling. A browser redirect also has no channel in the protocol's three server requests (not inspected here; HD6 lists "three server requests").
- Two credential paths could collide. An HTTP MCP server reached "through the egress proxy's allowlist" could get its bearer token from a `CredentialRoute`, but routes are loopback reverse-proxy URLs, and an MCP client connects to the server's real URL. How an MCP HTTP transport uses a sentinel route is unspecified.
- Deferred exposure plus `outputTrust: "untrusted"` is a good default, but no rule ties untrusted MCP output to later write calls. That is the triage agent's AD5 taint rule, which lives in the product, not the harness.

### Gaps
- No OAuth 2.1 flow (discovery, dynamic or CIMD client registration, PKCE, redirect, refresh) for remote MCP servers.
- No token store or vault abstraction, and no refresh or revocation path. `CredentialRoute.secret()` is a bare thunk.
- No per-user or per-tenant connection model; `McpServerConfig` has no owner.
- No `headers` or `auth` field on the HTTP transport config.
- No content-hash or version pin for MCP servers (stdio command, package or tool-list hash), and no rug-pull check that a server's tool definitions changed between sessions. `tools/list_changed` is accepted at the next turn with no re-review.
- No harness default tier or ask rule for `mcp:*` tools; the general no-match rule (ask or deny) is the only default.
- No elicitation or sampling support is planned. Neither word appears in the plans.
- No MCP server hosting for our own tools (a non-goal).

---

## 2. SDK: the tool definitions and approvals a connector tool would use

### Takeaway
The SDK gives a connector tool everything at the loop level and nothing connector-specific:
- `ToolDefinition` with `kind` (including `dynamic`), `exposure`, `firstParty`, `resourceKey`, `redactErrors` and `formatError`;
- the canonical name rule, under which `mcp__<server>__<tool>` must pass;
- a `beforeToolCall` gate returning allow, deny or ask, where ask ends the run `awaiting_approval` with an HMAC-signed pause.

Validation of MCP tool input inside the SDK is a deliberate choice, because SDKs such as Vercel's pass dynamic MCP tools through unvalidated.

### Cited findings
- **`ToolDefinition`:**
  - `kind: "function" | "dynamic" | "provider-local" | "provider-executed"`;
  - `exposure?: "direct" | "deferred" | "hidden"`, where "deferred tools are not sent until activated";
  - `firstParty?: boolean`, where "only first-party readOnlyHint affects scheduling";
  - `resourceKey`, `redactErrors`, `formatError` and `execute(input, ctx)`.

  — `docs/plans/build-sdk.md#33-sdk-api`
- **Gate.** `GateDecision = allow | deny | ask{policyVersion}`. "'ask' without blockingApprovals: the run pauses with awaiting_approval." — `docs/plans/build-sdk.md#33-sdk-api`
- **D5.** A pluggable `ApprovalSigner`; an unsigned or invalid resume fails closed. The harness always uses `hmacSigner()` (HD5, ADR 0035). — `docs/plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5`
- **D12.** The canonical rule is `^[A-Za-z0-9_-]{1,64}$`, "and namespaced names such as `mcp__<server>__<tool>` follow the same rule". — `docs/plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-accepted`
- **SDK guide §4.** "Vercel's raw JSON Schema and dynamic MCP tools reach `execute` unvalidated unless a validator is passed", so validation lives in the SDK. Tools are "namespaced by source (`mcp__<server>__<tool>`)". — `docs/guides/agent-sdk.md#4-tools-should-take-standard-schema-validate-inside-the-sdk-and-return-every-failure-to-the-model-as-data`
- **Non-goal.** "the MCP client and registry, tool search … belong to the harness plan". — `docs/plans/build-sdk.md#1-goal-and-non-goals`
- **Server rollback research.** "Vercel's MCP adapter drops `isError`". MCP's `isError` exists so the model can self-correct. — `docs/research/reversible-actions/fact-check-server-rollback.md` (rows 51, 54)

### Inferences
- A connector tool is a `dynamic` `ToolDefinition` whose JSON Schema comes from a remote server. It is validated by pi-schema (D7) and gated by `beforeToolCall`, so the SDK side needs no new type.
- The 64-character limit matters for connectors. `mcp__<server>__<tool>` with long server names will hit it, and D12's reversible sanitising has to handle that.

### Gaps
- No idempotency key on `ToolContext`. It is proposed only in product plans (the coding agent's side-effects bullet, and PF5's safety package).
- No typed outcome (`not_applied`, `compensated`, `partial`, `unknown`) on `ToolResult` for remote writes. That too is only proposed by research and PF5.

---

## 3. Coding agent plan: one GitHub App as the only connector

### Takeaway
The personal coding agent's only outside integration is one GitHub App. The control plane mints a one-hour installation token per task, narrowed to one repository, and adds it at egress. The git route rejects pushes outside `refs/heads/agent/*`, deletions and tags. Triggers are the CLI and GitHub webhooks only. There is no MCP, no other API tool and no OAuth. Multi-user connections are explicitly out ("A multi-user agent would need per-user installations and a new record").

### Cited findings
- **CA5 / ADR 0034.**
  - One App with its repositories selected by the owner, and a token minted per task with the `repositories` parameter. "The token stays in the control plane and reaches GitHub only through the egress route."
  - Branch scope comes from the route's ref filter plus a default-branch ruleset.

  — `docs/plans/build-coding-agent.md#ca5-one-github-app-minted-outside-the-sandbox-pushing-only-to-agent-branches-accepted`; `docs/decisions/0034-github-app-identity.md#decision`, `#consequences`
- **Architecture.**
  - "model key and GitHub token added here" at the `outboundByHost` egress route.
  - "The agent's only outward writes are git pushes and GitHub API calls. Each carries an idempotency key persisted before the call."
  - The sandbox "holds no credential".

  — `docs/plans/build-coding-agent.md#3-architecture-the-loop-in-a-durable-object-the-sandbox-without-credentials`
- **CA7 / W5: ingress.** Triggers are the CLI and a GitHub issue label or comment, "accepted only from the owner, with hidden HTML stripped". Requests are deduplicated by id, with `X-GitHub-Delivery` for webhooks. "Slack and schedule triggers" are out of scope. — `docs/plans/build-coding-agent.md#ca7-triggers-start-with-the-cli-and-github-webhooks-behind-one-ingress-design-decided`; `docs/todos/ready/W5-control-plane-ingress.md#scope`
- **CA6.** Commands in the sandbox run without per-call prompts. "The harness's permission pipeline still asks before any call that leaves those bounds, such as a new egress host." — `docs/plans/build-coding-agent.md#ca6-the-draft-pull-request-is-the-approval-point-accepted`
- **W3.** Token minting, the ref filter and recorded `git push` fixtures. Acceptance criterion: "The token never appears in the sandbox's environment or output." — `docs/todos/ready/W3-github-app-identity.md#acceptance-criteria`
- **Non-goals.** "Other users' repositories, tenancy and billing" and "per-user GitHub installs". — `docs/plans/build-coding-agent.md#1-goal-and-non-goals`

### Inferences
- The GitHub App is the repo's template for a connector: a credential minted host-side, short-lived and narrowed to one resource, injected at egress, with a semantic filter at the route (git refs) and a second layer at the provider (the ruleset). A generic connector design could copy this four-part shape: mint, narrow, inject, filter.
- The egress route parses a protocol (git smart HTTP). Per-connector routes that parse API semantics, such as allowed endpoints and methods, are the natural extension of N43's `routes` kinds.

### Gaps
- No generic route kind for REST or MCP-over-HTTP with endpoint-level filters; only git is designed.
- No webhook ingress beyond GitHub, and no ingress design for an outside app's events (Slack, Linear and others).

---

## 4. Platform plan (PR #18, now on `main`): credential custody, the stdio MCP ban and "integrations through MCP"

### Takeaway
The platform plan is the only document that names user-chosen integrations, and it does so in one sentence: "The platform reaches integrations through MCP servers the user names." It then bans stdio MCP commands in generated configuration (PF9 / ADR 0042) and allowlists "the user's named MCP hosts" for egress (F11). Its credential custody (PF6, PF7, ADR 0040, F1) covers only the platform's own connections: cloud deploy credentials, GitHub sign-in, the GitHub App and the user's model key. These are stored encrypted under a per-tenant AES-GCM data key wrapped by a platform key. No todo covers how a user names an MCP server, how that server's OAuth tokens are obtained or stored, or how a deployed agent authenticates to it.

### Cited findings
- **Non-goal.** "A visual canvas, multi-agent design and the long tail of integrations. Incumbents are strongest there … The platform reaches integrations through MCP servers the user names." — `docs/plans/build-agent-platform.md#1-goal-and-non-goals`
- **PF6 / ADR 0040.** Cloudflare OAuth or an account token, a Vercel integration or a project token, and an AWS role with `sts:ExternalId`. "The platform stores OAuth refresh tokens, API tokens and role ARNs encrypted under the tenant's key in its own control plane, and uses them only in the deploy adapters. They never enter a sandbox, the generator's context or the generated code." — `docs/plans/build-agent-platform.md#pf6-users-connect-their-own-clouds-with-scoped-expiring-credentials-accepted-adr-0040`; `docs/decisions/0040-tenant-cloud-connections-and-byok.md#decision`
- **PF7.** BYOK, preferably held in the user's own Cloudflare AI Gateway with `byok_only` on; the fallback encrypts the key under the tenant's key and adds it at egress. — `docs/plans/build-agent-platform.md#pf7-the-users-own-model-key-with-no-fallback-to-ours-accepted-adr-0040`
- **F1.** "Implement envelope encryption with Web Crypto: a random AES-GCM data key per tenant, wrapped by the platform key." "Make every decrypt take the caller's tenant id and fail when it differs." — `docs/todos/ready/F1-platform-tenancy.md#tasks`
- **F7.** "Register the OAuth client and implement the flow"; "Store connection credentials encrypted under the tenant key (F1)". Open question: "OAuth scopes for Workers deploys need confirming". — `docs/todos/ready/F7-cloudflare-connection-and-deploy.md#tasks`; fact-check row 31 in `docs/plans/reviews/fact-check-build-agent-platform.md`
- **PF9 / ADR 0042.** "never let a generated config name a stdio MCP command". "Egress is denied by default, with package registries and the user's named MCP hosts on the allowlist. The gate also rejects any generated MCP configuration that names a command instead of a URL." — `docs/plans/build-agent-platform.md#pf9-generated-code-runs-only-in-a-fresh-hosted-sandbox-accepted-adr-0042`; `docs/decisions/0042-generated-code-isolation.md#decision`
- **F11.** In scope: "The allowlist: package registries and the user's named MCP hosts" and "The gate rule that rejects command-based MCP configuration". Acceptance criterion: "A generated config with an MCP `command` fails the gate." — `docs/todos/ready/F11-generated-code-isolation.md#scope`
- **F15.** It attacks "MCP-config injection" among other classes. — `docs/todos/ready/F15-security-review.md#goal`
- **Architecture.** "Control plane … is the only component that decrypts a tenant's credentials." — `docs/plans/build-agent-platform.md#3-architecture-a-per-tenant-engine-a-gate-it-cannot-bypass-and-deploys-into-the-users-account`
- **F2 / PF12.** GitHub OAuth web flow with `state` checking, for sign-in only. — `docs/todos/ready/F2-github-sign-in.md#scope`

### Inferences
- "MCP servers the user names" means a URL-only MCP config written into the generated agent, which runs in the user's own cloud. The platform therefore implicitly leaves MCP OAuth to the generated agent's SDK, for example Cloudflare `addMcpServer`, whose OAuth tokens live in the agent's own Durable Object SQLite (see §5).
- That fits PF6's "we are not the custodian" stance, but the plan never says so. It also leaves no gate check that the generated agent requests the right scopes or stores tokens safely.
- PF6's revocation story is implicit. Users revoke at the provider, and the platform has no "disconnect" flow or refresh-failure handling in any todo.

### Gaps
- No add-MCP-server flow in the platform UI or API, and no record type for a named MCP host per tenant or per agent.
- No OAuth for MCP servers, either at build time (the generator testing against a real server) or at run time in the deployed agent.
- No token refresh, rotation, revocation or disconnect for any stored credential. F1 has no key rotation, and the audit log (PF11) records "connection change" without defining one.
- No per-connector permissions: no tier, ask rule or scope check tied to a named MCP host. Generated agents rely on the safety package (PF5) and the target SDK's `needsApproval` / `toolApproval`.
- No review or pinning of a user-named MCP server's tool list. A server the user names is trusted for content once allowlisted.

---

## 5. Verified SDK references: MCP and connector support in our eight SDKs

### Takeaway
All eight SDKs document MCP, but our harnesses ran MCP for only four of them, all offline:
- Claude ran in-process SDK MCP servers.
- Cloudflare ran `createMcpHandler` plus `addMcpServer` over loopback.
- Copilot ran a local stdio server.
- Vercel ran `@ai-sdk/mcp` over an in-process transport.

OpenAI, LangChain, Google ADK and Pi skipped every external-MCP example. **No harness ran any OAuth MCP flow.** Cloudflare's `addMcpServer` is the only SDK whose docs describe a full client OAuth flow with token persistence, and that flow is unverified.

### Cited findings
| SDK (pin) | What our reference says about MCP and connectors | Verified in our harness? |
| --- | --- | --- |
| Claude Agent SDK | Custom tools are in-process MCP servers (`createSdkMcpServer`), seen as `mcp__<server>__<tool>`. **[verified: 02]** Tool search defers MCP tools by default. **[verified]** `mcpServers` takes stdio `{command,args,env}`, `{type:"sse",url,headers}`, `{type:"http",url,headers}` or an SDK server; `permission_policy: "always_ask"` forces a prompt. External servers carry no verification tag. — `docs/reference/claude-agent-sdk/guide.md#5-custom-tools-are-in-process-mcp-servers`, `#6-external-mcp-servers-plug-in-through-four-config-types` | Yes, in-process only (examples 02–04, 07; `verify/claude-agent-sdk/examples/07-triage-agent.ts`) |
| OpenAI Agents | MCP servers: "hosted MCP, Streamable HTTP or stdio"; hosted tools need the Responses API. — `docs/reference/openai-agents-sdk/guide.md#5-function-tools-run-your-code-hosted-tools-run-on-openai`. Mirror check: `hostedMcpTool` has `authorization`, plus `requireApproval` (`'never'` by default) and `onApproval` (`source/docs/.../guides/mcp.mdx`). Without prefixing it throws "Duplicate tool names found across MCP servers" (`docs/research/agent-harness/notes/interfaces-and-extensions.md#7-mcp-client-design-namespace-tools-defer-them-and-support-both-protocol-eras`) | No: "external MCP servers (3)" skipped (`docs/reference/openai-agents-sdk/fact-check.md`; `verify/openai-agents-sdk/scripts/run-examples.mjs` skips `MCPServer(Stdio\|StreamableHttp\|SSE)`) |
| Vercel AI SDK (`@ai-sdk/mcp` 2.0.90) | `createMCPClient({transport})`, then `client.tools()`; HTTP, SSE and stdio, or a custom `MCPTransport`. A transport without `supportsProtocolVersionDiscovery` uses legacy `initialize`. **[verified: 08]** — `docs/reference/vercel-ai-sdk/guide.md#10-mcp-tools-become-ordinary-tools`. Mirror check: an optional `authProvider` OAuth client provider (`16-mcp-tools.mdx:56`) | Yes, in-process transport (`verify/vercel-ai-sdk/examples/08-mcp-tools.ts`) |
| Cloudflare `agents` 0.33.0 | Serve with `createMcpHandler(() => new McpServer…)` (`McpAgent` deprecated); connect with `this.addMcpServer(name, url)`, which persists in SQLite; `this.mcp.listTools`, `callTool` and `getAITools()` (names like `tool_qYqSDmpU_lookupOrder`). **[verified: 07]** Loopback allowed for dev. — `docs/reference/cloudflare-agents/guide.md#10-serve-mcp-with-createmcphandler-and-connect-to-it-with-addmcpserver`. Skill: F3 `sendIdentityOnConnect`; with it off, `addMcpServer` needs `callbackPath` (`.agents/skills/cloudflare-agents/SKILL.md`). Mirror check (`agents/docs/agents/mcp-client.md`): state `authenticating` with `authUrl`, a callback at `/{agentsPrefix}/{agent}/{instance}/callback`, "OAuth tokens are securely stored in SQLite", dynamic client registration by default, `createMcpOAuthProvider` override, `configureOAuthCallback`, url-mode elicitation "for sensitive flows like OAuth URLs". `securing-mcp-servers.md`: `@cloudflare/workers-oauth-provider` `OAuthProvider` for our own servers | Yes, without auth (`verify/cloudflare-agents/examples/07-mcp.ts`). "OAuth MCP flows" not run (`docs/reference/cloudflare-agents/fact-check.md`; `docs/todos/done/S6a-cloudflare-verify.md`) |
| LangChain | "`@langchain/mcp-adapters` … is outside our pinned set, so its examples were skipped." — `docs/reference/langchain/guide.md#11-mcp-multi-agent-patterns-and-deep-agents-sit-beside-the-core`. Mirror check: `MultiServerMCPClient`, per-server `ClientGroup` for protocol eras, and auth with "Bearer tokens, OAuth 2.1, and per-user server auth" (`source/src/oss/langchain/mcp/index.mdx:177`) | No (fact-check: "external databases and MCP servers" skipped) |
| Google ADK 2.5.0 | Our guide never documents `MCPToolset`; it notes `WebMCPToolset` is TypeScript-only and that TS lacks `McpInstructionProvider` and toolset-level auth. — `docs/reference/google-adk/guide.md#14-typescript-parity-250-lacks-14-python-features-has-2-in-weaker-form-and-has-15-the-docs-show-only-for-python`. Mirror check: `MCPToolset(connectionParams\|streamableParams\|sseParams)` with bearer headers (`source/adk-js/docs/guides/tools/mcp_tool/index.md`) | No: "42 MCP sources" skipped, plus "Google API OAuth (2)" (`docs/reference/google-adk/fact-check.md`) |
| Copilot SDK | `mcpServers` with `type: "local"` (stdio) or `type: "http"` (URL plus headers); a `tools` filter; names are `<server>-<tool>`; calls ask `onPermissionRequest` with `kind: "mcp"`. **[verified: 07]** — `docs/reference/copilot-sdk/guide.md#9-mcp-servers-plug-in-per-session-and-their-tools-arrive-as-server-tool` | Yes, local stdio (`verify/copilot-sdk/examples/07-mcp-server.ts`; fact-check rows 90–92) |
| Pi | The CLI loads MCP as a built-in extension; SDK sessions must add `createMcpExtension()`. Project trust gates `.pi/mcp.json`. — `docs/reference/pi/guide.md#5-four-built-in-tools-by-default-and-custom-tools-through-customtools`, `#6-extensions-are-the-only-gate-on-tool-calls`. Mirror check (`source/coding-agent/mcp.md`): per-server `exposure`, `headers`, `oauth` ("Authenticate with OAuth"), `${ENV}` and `!command` header values; SSE rejected | No: "external MCP server process" skipped (`verify/pi/scripts/run-examples.mjs`) |

- **Feature table summary:** "all eight take typed custom tools, and all document MCP". — `docs/comparison/feature-table.md#tools-all-eight-take-typed-custom-tools-and-all-document-mcp`
- **Lockfile:** `@modelcontextprotocol/client` 2.4.0, `@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/sdk` 1.32.2 (`verify/cloudflare-agents/package.json`); `@ai-sdk/mcp` 2.0.90 (`verify/vercel-ai-sdk/package.json`).

### Inferences
- For the platform's M8 targets (PF2), Cloudflare `agents` has a documented client OAuth flow and server-side OAuth (`workers-oauth-provider`), and Vercel has an `authProvider` hook with no store. A generated Cloudflare agent could hold per-user MCP tokens in its own Durable Object; a Vercel agent would need a token store we provide.
- Claude and Copilot accept only static `headers` for remote servers in our references, so their per-user OAuth would sit outside the SDK.
- Exposure and approval vary widely:
  - Claude defers MCP tools behind tool search by default.
  - Copilot asks per call with `kind: "mcp"`.
  - OpenAI's hosted MCP defaults to `requireApproval: 'never'`.
  - Cloudflare's `getAITools()` tools carry no approval unless wrapped.

  Any generated-agent template must set the approval policy explicitly.

### Gaps
- No verified OAuth MCP flow in any SDK, including the platform's two M8 targets.
- No verified remote (HTTP) MCP call with auth in any harness. Cloudflare's loopback run had no auth.
- No reference documents ADK's `MCPToolset`, LangChain's adapters, or Pi's MCP OAuth from a run.

---

## 6. Research reports: connectors, MCP security, tool poisoning and credentials

### Takeaway
The research knows the market and the threat model. Every builder treats MCP as table stakes and reaches the integration catalogs through it. Anthropic's Managed Agents vault is the strongest documented credential design: per-user `mcp_oauth` credentials keyed by server URL, auto-refresh, and egress substitution. MCP configuration is an exploited path to remote code execution (Flowise CVE-2025-59528; Langflow CVE-2026-105697 through a stdio command). Malicious MCP servers count as supply-chain risk made worse by missing pinning. Practitioners increasingly treat remote MCP with OAuth as the credential boundary. **"Tool poisoning" (malicious instructions hidden in tool descriptions) and "rug pulls" (tool definitions that change after review) are never named.** The closest the research comes is the lethal trifecta, Invariant's GitHub MCP toxic flow, and the rule that annotations are untrusted.

### Cited findings
- **Vendor platforms §4.** "MCP is universal."
  - Anthropic vaults hold per-user credentials referenced by ID. `mcp_oauth` and `static_bearer` credentials are "keyed by MCP server URL and injected automatically", and "with a `refresh` block, Anthropic refreshes OAuth tokens on your behalf". `environment_variable` placeholders are swapped at egress; "The agent never sees the secret value". Vaults are workspace-scoped.
  - Also noted: AWS AgentCore Identity and Gateway, Google Agent Identity / Registry / Gateway, OpenAI's Connector Registry (beta), and Salesforce MCP with client credentials only.

  — `docs/research/deployment/notes/vendor-platforms.md#4-tools-mcp-connectors-and-credential-handling`
- **Managed Agents note.** "MCP OAuth tokens in a vault, accessed via proxy with session-scoped token." — `docs/research/notes/custom-harness-architecture.md` (Managed Agents, Apr 8 2026)
- **U12 report.**
  - "an agent is a model plus instructions, tools, skills and MCP servers, stored as a config object". — `docs/research/deployment/agent-building-platforms.md#prompt-to-agent-is-table-stakes-and-its-output-is-vendor-configuration`
  - "MCP configuration has become a new path to remote code execution" (Flowise CVE-2025-59528, exploited from April 2026; Langflow CVE-2026-105697), and the three lessons. — `docs/research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere`
  - Table stakes include "an MCP client and 'export as MCP server'". "It must also compete on integrations, where Sim lists 280+ … A new platform should reach those catalogues through MCP rather than rebuild them." — `docs/research/deployment/agent-building-platforms.md#where-a-new-platform-could-win-what-it-must-match-and-the-first-slice`
  - "The first is the product shell every hosted platform already sells: ingress and triggers, a control plane, a UI, integrations and notifications." — `docs/research/deployment/agent-building-platforms.md#our-strengths-are-specifications-and-a-verification-corpus-not-a-product`
- **Low-code builders.** n8n, Langflow, Dify, CrewAI and Gumloop act as MCP client and server. Gumloop offers "MCP Server Hosting", "MCP Server Proxying" and tunnels. Lindy "saves API-key credentials". — `docs/research/deployment/notes/low-code-builders.md#4-model-choice-bring-your-own-key-mcp-support`. MCP RCE CVEs, and "CVE-2026-70478, Unauthenticated OAuth2 token refresh endpoint returns access tokens". — `docs/research/deployment/notes/low-code-builders.md#9-security-incidents-and-sandboxing-of-code-nodes`
- **Sandbox and credential providers.** Daytona placeholders map to our sentinels; E2B, Vercel and Cloudflare inject by host, and E2B "Every process in the sandbox that sends an HTTPS request to that host gets the secret". Only Cloudflare reproduces our method check natively. E2B Workload Identity mints short-lived OIDC tokens. — `docs/research/deployment/notes/sandbox-and-credential-providers.md#credentials-how-each-provider-or-pattern-keeps-api-keys-and-repo-tokens-out-of-the-sandbox-compared-with-hd15n20`
- **Practitioners on security.**
  - "MCP went from 'insecure by design' in 2025 to 'the credential boundary' for a growing minority in 2026": about 177 authors in total, and about 67 of them call remote MCP with OAuth safer than an API key. Counter-view: "the spec permits OAuth but does not enforce it".
  - Malicious skills, plugins and MCP servers are "ordinary supply-chain risk made worse by missing pinning" (postmark-mcp BCC backdoor).
  - Implication 8: "Offer MCP-style brokered tools as the safe path for services, and bash as the opt-in path".

  — `docs/research/practitioners/notes/security-and-build-vs-buy.md#mcp-went-from-insecure-by-design-in-2025-to-the-credential-boundary-for-a-growing-minority-in-2026`, `#malicious-skills-plugins-and-mcp-servers-are-seen-as-ordinary-supply-chain-risk-made-worse-by-missing-pinning`, `#design-implications-for-our-sdk-harness-and-agent`
- **Practitioners on harnesses.** "The MCPs of today are fully remote, stateless, oauth enabled"; "Do not build on consumer-subscription credentials." — `docs/research/practitioners/notes/harnesses-and-sdks.md`
- **Main report.** Layer 4, "Tools and MCP": "Build tools; adopt MCP SDKs … MCP client on the 2026-07-28 stateless core; tool search once tool count grows". The 2026-07-28 revision removed `initialize` and sessions and added `server/discover` and the `Mcp-Method` and `Mcp-Name` headers. Mastra is cited for "MCP as client *and* server", and Goose for "Every extension is an out-of-process MCP server (70+)". — `docs/research/agent-sdks-and-harness-design.md#a-reference-architecture-in-eight-swappable-layers`, `#tools-and-context-deserve-more-effort-than-the-prompt`, `#open-source-frameworks-are-better-quarries-than-foundations`
- **Agent research and guide.** The lethal trifecta. Invariant Labs' GitHub MCP "toxic agent flow". MCP clients "should never make tool use decisions based on ToolAnnotations received from untrusted servers". — `docs/research/agent/notes/safety-gates.md#2-the-lethal-trifecta-is-the-threat-model-and-the-outbound-leg-is-the-one-to-cut`; `docs/guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg`
- **Twelve-factor report.** Factor 11, "Trigger from anywhere", is our one gap: "no ingress is designed". "Once the agent writes to a helpdesk it does not own, safety moves to the edges: deduplicated ingress on the way in, and keyed writes with explicit `unknown` outcomes on the way out." — `docs/research/external-designs/twelve-factor-agents.md#five-small-changes-follow-led-by-an-ingress-design`, `#conclusion-safety-moves-to-the-edges-once-the-agent-writes-to-a-helpdesk`
- **Reversible actions.**
  - Sagas: MCP 2026-07-28 Tasks extension `io.modelcontextprotocol/tasks` (`working | input_required | completed | failed | cancelled`). A saga tool should "surface the plan approval as `input_required`". — `docs/research/reversible-actions/sagas.md`
  - Server rollback: four outcome kinds. "Only Anthropic (`is_error`) and MCP (`isError`) carry an error flag." — `docs/research/reversible-actions/server-rollback.md`

### Inferences
- Taken together, the research describes a connector design without anyone having written it: Anthropic-style vault entries keyed by MCP server URL, injected at our egress route; a remote MCP server as the credential boundary; tool search for scale; and MCP Tasks for long-running writes with approval.
- Tool poisoning is partly covered by existing rules: deferred exposure, untrusted output, taint (AD5), and no scheduling on annotations. But tool *descriptions* reach the model unfiltered, and no one has threat-modelled that.

### Gaps
- No research on MCP OAuth specifics: the 2025-06 and 2025-11 authorization spec, resource indicators (RFC 8707), CIMD versus dynamic client registration, token audience binding, or the confused-deputy problem for MCP proxies.
- No research on tool-description poisoning, cross-server tool shadowing or rug pulls, or on mitigations such as description hashing and diff review.
- No survey of connector catalogs and registries (the official MCP Registry, Smithery, Composio, Pipedream, Zapier MCP and the like) or their trust signals.
- No research on per-user consent UX, incremental scopes, or revocation and disconnect flows.

---

## 7. The deferred triage agent: the `Helpdesk` interface and MCP-sourced tool tiers as a pattern

### Takeaway
The triage plan is deferred (ADR 0032), but it holds the repo's most complete "one outside app" pattern:
- a typed boundary interface (`Helpdesk`) that is the agent's only way out;
- three implementations: a fake, a shadow wrapper and a real adapter through the credential proxy;
- a tier table in code where "any tool without a table entry, including every MCP-sourced tool, gets T3" (always asks one person);
- `approvalReuse: "none"` for T2–T4;
- session taint from `outputTrust: "untrusted"` tools, which blocks T2+ calls derived from untrusted text;
- the owner naming the real system, a sandbox account and the credential's scopes at A24.

### Cited findings
- **AD14 / ADR 0031.** "One `Helpdesk` interface is the agent's only way out"; `fakeHelpdesk`, `shadowHelpdesk(real)`, and "The real adapter (A24) calls the owner's helpdesk through the harness's credential proxy, so no credential enters the agent process's tools or the log." The owner supplies "which helpdesk …, a sandbox account in it, the scopes of its API credential, and the approval surface". — `docs/plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted`; `docs/decisions/0031-helpdesk-interface.md`
- **Interface details.** `sendReply(ticketId, {body})` takes "no recipient: fixed to the requester"; `getTicket` body "is untrusted"; `WriteReceipt { id; shadow; at }`. — `docs/plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts`
- **AD2.** The tier table as code compiles into deny rules plus the host callback, with no allow rules. "Any tool without a table entry, including every MCP-sourced tool, gets T3." Changing a T2+ row needs the security owner and the product owner, and the table is hash-checked against `policy/CHANGELOG.md`. — `docs/plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-accepted`
- **AD5.** A session is tainted when any block comes from a tool with `outputTrust: "untrusted"`. "A permission hook denies any T2+ call proposed in a tainted session." — `docs/plans/build-agent.md#ad5-hd1s-per-block-origin-plus-a-per-session-taint-and-no-per-argument-tracking-provisional`
- **Tool contract.** `name: <service>_<verb>_<resource>`, a description of three or more sentences "including when not to use it (lint)", "no identity-shaped fields (lint)", `tier`, `outputTrust`, `outputBudgetTokens`, `initiator` ("T3 and T4 tools are code-initiated only"). `lintTools` fails the build. — `docs/plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts`; `docs/todos/ready/A3-tool-contract-lint.md`
- **Agent guide §5.** "unreviewed and MCP-sourced tools default to T3". — `docs/guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg`

### Inferences
- The pattern generalises to a connector SDK:
  - a typed per-app interface with fake and shadow implementations;
  - a real adapter that holds no credential and reaches the app through an egress route;
  - a tool lint;
  - a per-tool tier and default-T3 rule for anything unreviewed, including MCP;
  - taint from connector output.
- A "connector review" step could promote an MCP tool from the default T3 into a reviewed row of the tier table, with the two-owner sign-off and hash check AD2 already defines. That is a ready-made review and pinning mechanism at the policy level.

### Gaps
- The pattern is per product and hand-built; there is no generic connector interface or registry.
- The tier table pins tool names, not definitions. An MCP server that changes a reviewed tool's schema or description keeps its tier.

---

## 8. Gaps: what a connector feature still needs

Each item below has no plan, decision or todo in the repo today, unless one is noted.

1. **Connector catalog.**
   - A record type for a connector: name, MCP URL or API base, auth kind, scopes, publisher and version, tool list with definition hashes, default tiers.
   - A source for entries: a curated list, the MCP Registry, or user-added.
   - The platform's non-goal only says "MCP servers the user names". The harness's `McpServerConfig` has no publisher, version or auth fields.
2. **Add flow.**
   - A UI or API to add or name an MCP server or API connector per tenant, user or agent.
   - URL validation: HTTPS only, no private or metadata ranges (reuse N20's rule), no `command` (reuse F11's rule).
   - A first connection that runs `tools/list` for review.
   - Wiring the named host into the agent's egress allowlist (F11 names the allowlist, not the flow that fills it).
3. **Per-user OAuth.**
   - An MCP authorization client: discovery of protected-resource and authorization-server metadata, CIMD or dynamic client registration, PKCE, resource indicators.
   - A redirect and callback route, and the consent state machine. Cloudflare's `authenticating` / `authUrl` / callback is the only documented model, and it is unverified.
   - A protocol path to surface `authUrl` to a CLI or PR user. The harness protocol has no such server request, and no elicitation is planned.
   - N25 excludes OAuth beyond the library.
4. **Token vault.**
   - Storage of access and refresh tokens keyed by (tenant, user, connector URL), encrypted with F1's per-tenant envelope keys.
   - A `CredentialRoute.secret()` implementation that reads the vault and injects at egress (HD15, N43), so tokens never enter the sandbox or the log.
   - A decision on who holds the vault: the platform control plane, or the generated agent's own Durable Object as with Cloudflare `addMcpServer`. PF6's "not the custodian" stance argues for the latter, but no record decides it.
5. **Refresh and revocation.**
   - Refresh before expiry and on 401, with a single-flight lock per token (Durable Object alarms fire at least once).
   - Handling of refresh failure (connection marked `needs-auth`, task paused or handed off).
   - A user-initiated disconnect that revokes at the provider and purges the vault.
   - Rotation of F1's platform and tenant keys.
   - Audit entries for each event (PF11 says "connection change" without a schema).
6. **Per-connector permissions.**
   - A default tier or ask rule for `mcp:<server>:*` in the harness or product (only the triage plan's "MCP gets T3" exists).
   - Per-connector OAuth scopes mapped to tool tiers.
   - Per-connector method and endpoint filters at the egress route (only git refs are designed, in N43 and W3).
   - `approvalReuse: "none"` for writes.
   - Taint (AD5) carried into the harness or the safety package (PF5) so generated agents get it.
   - An explicit approval policy in every generated template, because SDK defaults differ (OpenAI hosted MCP `requireApproval: 'never'`; Cloudflare `getAITools()` ungated).
7. **Connector review and pinning.**
   - Extend N22's `extensions.lock.json` (SHA-256) to MCP servers: a pinned URL or package version and a hash of each tool's name, description and schema.
   - Refuse or re-ask when `tools/list_changed` or a new session shows a changed definition (rug pull). N25 currently re-registers silently at the next turn.
   - A review step that promotes a tool from the default tier into a reviewed tier-table row, with AD2's two-owner sign-off.
   - A threat model for tool-description poisoning and cross-server shadowing (absent from the research), added to F15's attack classes.
8. **Triggers and webhooks.**
   - A generic ingress for outside-app events (Slack, Linear, email and others) with signature checks, sender checks and deduplication.
   - W5 builds the CLI plus GitHub only and leaves "Slack and schedule triggers" out of scope. The 12-factor report's ingress gap remains for any other app.
   - MCP-side notifications (resource subscriptions, `subscriptions/listen` in 2026-07-28) are not considered as triggers.
9. **Hosting MCP servers for our own tools.**
   - The harness lists "An MCP-server facade" as a non-goal. U12 lists "export as MCP server" as table stakes.
   - Cloudflare `createMcpHandler` (verified) plus `@cloudflare/workers-oauth-provider` (documented, unverified) is the obvious path for exposing our agents or connectors over MCP with OAuth. No todo covers it.
10. **Verification.**
    - Run an OAuth MCP flow and an authenticated remote HTTP MCP call in at least the two M8 targets' harnesses (Cloudflare `addMcpServer` OAuth; Vercel `authProvider`).
    - Cover the four SDKs whose MCP examples were skipped (OpenAI, LangChain, ADK, Pi) where the platform or harness would rely on them.
    - The `@modelcontextprotocol/client` 2.4.0 OAuth helpers HD14 relies on are unverified. N24 checks only the era probe.
11. **Long-running connector writes.** Idempotency keys and typed outcomes for connector writes in the harness, not just in product plans and PF5. Use of the MCP Tasks extension (`input_required` for approvals) as the sagas report proposes.
