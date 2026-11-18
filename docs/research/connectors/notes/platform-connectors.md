# Agent platform connectors: fact sheet (as of 2026-11-18)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-connectors.md](../fact-check-agent-connectors.md) and applied in [the report](../agent-connectors.md), which supersede this note where they disagree.

Scope: how agent platforms let a user or admin add integrations ("connectors") that let the agent read and act in other apps. The notes cover connector unit and protocol, add flow and governance, auth and token custody, per-tool permissions, counts, pricing and availability, and security incidents.

Conventions:
- Every claim carries a URL. Sources marked **(secondary)** are search summaries, vendor blogs, press or third-party guides, not the platform's own docs.
- "Inference" means my reading of the sources, not something they state.
- Fetched pages were treated as data. Where a vendor doc contradicts a secondary source, the vendor doc wins.

---

## 0. Cross-platform summary (one line per question)

| Question | Takeaway |
|---|---|
| Connector unit | Remote MCP over Streamable HTTP is now the common unit everywhere. The exceptions are the native integrations each vendor keeps alongside it: Microsoft's Power Platform connectors (OpenAPI/Swagger), Google's ingestion data stores, OpenAI's legacy `connector_id`s and Salesforce named credentials. SSE is deprecated or unsupported at Copilot Studio, Gemini Enterprise, Slack and Linear. |
| Add flow / governance | On consumer plans, users add a connector themselves. On enterprise plans, an admin enables it or adds the custom URL first, and each member then authenticates individually. Custom MCP is usually gated by an org-level switch: Claude Owner-only, ChatGPT developer mode plus RBAC, the Gemini org-policy constraint `gcp.disableCustomMcpServer`, Notion "Approved only", and GitHub "Registry only". |
| Auth / custody | The default is per-user OAuth 2.1 (authorization code with PKCE), with CIMD or DCR for client registration. Shared static headers or API keys are an admin option. Tokens stay with the platform (Anthropic vault, AgentCore Token Vault, Foundry project connection, Google auth manager), and the strongest designs keep secrets out of the sandbox and the model: Claude Managed Agents substitutes them at egress, and AgentCore Gateway injects them server-side. |
| Per-tool permissions | Most platforms offer a three-way setting (always allow, ask, block) per tool, and some also separate read from write using the MCP annotations `readOnlyHint` and `destructiveHint`. Defaults vary: MCP is ask-first in Claude Managed Agents, Gemini Enterprise and Notion (write tools), but GitHub's cloud agent never asks. |
| Security | Documented incident classes are indirect prompt injection through connected data (GitHub MCP, AgentFlayer, ForcedLeak, EchoLeak, LayerX), tool poisoning, malicious or vulnerable MCP packages (postmark-mcp, mcp-remote CVE-2025-6514, Claude desktop extensions CVE-class RCE), cross-tenant bugs (Asana) and OAuth token theft from an integration vendor (Salesloft Drift). |

---

## 1. Anthropic (Claude connectors directory, custom remote MCP, desktop extensions, Managed Agents vaults)

### Q1. Connector unit and protocol
**Takeaway:** A connector is an MCP server, either remote or packaged locally as an `.mcpb` desktop extension. One directory serves claude.ai, Desktop, mobile, Claude Code and Cowork. Connectors are labelled Verified (first-party or reviewed third-party), Community (screened) or Custom (user-added).

**Cited findings:**
- The Directory is "a catalog of MCP servers that work across all Claude products: claude.ai, Claude Desktop, Claude Mobile, Claude Code, and Cowork." https://claude.com/docs/connectors/directory.md
- Directory entries include remote connectors and desktop extensions. Web connectors run on Claude, Cowork, Desktop and mobile, and desktop extensions only on Claude Desktop. Some connectors are "Interactive" (MCP Apps UI). https://support.claude.com/en/articles/11724452-use-the-connectors-directory-to-extend-claude-s-capabilities
- A desktop extension is "a local MCP server packaged with MCPB (MCP Bundles) that runs on your device inside Claude Desktop." https://claude.com/docs/connectors/custom/add-unlisted.md
- Labels: Verified means Anthropic tested the tools, but "isn't a security audit." Community means "screens ... but hasn't reviewed them in depth." Custom means "Anthropic hasn't reviewed it." https://claude.com/docs/connectors/verification.md
- Custom connectors "connect to your MCP server from Anthropic's cloud, not from your local device," so the server must be reachable over HTTPS. (secondary summary of help center) https://support.claude.com/en/articles/11176164
- MCP tunnels connect Claude to MCP servers inside a private network "without opening inbound firewall ports." https://claude.com/docs/connectors/mcp-tunnels/overview.md
- In Managed Agents (API), agents declare `mcp_servers` (type `url`), up to 20 per agent, each with a matching `mcp_toolset`. https://platform.claude.com/docs/en/managed-agents/mcp-connector.md

**Inferences:** Directory and custom connectors run on the same infrastructure and technology (https://claude.com/docs/connectors/verification.md), so "first-party vs third-party" in Claude means review level, not technical type.

**Gaps:** No official count of directory connectors was found. The help center page does not state one.

### Q2. Add flow and governance
**Takeaway:** On Free, Pro, Max and Ultra, users add connectors themselves (Free allows one custom connector). On Team and Enterprise, only Owners (plus Enterprise custom roles) add connectors for the org, and members then connect with their own account. Members can request connectors, and Owners can block connectors.

**Cited findings:**
- "On Team and Enterprise plans, an Owner adds the connector for the organization ... On Enterprise plans, a member whose custom role includes managing the organization's libraries can add it too." https://claude.com/docs/connectors/custom/add-unlisted.md
- On the Free plan, you can add one custom connector. Custom connectors are available on Free, Pro, Max, Ultra, Team and Enterprise. https://claude.com/docs/connectors/custom/add-unlisted.md
- "Enabling a connector makes it available to your team, but it doesn't automatically grant anyone access." Requests are on by default for Team and off by default for Enterprise. Owners can approve, decline, or decline and block. Enterprise Owners can block connectors from verified domains outside the org. https://support.claude.com/en/articles/11724452-use-the-connectors-directory-to-extend-claude-s-capabilities
- Team members without permission see a **Request** button, and requests show up in Organization settings > Connectors and Notifications. https://claude.com/docs/connectors/directory.md
- Directory review: submissions are "scan[ned] automatically for policy compliance" and listed as Community by default, then may be escalated to Verified review with "a functional test of each tool." https://claude.com/docs/connectors/verification.md
- Anyone on a paid plan can submit to the directory (an Owner on Team and Enterprise). Submissions go through claude.ai/directory/manage. No DNS or `.well-known` domain proof is required. https://claude.com/docs/connectors/directory.md
- Desktop extensions: "Your organization can turn extensions off or limit which ones you can install." Enterprises can deploy them through software management. https://claude.com/docs/connectors/custom/add-unlisted.md

**Inferences:** Governance is a two-layer model: the org enables a connector, then each user consents. Admin-wide authorization exists only through Enterprise Managed Auth (see Q3).

**Gaps:** I did not find the exact controls for MCP allowlisting in Claude Code enterprise managed settings. That belongs to a separate Claude Code docs set.

### Q3. Auth model and token custody
**Takeaway:** Per-user OAuth is the default. Client registration options are Anthropic's CIMD ("Claude's published identity"), DCR, Anthropic-held partner credentials or the org's own client. Static request headers (shared credentials) are in beta. Enterprise Managed Auth (ID-JAG / RFC 7523 JWT-bearer) skips per-user consent. In Managed Agents, vaults hold credentials as write-only, and environment-variable secrets are swapped in at egress so "the agent never sees the secret value."

**Cited findings:**
- Authentication options are "Sign in now," "Sign in when needed" and "No sign-in." OAuth client options are "Use Claude's published identity" (CIMD), "Register automatically" (DCR) and "Use your own OAuth client." https://claude.com/docs/connectors/custom/add-unlisted.md
- Request headers: "Claude stores each header value securely, doesn't show it again after you save." They suit services "where everyone in your organization shares one credential." There are up to four headers, and "Anthropic reviews and approves each custom header name." The feature is in beta for a limited set of orgs. https://claude.com/docs/connectors/custom/add-unlisted.md
- Auth types: `oauth_dcr`, `oauth_cimd`, `static_headers` (beta) and `oauth_anthropic_creds`. With Anthropic-held credentials, "Anthropic uses the credentials only for token exchange on behalf of consenting users." Tokens must never go in the URL query. https://claude.com/docs/connectors/building/authentication.md
- Enterprise Managed Auth: "lets organizations connect their users to your MCP server without sending each user through an OAuth consent screen." The assertion is a signed JWT, issued either by the customer's IdP or by Claude (beta), and is based on ID-JAG. DCR is not supported with EMA. https://claude.com/docs/connectors/building/enterprise-managed-auth.md
- Linear documents both Okta "MCP enterprise managed authentication" and "Claude-issued authentication for MCP" (beta). https://linear.app/docs/mcp
- Managed Agents vaults are "authentication primitives that let you register credentials for third-party services once and reference them by ID at session creation." Credential types are `mcp_oauth`, `static_bearer` and `environment_variable`. For env vars, the secret is "stored in the sandbox as an opaque placeholder ... substituted with the real secret at egress. The agent never sees the secret value." Secret fields "are treated as sensitive, write-only fields and never returned in API responses." Limits are 20 credentials per vault, and vaults are workspace-scoped: "any API key with workspace access can reference them." OAuth credentials auto-refresh, and webhooks fire on `vault_credential.refresh_failed`. The feature is in beta (`managed-agents-2026-04-01`) and not eligible for ZDR or HIPAA. https://platform.claude.com/docs/en/managed-agents/vaults.md
- MCP credentials are matched to servers by URL at session runtime: "This separation keeps secrets out of reusable agent definitions." https://platform.claude.com/docs/en/managed-agents/mcp-connector.md

**Inferences:** In claude.ai, tokens are held by Anthropic's backend, because connections originate from Anthropic's cloud. The docs say "stores securely" but do not describe the vault technology for consumer connectors. A vault is keyed per end user (via `metadata.external_user_id`), which makes per-user credentials the intended pattern on the API.

**Gaps:** I found no published encryption or KMS detail for claude.ai connector tokens. No CMEK statement covers connector tokens specifically.

### Q4. Per-tool permissions and approvals
**Takeaway:** Each tool or tool group gets Always allow, Needs approval or Blocked. On Team and Enterprise, Owner settings apply org-wide and cannot be overridden. Users see an Allow once / Always allow prompt. In Managed Agents, MCP toolsets default to `always_ask`.

**Cited findings:**
- In-chat prompt: "Select Allow once to continue, or Always allow." Tool permissions are "Always allow, Needs approval, or Blocked for each group of tools or for a single tool." https://claude.com/docs/connectors/getting-started.md
- Org-wide Owner settings: "individual users can't override it." "Restricting actions in Claude never grants more access than the source system permits." On Enterprise, the stricter of the custom role and the tool setting applies. https://support.claude.com/en/articles/11724452-use-the-connectors-directory-to-extend-claude-s-capabilities
- To block GitHub write tools, set them to Blocked, or use the `X-MCP-Readonly: true` header with GitHub's server. https://claude.com/docs/connectors/custom/add-unlisted.md
- Managed Agents: "the agent toolset defaults to `always_allow`, and MCP toolsets default to `always_ask`." Per-tool `enabled` and `permission_policy` are available, and setting `default_config.enabled: false` keeps tools newly added by the server operator off until reviewed. https://platform.claude.com/docs/en/managed-agents/permission-policies.md ; https://platform.claude.com/docs/en/managed-agents/mcp-connector.md

**Gaps:** The consumer UI's grouping of tools into read/write categories is not documented in detail.

### Q5. Counts and pricing
- Custom connectors are on all plans, with Free limited to one: https://claude.com/docs/connectors/custom/add-unlisted.md
- Gap: no official directory count. Managed Agents pricing for vaults was not found (vaults appear to be included).

---

## 2. OpenAI (ChatGPT apps/plugins, Apps SDK, developer mode, Connector Registry, Responses API / Agents SDK hosted MCP)

### Q1. Connector unit and protocol
**Takeaway:** As of Nov 2026, OpenAI's developer docs call the unit a **plugin**: skills plus an optional MCP server plus optional UI, shared across ChatGPT and Codex. It was formerly "connectors", then "apps" with the Apps SDK. In the API, the unit is the `mcp` tool (`server_url` or `tunnel_id`). Legacy first-party `connector_id`s (Gmail, Drive, SharePoint and others) are deprecated for models released after 2026-09-01.

**Cited findings:**
- "Plugins are the packages people discover, install, share, and publish in ChatGPT and Codex. A plugin can contain: Skills ... An MCP server ... Lifecycle hooks." "ChatGPT and Codex share one universal plugin directory." https://developers.openai.com/plugins/concepts/plugins.md
- Plugins docs index (Apps SDK now under "Plugins"): https://developers.openai.com/plugins/llms.txt
- A third-party guide reports that OpenAI renamed "connectors" to "apps" in Dec 2025. (secondary) https://support.fyxer.com/article/admin-setup-guide-how-to-enable-apps-and-mcp-connectors-in-chatgpt
- API: "Use the `mcp` tool type in the Responses API. Set `server_url` for a remote MCP server, or use `tunnel_id` for a local MCP server through Secure MCP Tunnel." "`connector_id` is deprecated for models released after September 1, 2026." The legacy connectors are Dropbox, Gmail, Google Calendar, Google Drive, Microsoft Teams, SharePoint, plus Outlook Calendar and Email tools. https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md
- Agents SDK `HostedMCPTool` accepts `server_url` or `connector_id` with an `authorization` token, and `require_approval` takes "always", "never" or a per-tool map. (secondary mirror of SDK docs) https://doggy8088.github.io/openai-agents-python/mcp ; JS reference https://openai.github.io/openai-agents-js/openai/agents/functions/hostedmcptool/
- AgentKit (Oct 2025) introduced the Connector Registry, "a single admin panel across ChatGPT and the API," which requires the Global Admin Console. An update dated June 3, 2026 says Agent Builder and Evals are winding down and will be unavailable from Nov 30, 2026. https://openai.com/index/introducing-agentkit/ (status note via search summary; secondary for the wind-down detail)

**Inferences:** OpenAI has converged on MCP as the only forward path. The `connector_id` deprecation plus the plugin directory shared with Codex mirror Anthropic's single-directory model.

**Gaps:** I could not confirm whether the Connector Registry survives the AgentKit wind-down. The help center (help.openai.com) returned 403 to fetches, so the admin details below rely on search snippets.

### Q2. Add flow and governance
**Takeaway:** Users add custom MCP servers at chatgpt.com/plugins, subject to workspace policy. On Business, Enterprise and Edu, only admins and owners turn on developer mode and publish custom apps. Enterprise and Edu use RBAC to delegate custom-MCP creation and to scope access to each app. Public directory listings go through review. Featured placement is at OpenAI's discretion.

**Cited findings:**
- Add flow: "Go to ChatGPT Plugins ... Add custom MCP server ... Configure authentication, review the risk warning, and select I understand and want to continue ... Create as a plugin." "Account and workspace policies apply to adding and using custom MCP servers." https://developers.openai.com/plugins/deploy/connect-chatgpt.md
- "Admins/owners can enable developer mode in workspace settings, create and test custom apps, and publish them for their workspace." The toggle is at Workspace Settings > Permissions & Roles > Connected Data. Enterprise and Edu "can further use RBAC to provide developer mode access to select individuals." The help center also says "You are responsible for vetting ... third party apps and connectors you add." (help center via search snippet; secondary) https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt
- Admin controls: "RBAC controls who can use an app. For apps that support Action control, Action control determines what the app can do." Some apps don't support Action control. (search snippet) https://help.openai.com/en/articles/11509118-admin-controls-for-apps-in-chatgpt
- Review: the submission dashboard's "Scan Tools" imports tool metadata, annotations and security schemes, and reviewers check that `readOnlyHint`, `destructiveHint` and `openWorldHint` match behavior. "Plugins appear on the directory's main pages only if OpenAI selects them for enhanced distribution." https://developers.openai.com/plugins/deploy/app-review.md
- Enterprise domain restriction: ChatGPT can use the user's verified email domain to "prevent that corporate identity from linking the plugin in a personal workspace." https://developers.openai.com/plugins/build/auth.md

**Gaps:** I found no exact per-plan availability table for custom MCP (Plus/Pro vs Business), because the help center was blocked. The rules for reaching private servers through Secure MCP Tunnel are not detailed here.

### Q3. Auth and token custody
**Takeaway:** Per-user OAuth 2.1 with PKCE, following the MCP auth spec. Client registration is by CIMD (preferred), DCR or a predefined client. In the API, the developer supplies the bearer token on every call, and OpenAI does not store it.

**Cited findings:**
- "Supported clients use Client ID Metadata Documents (CIMD), dynamic client registration (DCR), predefined OAuth clients, and PKCE." "ChatGPT prioritizes CIMD when it is available." Servers must publish `/.well-known/oauth-protected-resource`, and the redirect is handled by ChatGPT. https://developers.openai.com/plugins/build/auth.md
- "Verify and enforce scopes on every tool call," and "Avoid embedding secrets or tokens in component props." https://developers.openai.com/plugins/guides/security-privacy.md
- API: "To prevent the leakage of sensitive tokens, the Responses API does not store the value you provide in the `authorization` field ... you must send the `authorization` value in every Responses API creation request." For legacy connectors, "OAuth client registration and authorization must be handled separately by your application." https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md

**Inferences:** In ChatGPT, OpenAI holds per-user tokens server-side. The API is stateless by design, so custody stays with the developer, which is the opposite of Anthropic's vault and AWS's Token Vault.

**Gaps:** I found no statement on where ChatGPT stores plugin OAuth tokens or how they are encrypted.

### Q4. Per-tool permissions and approvals
**Takeaway:** ChatGPT asks for confirmation on write or impactful actions, driven by annotations and admin Action control (read, low-risk, or all actions). The API's `require_approval` defaults to asking before data goes to an MCP server.

**Cited findings:**
- "Important actions asks before app actions that could have a meaningful effect outside ChatGPT ... Some especially risky actions may be blocked." The tiers are read, low-risk and all actions. "All actions" "carries elevated risk and is not offered in the standard workspace-wide selector." (search snippets) https://help.openai.com/en/articles/11509118-admin-controls-for-apps-in-chatgpt
- API: "By default, OpenAI will request your approval before any data is shared with a connector or remote MCP server." The flow uses `mcp_approval_request` and `mcp_approval_response` items. https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md
- Workspace agents: "Write-capable actions default to requiring human approval." (secondary PDF) https://cdn.openai.com/business-guides-and-resources/workspace-agents-security-overview.pdf

### Q5. Counts and pricing
- Gap: no current directory count found. Legacy API connector list: https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md

---

## 3. Microsoft (Copilot Studio / Power Platform connectors, custom connectors, MCP, Foundry tools, Entra Agent ID)

### Q1. Connector unit and protocol
**Takeaway:** There are two units. (a) Power Platform connectors: OpenAPI/Swagger wrappers, prebuilt or custom, shared across Copilot Studio, Power Automate, Power Apps and Logic Apps. (b) MCP servers, which Copilot Studio implements *as* a custom connector flagged `x-ms-agentic-protocol: mcp-streamable-1.0`. Foundry agents use an MCP tool plus project connections or "toolboxes" (a managed MCP endpoint).

**Cited findings:**
- "There are two types of connectors: Prebuilt ... Custom." "All connectors are agent ready." Page dated 2026-06-03. https://learn.microsoft.com/en-us/connectors/overview
- MCP in Copilot Studio supports tools and resources and requires generative orchestration. MCP connectors can be published to certification "to allow the connector to be used across tenants." https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp
- Two add paths are the MCP onboarding wizard and a custom connector in Power Apps (an OpenAPI YAML with `x-ms-agentic-protocol: mcp-streamable-1.0`). "Copilot Studio no longer supports SSE for MCP after August 2025." Updated 2026-11-06. https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- Foundry: "Consider adding this tool using a toolbox ... centralizing credential management, versioning, and policy enforcement through a managed MCP endpoint." There is an Add Tools catalog (for example, Azure DevOps MCP), and selecting tools maps to `allowed_tools`. Updated 2026-11-17. https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/model-context-protocol

**Inferences:** For MCP, Microsoft reuses its connector governance (DLP) instead of building a new layer.

### Q2. Add flow and governance
**Takeaway:** Makers add MCP servers per agent. Tenant admins govern through Power Platform data (DLP) policies, which apply to MCP because MCP rides on connectors. Agent 365 (preview) adds an admin-approval path for "bring your own" MCP servers in the M365 admin center.

**Cited findings:**
- "if a data policy regulates Power Platform connectors, it also regulates access to the MCP server and its tools for your agent." https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- Agent 365 (preview): a developer registers the server via the Agent 365 CLI, then "An admin then reviews and approves the request in the Microsoft 365 admin center and grants the required Microsoft Entra permissions ... can take up to 30 minutes to appear." https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- Microsoft's guidance warns against the default environment, because tenant DLP often restricts custom connectors there. https://learn.microsoft.com/graph/mcp-server/use-enterprise-mcp-server-copilot-studio
- Foundry roles: creating a project connection for MCP auth needs the "Foundry Project Manager" role. https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/model-context-protocol
- The Power Platform inventory now shows connector use across apps, flows and agents (June 2026). https://microsoft.com/en-us/power-platform/blog/2026/06/11/whats-new-in-power-platform-june-2026-feature-update

### Q3. Auth and token custody
**Takeaway:** Copilot Studio MCP supports None, API key (header or query) or OAuth 2.0 (dynamic discovery via DCR, dynamic, or manual). Connections hold the credentials. Foundry stores credentials in project connections (custom keys, OAuth2, user Entra token, managed identity, agentic identity) and caches them for about 120s. Entra Agent ID gives each agent its own identity for autonomous or delegated (OBO) access.

**Cited findings:**
- API key: "The user of the agent provides the API key, and the agent includes it in the requests." OAuth 2.0 "lets individual users authenticate with the server ... without sharing their credentials." OAuth types are Dynamic discovery (DCR plus discovery), Dynamic, and Manual (client ID and secret, auth, token and refresh URLs, scopes). https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- Foundry: "use a project connection to store authentication details, such as API keys or bearer tokens, instead of hard-coding credentials." Auth types are `custom-keys`, `oauth2` (Foundry-managed OAuth app for some catalog servers, or bring your own), `user-entra-token`, `project-managed-identity` and `agentic-identity`, plus `AgentOnBehalfOfUser`. "Foundry caches connection details and credentials ... two minutes." On first OAuth use, the server returns `CONSENT_REQUIRED` (-32006) with a consent URL. "The Toolbox handles credential injection, token refresh, and policy enforcement at runtime." https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/model-context-protocol
- Entra Agent ID covers autonomous access ("access rights given directly to the agent identity") and delegated access ("on behalf of human users"). Each Copilot Studio agent gets an agent identity, with its creator recorded as sponsor. "Agent ID is available for all Microsoft Entra customers." Extending Entra security features to agents requires Microsoft Agent 365, which is included in M365 E7 or available as an add-on. Updated 2026-11-05. https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-id

**Inferences:** Foundry Toolbox is the analog of AgentCore Gateway: the agent authenticates to the toolbox with Entra, and downstream secrets stay in the toolbox.

**Gaps:** I did not verify Copilot Studio's maker-credential vs end-user-credential connection settings for MCP specifically.

### Q4. Per-tool permissions and approvals
**Cited findings:**
- Copilot Studio: tools on the MCP server are "automatically available" and "dynamically reflect[ed]" when the server changes. https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp ; the per-tool add page is https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent (not fetched)
- Foundry: `require_approval` (for example `always`) and `allowed_tools`. "Treat tool descriptions, annotations, and results from remote MCP servers as untrusted input." https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/model-context-protocol

**Inferences:** Automatic tool sync means a server operator can add tools without maker review, a rug-pull risk, unless the maker disables tools individually.

**Gaps:** I did not confirm the Copilot Studio per-tool enable/disable and confirmation UI.

### Q5. Counts and pricing
- The connector reference index links about 1,680 connector pages (my count of distinct `/connectors/<name>/` links on the page, 2026-11-18). This is an inference, not an official figure. https://learn.microsoft.com/en-us/connectors/connector-reference/
- A secondary source says "more than 1,400 external connectors." (secondary) https://atlan.com/know/ai-agent/ai-agent-applications/what-are-microsoft-copilot-studio-agents.md
- Agent 365 licensing: https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-id

---

## 4. Google (Gemini Enterprise connectors and data stores, custom MCP, Agent Registry, Agent Engine, ADK)

### Q1. Connector unit and protocol
**Takeaway:** The unit is a **data store**, created by a connector. It supports federation (live query) or ingestion (indexed copy), plus "actions" (write operations). A custom MCP server is a data store of type "Custom MCP Server" over Streamable HTTP. The Agent Registry and Agent Gateway catalog MCP servers and govern them.

**Cited findings:**
- "Connectors get data from Google and third-party data sources into Gemini Enterprise, storing it in dedicated data stores." Federation "directly retrieves information," while ingestion "copies data into the Gemini Enterprise index." "your query string is sent to all enabled third-party search backends." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/introduction-to-connectors-and-data-stores
- Custom MCP supports only StreamableHTTP, not SSE. https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server
- Agent Registry is a "centralized, queryable catalog ... for discovering, tracking, and managing" A2A agents and MCP servers. Agent Gateway "acts as the traffic controller and runtime policy enforcement point." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/import-govern-mcp-server-agent-registry
- ADK `McpToolset` supports `tool_filter` and `auth_scheme` / `auth_credential`. https://adk.dev/integrations/agent-identity ; https://adk.dev/tools-custom/mcp-tools/advanced/

### Q2. Add flow and governance
**Takeaway:** Only admins add connectors. Custom MCP is **blocked by default** by a managed org-policy constraint. Admins must override the constraint, allowlist egress FQDNs, hold `roles/discoveryengine.editor`, and explicitly enable each tool. IAM agent policies and semantic governance policies control agent-to-MCP access.

**Cited findings:**
- Prerequisites: "Override the organization policy constraint that blocks Custom MCP data store creation." Allow FQDNs via `allowedEgressFqdns`, and grant `roles/discoveryengine.editor`, which is "required for your administrator to create the data store." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server
- The constraint name is `constraints/gcp.disableCustomMcpServer`. (secondary: Google codelab) https://codelabs.developers.google.com/google-workspace-ge
- Registry governance: "You define allow and deny rules restricting an MCP server's access to specific entries within Agent Registry." It supports IAM agent policies and semantic governance policies. https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/import-govern-mcp-server-agent-registry
- Admins enable or disable actions per data store, and "Users with data store configuration permissions can view its associated actions." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/manage-actions
- The Business edition reportedly lacks custom MCP. (secondary) https://support.insightech.com/article/z488bdf1co-insightech-mcp-gemini-setup

### Q3. Auth and token custody
**Takeaway:** Custom MCP uses OAuth 2.0 (or no auth) with a manually registered client, and DCR is not documented. Users sign in individually, and scopes define what Gemini can do "on behalf of a user." On Agent Engine, the Agent Identity auth manager acts as vault and broker for 3LO, 2LO and API keys, and the agent authenticates with its own SPIFFE ID.

**Cited findings:**
- OAuth fields are Authorization URL, Token URL, Client ID, Client Secret, Scopes and PKCE, with the redirect `https://vertexaisearch.cloud.google.com/oauth-redirect`. Scopes define "what actions Gemini Enterprise can perform on behalf of a user." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server
- Agent Identity auth manager supports API key or OAuth client credentials, or "OAuth delegation using end-user access tokens." The agent uses an Agent SPIFFE ID, and logs show both agent and user identities. 2LO and API key are in Preview. (search summary of official docs) https://docs.cloud.google.com/agent-builder/agent-engine/agent-identity ; https://docs.cloud.google.com/iam/docs/agent-identity-overview
- The older Agent Engine path stores OAuth client secrets in Secret Manager. (search summary) https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/manage/access
- In ADK, an `adk-request-credential` event is raised when user consent is needed. https://adk.dev/integrations/agent-identity

**Gaps:** No doc says where Gemini Enterprise stores per-user MCP OAuth tokens.

### Q4. Per-tool permissions and approvals
**Takeaway:** Tools are off by default, at most 100 can be enabled, and every action needs user confirmation by default. `readOnlyHint: true` skips confirmation.

**Cited findings:**
- "By default, no tools or actions from your custom MCP servers are enabled." You can enable up to 100 at a time. "By default, all calls to any action require confirmation from the user." Setting `readOnlyHint: True` skips confirmation. The docs also advise to "Enable Model Armor" and "Only enable the actions that users need." https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server

### Q5. Counts and pricing
- The connector docs nav lists about 140 connector "set-up-data-store" pages, including many partner MCP connectors (for example Asana, Atlan MCP, Ramp MCP, Box). This is my count of nav links, an inference. https://docs.cloud.google.com/gemini/enterprise/docs/connectors/introduction-to-connectors-and-data-stores
- Gap: edition pricing was not verified.

---

## 5. AWS (Bedrock AgentCore Gateway and Identity)

### Q1. Connector unit and protocol
**Takeaway:** A Gateway is a single virtual MCP server that aggregates **targets**: Lambda, API Gateway stages, OpenAPI, Smithy, remote MCP servers and built-in integration templates. Separately, HTTP targets cover Runtime agents and A2A. Tools from all MCP targets appear in one `tools/list`, with semantic tool search.

**Cited findings:**
- "MCP targets operate in aggregation mode. The gateway combines the capabilities of all MCP targets into a single unified virtual MCP server ... support capability synchronization, semantic tool search, and three-legged OAuth (3LO)." https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-core-concepts.md
- Built-in templates cover Amazon (Bedrock, CloudWatch, DynamoDB), Asana, BambooHR, Brave, Coinbase x402 Bazaar, Confluence, Jira, Microsoft (Exchange, OneDrive, SharePoint, Teams), PagerDuty, Salesforce, ServiceNow, Slack, Smartsheet, Tavily, Zendesk and Zoom. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-integrations.md

### Q2. Add flow and governance
**Takeaway:** This is a developer and IaC flow: console, CLI, boto3 or the `agentcore` CLI. There is no end-user marketplace. Governance runs through IAM, separate gateways per trust boundary, and the AgentCore policy engine.

**Cited findings:**
- "The gateway execution role is shared across all targets ... Its permissions are the upper bound." "Use separate gateways for different trust boundaries." "Use the policy engine to restrict caller access." https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.md

### Q3. Auth and token custody
**Takeaway:** Inbound auth uses a JWT or IAM. Outbound auth per target can be none, the gateway IAM role, caller IAM (FAS), OAuth (client credentials, authorization code / 3LO, token exchange / OBO), token passthrough or API key. Credentials live in AgentCore Identity credential providers, backed by the **Token Vault** plus Secrets Manager and encrypted with KMS (customer- or service-managed). Per-user tokens are bound to agent identity plus user ID.

**Cited findings:**
- Support matrix: MCP server and OpenAPI targets support OAuth client credentials, authorization code and token exchange plus API key. Lambda supports only the gateway service role. Smithy supports the service role or OAuth client credentials. OAuth setup returns a `credentialProviderArn` and a Secrets Manager `secretArn`, and the gateway role needs `GetResourceOauth2Token` on `token-vault/...`. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.md
- "The token vault provides security for storing OAuth 2.0 tokens, OAuth client credentials, and API keys ... encrypted using either customer-managed or service-managed AWS KMS keys ... every access request is validated independently, even from callers within the same trust domain ... to protect end-user data from malicious or misbehaving agent code." Built-in providers include Google, GitHub, Slack, Salesforce and Atlassian. The SDK decorators `@requires_access_token` and `@requires_api_key` inject credentials. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/key-features-and-benefits.md
- Per-user flow: `GetWorkloadAccessTokenForUserId`, then `GetResourceOauth2Token` returns an authorization URL. The "Token Vault [stores the token] under the agent identity ID and user ID." (search summary of AWS tutorial) https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-getting-started-google.html
- Managed consent portal for 3LO through the gateway: https://aws.amazon.com/blogs/machine-learning/manage-end-user-oauth-consent-for-ai-agents-with-amazon-bedrock-agentcore
- OBO token exchange "carries both the user's identity and the agent's identity ... without triggering additional consent flows." https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.md

**Inferences:** Through the Gateway, the agent never handles downstream secrets, because the gateway injects them. With the SDK decorators, the token is returned into agent *code* (not necessarily into the model context). Custody differs by integration path.

### Q4. Per-tool permissions and approvals
- Per-caller target restriction uses the policy engine (https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.md). Gap: no built-in human approval prompt is documented. HITL is the developer's job.

### Q5. Pricing
- Consumption-based. One third-party figure is $0.005 per 1,000 ListTools/InvokeTool/Ping calls. (secondary, unverified) https://www.getmaxim.ai/articles/bedrock-agentcore-gateway-alternatives/

---

## 6. Salesforce Agentforce (MCP client, hosted MCP servers, AgentExchange, MuleSoft Agent Fabric)

**Takeaway:** Agentforce acts as an MCP client that registers servers in Setup > MCP Servers, with auth via a Named Credential plus External Credential. Salesforce also hosts MCP servers, which are off by default and require an External Client App. Governance is split: admins approve servers and tools in the API Catalog, and builders pick from the approved subset in the Agentforce Registry. MuleSoft Agent Fabric scans and governs agents and MCP servers across clouds.

**Cited findings:**
- Salesforce announced the native MCP client as a pilot for July 2025, with a curated catalog on AgentExchange and an "enterprise-grade MCP Server registry." https://developer.salesforce.com/blogs/2025/06/introducing-mcp-support-across-salesforce ; https://www.salesforce.com/agentforce/mcp-support/
- Hosted MCP servers need an External Client App ("Prerequisites: Set Up Salesforce Hosted MCP Servers"). https://developer.salesforce.com/docs/platform/api-metadata/guide/meta-mcp-server-eca.html
- Named Credential and External Credential setup, with "Connection Status is now Active" on the MCP Servers page. (search summary of SF docs) https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_mcp_cursor_configuration.htm
- "API Catalog is where the Salesforce admin governs and approves MCP servers and their tools, and the Agentforce Registry is where agent builders discover ... the approved subset." Agent Scanners and curated third-party MCP servers in the MuleSoft Agent Registry went GA in Jan 2026. (secondary, MuleSoft blog) https://blogs.mulesoft.com/news/mulesoft-26-mid-year-release-create-ai-experiences/ ; https://docs.mulesoft.com/general/agent-fabric-overview
- About 35 MCP servers were listed on AgentExchange at launch. (secondary, dated) https://www.cio.com/article/4012370/could-agentforce-3s-mcp-integration-push-salesforce-ahead-in-the-crm-ai-race.html
- Agentforce reportedly supports only the client-credentials grant toward MCP servers. (secondary) https://developer-portal-a.wbx2.com/docs/webex-agentic-mcp-servers-salesforce-agentforce

**Inferences:** A client-credentials-only design means shared (agent-level) credentials, not per-user delegation. That is a notable difference from Claude, ChatGPT and Notion if it is still true.

**Gaps:** Current GA status of the MCP client, per-user OAuth support, per-tool approval UI and current counts were not verified on help.salesforce.com.

---

## 7. Meta Muse

**Takeaway:** Muse has "Connectors" (Gmail, Google Calendar and others) that users connect from Settings > Connectors or by asking in chat. The official help page exists but its body did not render for fetch.

**Cited findings:**
- Help page "How Muse works with Connectors": https://www.meta.com/help/artificial-intelligence/1687253048996149/ . Per the search snippet, you connect "by asking Muse (example: 'Connect my Gmail')" or via Settings > Connectors. (snippet; page body unavailable)
- Muse can access Gmail and Google Calendar. (secondary) https://www.axios.com/2026/07/24/meta-muse-spark-agents
- Gmail permissions are reportedly split into search/view vs send, and Calendar into view vs invite. This is unconfirmed by Meta. Disconnecting does not erase memory. (secondary) https://smartscope.blog/en/blog/muse-connect-disconnect-gmail-google-calendar-facebook-instagram-2026/
- A CData guide suggests custom MCP connectors can be added. (secondary) https://www.cdata.com/kb/tech/googlecalendar-cloud-muse.rst

**Gaps:** The protocol (MCP or not), token custody, confirmation behavior and multi-account support are unverified. Sources conflict on multi-account support.

---

## 8. Notion, Slack, Linear

### Notion Custom Agents
**Takeaway:** Notion offers pre-configured MCP connections plus admin-gated custom MCP servers, per agent. Credentials belong to the person who authenticated, read tools can run automatically, and write tools default to "Always ask". Business and Enterprise only, billed in Notion credits.
- "MCP connections are available on Business and Enterprise plans only." Admins enable custom servers at Settings > Connections > Manage, with "Approved & recommended" or "Approved only" modes and approved server URLs. Auth is OAuth (DCR, or a client pre-registered by Notion) or header API keys. "Each MCP connection is unique to a single Custom Agent and uses the credentials of the person who authenticated it." Write tools default to "Always ask." Only the authenticator can change tool settings. https://www.notion.com/help/mcp-connections-for-custom-agents
- Credits are required from May 4, 2026. (secondary) https://eesel.ai/blog/notion-ai-review ; launch post https://www.notion.com/blog/introducing-custom-agents
- **Inference:** Agent-owner credentials mean that anyone who can "view & interact" with an agent acts with the authenticator's access, though they can only approve write actions, not configure them.

### Slack
**Takeaway:** Slack is a connector *provider* more than a consumer. The official Slack MCP server (Feb 2026) accepts only directory-published or internal Slack apps as clients, uses user-token OAuth with admin app approval, and does not support DCR.
- Endpoint `https://mcp.slack.com/mcp`. "Slack does not support SSE connections or Dynamic Client Registration." Clients use confidential OAuth with a fixed app ID. "Only directory-published apps or internal apps may use MCP." "Workspace admins can approve and manage all MCP client integrations." Audit logs are available. https://docs.slack.dev/ai/slack-mcp-server/
- Launch changelog: https://docs.slack.dev/changelog/2026/02/17/slack-mcp

### Linear
**Takeaway:** Linear's MCP server at `mcp.linear.app/mcp` uses OAuth 2.1 with DCR. A `/readonly` endpoint or `read` scope enforces read-only at the token level. It supports Okta EMA and Claude-issued auto-connect. For agents *inside* Linear, `actor=app` OAuth makes the app its own workspace user.
- "clients requesting `read` are granted read-only access, and the underlying token can't reach write APIs." https://linear.app/docs/mcp
- `actor=app`: "Actions taken with the resulting token come from the app itself." Agents appear as app users. https://linear.app/developers/oauth-actor-authorization ; https://linear.app/developers/agents

---

## 9. GitHub Copilot (MCP registry, allowlists, coding agent)

**Takeaway:** Admins point Copilot at an MCP registry URL and choose "Allow all" or "Registry only". Enforcement is name or ID matching in clients (IDE and CLI), can be bypassed by editing config, and does not cover Copilot in the cloud. The registry approach is public preview, and GitHub now recommends a `managed-settings.json` allowlist. The cloud coding agent uses repo-level MCP JSON with a required `tools` allowlist and `COPILOT_MCP_`-prefixed secrets, and it does **not** ask approval.

**Cited findings:**
- "This feature is in public preview and is not the recommended method." The recommended GA method is an allowlist in `managed-settings.json`. Matching is "based on server name or ID only ... can be bypassed by editing configuration files." Enforcing clients: Copilot CLI 1.0.11+, VS Code 1.109.3+, Visual Studio 18.4+, JetBrains, Eclipse, Xcode. "Copilot in the cloud: Not supported." Enterprise policy beats org policy, and "Registry only" beats "Allow all." https://docs.github.com/en/copilot/reference/enterprise-administrators/mcp-allowlist-enforcement
- Where to set it: Enterprise AI Controls > MCP, or Org Policies > Copilot. https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/restrict-based-on-registry
- Coding agent: "We strongly recommend that you allowlist specific read-only tools." Copilot "will not ask for your approval before using them." "Only Agents secrets and variables with names prefixed with `COPILOT_MCP_` will be available." The default GitHub MCP server has "read-only access to the current repository." The agent does "not currently support remote servers that use OAuth." Code review requires `readOnlyHint: true`. https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp
- The GitHub MCP Registry launched Oct 2025 with about 40 curated servers. A Nov 8, 2026 count found 771 servers, versus 58,585 in the official MCP Registry. (secondary) https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/ ; https://jwatte.com/blog/github-mcp-registry-what-microsoft-picked.md

**Inferences:** GitHub's cloud agent is the outlier: secrets come from repo environment secrets (shared, not per-user), there is no approval prompt, and the tool allowlist is the only guardrail.

---

## 10. Known security incidents and advisories involving connectors

**Takeaway:** The incidents fall into five classes. (1) Indirect prompt injection through connected data, which exfiltrates via the agent's own authorized tools. (2) Tool poisoning or rug-pulls in tool metadata. (3) Malicious or vulnerable MCP packages and local extensions, leading to RCE. (4) Server-side authorization bugs that break tenant isolation. (5) Theft of OAuth tokens held by an integration vendor. In most cases no secret was stolen; the agent misused legitimately delegated access.

**Cited findings:**
- **Tool poisoning (Apr 2025):** Invariant Labs showed that instructions hidden in MCP tool descriptions hijack agents. https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- **GitHub MCP "toxic agent flow" (May 2025):** A malicious public issue coerced an agent into leaking private-repo data into a public PR, using the user's own token. Invariant calls it architectural rather than a server bug. https://invariantlabs.ai/blog/mcp-github-vulnerability
- **Asana MCP (June 2025):** A logic flaw broke tenant isolation across MCP users (about 1,000 customers per secondary reports). (secondary) https://www.upguard.com/blog/mcp-security-incidents
- **mcp-remote CVE-2025-6514 (July 2025):** OS command injection via a malicious OAuth server, CVSS 9.6, fixed in 0.1.16. https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/ ; https://osv.dev/vulnerability/CVE-2025-6514
- **Supabase/Cursor (July 2025):** A support ticket injection led a service-role agent to leak tokens. This was a demonstration, the origin of the "lethal trifecta" framing. (secondary) https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-description-poisoning-20260711-cs/
- **AgentFlayer / ChatGPT Connectors (Aug 2025):** A poisoned document triggered ChatGPT to search the victim's Google Drive for API keys and exfiltrate them via a markdown image URL. It bypassed `url_safe` using an Azure Blob domain. https://labs.zenity.io/p/agentflayer-chatgpt-connectors-0click-attack-5b41
- **Salesloft Drift OAuth token theft (Aug 2025):** UNC6395 used stolen Drift OAuth tokens to pull data from Salesforce instances and some Google Workspace mail. Tokens were revoked. Google: treat "any and all authentication tokens stored in or connected to the Drift platform as potentially compromised." https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift
- **postmark-mcp (Sept 2025):** A malicious npm MCP server BCC'd all outgoing email to the attacker. https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft
- **ForcedLeak / Agentforce (Sept 2025):** A Web-to-Lead injection plus an expired allowlisted domain allowed CRM data exfiltration, CVSS 9.4. Salesforce now blocks agent output to untrusted URLs. https://noma.security/blog/forcedleak-agent-risks-exposed-in-salesforce-agentforce/
- **EchoLeak CVE-2025-32711 (June 2025):** A zero-click M365 Copilot data exfiltration, patched server-side. https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-32711
- **Claude Desktop extensions "PromptJacking" (Koi, disclosed Nov 2025):** Command injection in Anthropic's Chrome, iMessage and Apple Notes extensions, CVSS 8.9, fixed in 0.1.9. https://www.koi.ai/blog/promptjacking-the-critical-rce-in-claude-desktop-that-turn-questions-into-exploits
- **LayerX Claude Desktop + Google Calendar (Feb 2026):** A calendar event plus a local MCP extension (Desktop Commander) led to RCE, rated CVSS 10 by LayerX. Anthropic said it "falls outside our current threat model." https://www.theregister.com/2026/02/11/claude_desktop_extensions_prompt_injection/
- **Cursor CVE-2025-54135 / gemini-mcp-tool CVE-2026-0755:** One ledger counts 25 MCP incidents from Apr 2025 to Aug 2026, with command injection the largest class. (secondary) https://www.digitalapplied.com/blog/mcp-security-incident-ledger
- **Vendor guidance acknowledging the risk:** Anthropic ("Be aware of prompt injection risks," report malicious servers via bug bounty) https://claude.com/docs/connectors/custom/add-unlisted.md . OpenAI (report malicious MCP to security@openai.com) https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md . Microsoft ("Treat tool descriptions ... as untrusted input") https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/model-context-protocol . Google ("enable Model Armor") https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server

**Inferences:**
- Token custody in a vault (Anthropic Managed Agents, AgentCore, Foundry Toolbox) addresses theft of secrets from the sandbox. It does not address the dominant incident class, where the agent misuses delegated scope. For that class, read-only endpoints and scopes (Linear `/readonly`, GitHub `X-MCP-Readonly`), default-ask on write tools, egress and URL allowlists, and tools-off-by-default (Gemini, Managed Agents `default_config.enabled:false`) are the relevant controls.
- Platforms that auto-sync tool lists (Copilot Studio) or skip approvals (GitHub cloud agent) carry more rug-pull and injection exposure.

**Gaps:** I did not confirm a primary Asana advisory URL. Several incident counts come from aggregators.

---

## 11. Open gaps (overall)
- Official connector counts for the Claude directory, the ChatGPT plugin directory and AgentExchange.
- OpenAI help-center pages (403 to fetch). The plan availability for custom MCP in ChatGPT and the current state of the Connector Registry need a manual check.
- Salesforce help docs on the Agentforce MCP client (GA status, per-user OAuth, tool approvals).
- Meta Muse official help text (did not render). The protocol and confirmation behavior are unknown.
- Encryption and residency of user OAuth tokens for claude.ai, ChatGPT and Gemini Enterprise. Only AWS documents KMS-backed vault encryption explicitly.
- Pricing: AgentCore Gateway (official page not fetched), Copilot Studio MCP or connector metering, Gemini Enterprise edition differences.
