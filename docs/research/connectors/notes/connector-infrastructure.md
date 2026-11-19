# Connector infrastructure: build vs buy (as of 2026-11-18)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-connectors.md](../fact-check-agent-connectors.md) and applied in [the report](../agent-connectors.md), which supersede this note where they disagree.

Which vendors and open-source projects can supply the connector layer for a multi-user agent platform, and how they fit our constraints. The layer covers the connector catalog, OAuth apps, token vault, per-user connected accounts, tool definitions, MCP exposure and triggers. The constraints are: credentials stay outside sandboxes, users bring their own keys, and the platform deploys into the user's own cloud.

- **Method.** I fetched official pages with curl or WebFetch on 2026-11-18, and read licence and release data from the GitHub API (`gh api repos/<repo>`, `/license`, `/releases/latest`, `/security-advisories`).
- **Labels.** "(secondary)" marks a blog, a third-party article or a search summary. "(search summary)" marks a claim I took from a search-engine digest and did not fetch myself.
- **Untrusted pages.** Some pages carried text addressed to AI agents, such as Composio's "how to sign up" blocks and an llms.txt asking agents to install a skill. I ignored that text as page data.
- **Pricing.** Prices are list prices shown on 2026-11-18.

---

## 0. One-screen summary

| Option | Status Nov 2026 | Catalog | Self-host / licence | Tokens to model? | Price anchor |
|---|---|---|---|---|---|
| Composio | Active. Breached May 2026 | 1,700+ toolkits | SDK is MIT. Platform self-host, VPC and customer KMS are Enterprise only | No. Credentials are redacted and injected server-side | Hobby $0 (100K calls). Pro $29/mo, then $0.0003/call |
| Arcade.dev | Active. Acquired Smithery | 7,500+ tools across 81 MCP servers | `arcade-mcp` is MIT. Full platform via Helm, AWS/Azure Marketplace, air-gapped (Enterprise) | Not stated on the pages read | Free (2K calls). Team $25/mo + $0.01/call |
| Pipedream Connect | Active. Owned by Workday | 3,000+ APIs, 10,000+ tools | Hosted only (AWS us-east-1). Components under a source-available licence | No (with Pipedream's OAuth clients) | Startup $99/mo annual: 100 users, then $2/user, 10K credits, then $0.012 |
| Nango | Active. Many 2026 advisories | 1,300+ APIs, 10,000+ tools | ELv2. Free self-host. Enterprise self-host and BYOC | No | Free (10 connections). $50/mo PAYG: $0.29/connection |
| Merge Agent Handler | Active | "Thousands" of tools | Hosted. On-prem and mVPC on Enterprise | Not stated | Free (2K credits). Pro $1,000/mo (25K credits) |
| Paragon ActionKit | Active | 1,000+ actions | Self-host in your AWS/GCP/Azure | Not stated | Quote only, per Connected User |
| Zapier MCP (+ Embed) | Active | 9,000+ apps, 30,000+ actions | Multi-tenant cloud only. No VPC or on-prem | Not stated | 2 tasks per successful call, from the Zapier plan |
| Klavis | OSS repo archived. Company pivoted to RL | n/a | Apache-2.0, archived | n/a | n/a |
| Smithery | Connection services shut 2026-10-31. Now Arcade | Registry only | CLI is AGPL-3.0, deprecated | n/a | Refunded |
| mcp.run | Rebranded "Turbo MCP", a self-hosted gateway | n/a | Proprietary container | n/a | Demo only |
| Docker MCP Catalog / Gateway | Active | 300+ containerized servers | Gateway is MIT | Gateway injects credentials | Governance tier invite-only |
| Cloudflare Agents + `workers-oauth-provider` | Active (`agents@0.33.0`, provider v1.2.4) | None (you build it) | MIT. Runs on Workers | Your MCP server gets encrypted `props` | Workers pricing |
| Vercel `mcp-handler` + AI SDK MCP | Active (v2.4.0) | None | Apache-2.0. Web-standard handler | n/a (you build it) | Functions pricing |
| Vercel Connect | GA 2026-08-25 | 100+ presets + custom OAuth/API key | Vercel-hosted | Your code receives short-lived tokens | Hobby 500 requests free. Pro $3 per 1K token requests |
| Official MCP Registry | Preview (v1.8.9) | Metadata only | MIT→Apache-2.0. "Not designed for self-hosting" | n/a | Free |
| n8n | Active | Integration nodes | Sustainable Use License (not OSI) | n/a | Embedding needs a commercial agreement |
| Activepieces | Active | 775 apps ("pieces") | MIT core + EE dirs | "No API to retrieve" credentials | Embed from $36k/yr |
| Newcomers | Scalekit AgentKit, Auth0 Token Vault, Descope, Kong Token Vault, Keycard | | | | |

**Bottom line.** Three things matter most for credentials-outside-sandbox, the user's own keys and deployment in the user's cloud:

1. **Build** on Cloudflare `workers-oauth-provider` or the Agents SDK `addMcpServer`, or on Vercel's `mcp-handler` with the AI SDK MCP client. All are MIT or Apache-2.0 and portable. For the catalog, borrow Activepieces pieces (MIT) or license Nango (ELv2, which allows self-hosting inside your own product but not reselling it as a hosted service).
2. **Buy with self-host** from Arcade (Helm or marketplace), Paragon (VPC) or Composio Enterprise (Helm, customer KMS). Each needs an enterprise contract.
3. **Avoid** Klavis (OSS archived), Smithery (connection services shut down), Zapier MCP (no VPC) and Pipedream (hosted only), unless you accept a hosted vault.

---

## 1. What each option provides

### Takeaway
The large catalogs cluster at 1,000 to 9,000 apps. Every buy option offers per-end-user connected accounts keyed by an ID you supply, managed refresh, and MCP exposure. All of them let you bring your own OAuth app. Vendor-managed OAuth apps are meant for prototyping: Composio, Arcade and Pipedream each warn about shared rate limits, vendor branding or production limits. Triggers and webhooks are first-class in Composio, Pipedream, Nango, Paragon and Vercel Connect.

### Cited findings
- **Composio**
  - "1700+ app toolkits". OAuth management covers "Consent, token storage, refresh, and scopes handled for every connected account". Triggers are "Events from connected apps delivered to your webhook". — https://composio.dev/pricing/platform
  - Composio-managed apps are "Shared OAuth apps Composio runs so you can skip app setup. Works in production, not built for production scale. Move to your own app before you scale." Self-managed credentials let you "Pass your own access tokens at execution time. Composio never stores or refreshes them." — https://composio.dev/pricing/platform
  - Authentication is per `userID`: "User A's agent never touches user B's data". The `COMPOSIO_MANAGE_CONNECTIONS` meta tool returns a Connect Link in chat. "You only need a custom auth config to bring your own OAuth app, request specific scopes, or use a toolkit without managed auth." — https://docs.composio.dev/docs/authentication
  - New in 2026: Firewall, which "Blocks instructions hidden in tool results before your agent reads them", and Instant tools that run on Composio's own provider accounts. — https://composio.dev/security, https://composio.dev/pricing
- **Arcade**
  - "7,500+ agent-optimized tools across 81 MCP servers". "Arcade handles OAuth and manages user tokens, API keys, and secrets". "Bring your own MCP server … Register it with Arcade and govern its tools". — https://docs.arcade.dev/home
  - Arcade's default auth providers mean "your users will see the Arcade brand … and your authentications will share any rate limits from those providers with other Arcade customers". The page explains configuring your own provider. — https://docs.arcade.dev/en/references/auth-providers
- **Pipedream Connect**
  - "3,000+ APIs", "10,000+ tools". "Ship new integrations quickly with Pipedream's approved OAuth clients, or use your own." Users are keyed by `external_user_id`. — https://pipedream.com/docs/connect
  - With Pipedream's OAuth client you cannot "Retrieve user credentials". With a custom client you can, and it also lets you invoke workflows. Both modes allow embedded tools and the proxy. "The client secret is write-only." — https://pipedream.com/docs/connect/managed-auth/oauth-clients
- **Nango**
  - "Auth for 1,300+ APIs", "10,000+ tools", triggers, syncs and webhooks. "Use pre-approved OAuth apps or bring your own for a fully white-label experience." — https://www.nango.dev/pricing
  - "Every connection belongs to one of your users or orgs, and every tool call runs with that user's credentials." Agent Sessions expose one MCP server with tool search. — https://nango.dev/platform/mcp
- **Merge Agent Handler**
  - "Connect your AI agents to thousands of enterprise tools". Tool Packs are "scoped by agent type, customer tier, or environment". — https://www.merge.dev/agent-handler
  - (search summary) A Registered User holds the credentials. Each connector in a pack has a credential scope of Individual, Shared (Group) or Organization (`auth_scope: "ORGANIZATION"`). The MCP URL is `https://ah-api.merge.dev/api/v1/tool-packs/<id>/registered-users/<id>/mcp`, and user-scoped keys can be minted from the production key. — https://docs.merge.dev/merge-agent-handler/build/tools/tool-packs, https://docs.merge.dev/merge-agent-handler/build/connecting-agents/mcp-integration
- **Paragon ActionKit.** "One API/MCP to equip your AI agent product with 1000+ integration actions". Actions are fetched at query time as tool schemas. The pricing page lists Workflows triggered from "3rd-party webhooks". — https://www.useparagon.com/actionkit, https://www.useparagon.com/pricing
- **Zapier**
  - "9,000+ apps and 66,000+ triggers and actions". For developers: "30,000+ actions across 9,000+ apps via the MCP standard". — https://zapier.com/mcp
  - Zapier MCP Embed gives each end user "their unique Zapier MCP server URL" through an `mcp-server-url` event. "Zapier handles OAuth, credentials, and security." — https://docs.zapier.com/mcp/embed/getting-started
- **Docker.** The catalog has "300+ verified servers packaged as container images". Profiles can mix containerized and remote servers. — https://docs.docker.com/ai/mcp-catalog-and-toolkit/
- **Cloudflare**
  - `addMcpServer(serverName, url, options?)` returns either `{state:"authenticating", authUrl}` or `{state:"ready"}`. The default OAuth client performs Dynamic Client Registration (RFC 7591). You can override `createMcpOAuthProvider(callbackUrl)` to use pre-registered clients. "OAuth tokens are securely stored in SQLite, and persist across agent restarts." — https://developers.cloudflare.com/agents/model-context-protocol/mcp-client-api/
  - `workers-oauth-provider` provides `OAuthAuthorizationServer`/`OAuthResourceServer` and `beginUpstream()`/`finishUpstream()` for upstream identity providers. "Store the provider's access token in `props`". — https://developers.cloudflare.com/agents/model-context-protocol/authorization/
- **Vercel**
  - `mcp-handler` "includes helpers for verifying bearer tokens and publishing OAuth protected resource metadata … The package does not issue tokens or run an authorization server." — https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
  - The AI SDK `@ai-sdk/mcp` `createMCPClient` supports HTTP and SSE with `authProvider`, plus elicitation. — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
  - **Vercel Connect** brokers tokens for Slack, GitHub, Microsoft, Linear, Snowflake and Salesforce. Custom OAuth lets you "Bring your own client ID and client secret", and token subjects can be `app`, `user` or `jwt-bearer`. It has triggers and MCP events. — https://vercel.com/docs/connect
  - GA on 2026-08-25 with "100+ preset connectors". — https://vercel.com/changelog/vercel-connect-ga
- **Official MCP Registry.** "official centralized metadata repository for publicly accessible MCP servers". It hosts metadata (`server.json`), not code. It "**does not** support private servers", and host apps should consume downstream aggregators instead. — https://modelcontextprotocol.io/registry/about
- **Activepieces.** It has 775 apps and "One MCP server for all of Activepieces … Free on every plan, cloud or self-hosted". — https://www.activepieces.com/mcp
- **n8n.** Pricing lists "MCP Server Trigger", "MCP Client" and "Human approval for tool calls". — https://n8n.io/pricing/

### Inferences
- Catalog counts are not comparable. Arcade counts tools, Composio counts toolkits, Pipedream and Nango count APIs, and Zapier counts apps. The real question is per-app coverage of the 20 to 50 apps our users need.
- Every vendor's "managed OAuth app" route ties users' consent screens to the vendor's brand and shared rate limits. For a product with users' own keys, plan on registering our own OAuth apps per provider whatever we buy. That registration work, including Google and Microsoft verification, is the same in build and buy.

### Gaps
- No per-app coverage comparison was made.
- Paragon ActionKit's exact current catalog count and BYO-OAuth details are not covered on the pages fetched.
- Docker's pages don't describe OAuth handling for catalog servers.

---

## 2. Where it runs, licence, portability, lock-in

### Takeaway
Only the build-kit pieces have permissive licences and run anywhere: Cloudflare `agents` and `workers-oauth-provider` (MIT), Vercel `mcp-handler` (Apache-2.0), Docker `mcp-gateway` (MIT) and the Activepieces core (MIT). Nango is source-available under ELv2: you can self-host it inside your own product, but you can't resell it "as a hosted or managed service". n8n and Pipedream licences forbid the embedding use case without a commercial deal. Arcade, Composio, Paragon and Merge offer customer-cloud deployment only on Enterprise contracts. Zapier and Pipedream are hosted only.

### Cited findings
- **Composio**
  - The SDK repo is MIT (31.2k stars; latest `@composio/cli@0.6.2`, 2026-11-16). — https://github.com/ComposioHQ/composio
  - "Private VPC deployment … Enterprise arrangement". "Self-hosted deployment … Enterprise arrangement, with Helm deployment support". "Customer-managed key deployment: A proxy in your cloud handles credential plaintext under keys in your KMS", supporting "AWS KMS, Google Cloud KMS, and HashiCorp Vault Transit". — https://docs.composio.dev/docs/security/token-custody.md
  - Enterprise lists "Bring your own cloud (BYOC)". — https://composio.dev/pricing
- **Arcade**
  - "The Arcade Helm chart deploys the full Arcade platform onto a Kubernetes cluster you manage". It needs K8s 1.30+, PostgreSQL 16–18, Redis and an OIDC identity provider. Azure and AWS Marketplace deployments are "Arcade-operated deployments in your own cloud account". GCP is "coming soon". — https://docs.arcade.dev/en/operate/deploy/helm
  - Enterprise offers "Arcade Cloud, in your VPC, or fully air-gapped". — https://www.arcade.dev/pricing
  - `arcade-mcp` is MIT. — https://github.com/ArcadeAI/arcade-mcp
  - The engine's licence is not published on the pages read.
- **Pipedream**
  - "Pipedream is hosted on the Amazon Web Services (AWS) platform in the us-east-1 region." — https://pipedream.com/docs/privacy-and-security
  - The components repo uses the "Pipedream Source Available License Version 1.0". Its "Excluded Purpose" is "any commercial use … that competes with the Software or any other Pipedream products". — https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE
  - (search summary) Workday announced a definitive agreement to acquire Pipedream on 2025-11-19. A Workday 10-K summary (secondary) lists Pipedream among its fiscal-2026 acquisitions. — https://newsroom.workday.com/2025-11-19-Workday-Signs-Definitive-Agreement-to-Acquire-Pipedream, https://www.autobound.ai/companies/workday/10-k/workday-completed-four-strategic-ai-acquisitions-in-fiscal-b2291486
- **Nango**
  - Its LICENSE is the "Elastic License 2.0 (ELv2)": "You may not provide the software to third parties as a hosted or managed service … You may not move, change, disable, or circumvent the license key functionality". Latest release v0.72.6 (2026-11-16). — https://github.com/NangoHQ/nango/blob/master/LICENSE
  - Enterprise includes "Self-hosting & BYOC". — https://www.nango.dev/pricing
- **Merge.** Enterprise includes "Custom deployments, including on-prem". The comparison table lists "Custom deployment (On-prem, mVPC, etc.)". — https://www.merge.dev/pricing/agent-handler
- **Paragon.** "Self-hosted in your VPC: Deploy Paragon to your own AWS, GCP, or Azure account, managed by Paragon or fully by your team". Paragon can also be forward-deployed into your customers' environments. — https://www.useparagon.com/security
- **Zapier.** "Zapier MCP runs on multi-tenant cloud infrastructure, and dedicated VPC or on-premises deployments are not currently available." — https://docs.zapier.com/mcp/manage/security
- **Klavis.** The repo is Apache-2.0 and **archived**. "This repository is deprecated … Klavis AI now focuses on RL environments and high-quality training data for frontier AI labs." The hosted MCP service continues for existing customers. — https://github.com/Klavis-AI/klavis, https://www.klavis.ai/
- **Smithery**
  - "On October 31, 2026, we're shutting down Smithery's connection management services. Smithery will remain as a public (non-proxied) MCP registry". "Smithery API, Connect, and Toolbox", accounts, API keys, CLI and SDKs stop working. Smithery is "now part of Arcade". — https://smithery.ai/pricing, https://smithery.ai/
  - The CLI is AGPL-3.0. — https://github.com/smithery-ai/cli
- **mcp.run.** www.mcp.run now presents "Turbo MCP", a "self-hosted MCP gateway and management platform" shipped as "a single-container deployment via secure registry", with "Stay tuned for Turbo MCP's next chapter". docs.mcp.run did not resolve on 2026-11-18. — https://www.mcp.run/
- **Docker**
  - "MCP Gateway is Docker's open source solution". "For Docker Engine without Docker Desktop, you'll need to download and install the MCP Gateway separately". "MCP Gateway as part of Docker AI Governance is an invite-only feature." — https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/
  - The repo is MIT. — https://github.com/docker/mcp-gateway
- **Cloudflare**
  - `cloudflare/agents` is MIT (`agents@0.33.0`, 2026-11-03). — https://github.com/cloudflare/agents
  - `workers-oauth-provider` is MIT (v1.2.4, 2026-10-22) and requires KV bound as `OAUTH_KV`. — https://github.com/cloudflare/workers-oauth-provider
- **Vercel**
  - `mcp-handler` is `"license": "Apache-2.0"` (v2.4.0, 2026-11-12). — https://github.com/vercel/mcp-handler/blob/main/package.json
  - "`createMcpHandler` returns a Web-standard handler … so it doesn't depend on Next.js or Vercel." — https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
  - Vercel Connect works outside Vercel only by passing a Vercel access token, so the broker itself is always Vercel-hosted. — https://vercel.com/docs/connect
- **MCP Registry.** Licensing is in transition from MIT to Apache-2.0, with docs under CC-BY-4.0. "the official MCP Registry codebase is **not** designed for self-hosting". It defines an OpenAPI spec that private registries can implement. — https://github.com/modelcontextprotocol/registry, https://modelcontextprotocol.io/registry/about
- **n8n**
  - The Sustainable Use License allows use "only for your own internal business purposes or for non-commercial or personal use". It is fine "Provided you are using n8n for internal business purposes, and not making n8n available to your customers for them to connect their accounts". Otherwise "You must sign a separate commercial agreement". — https://docs.n8n.io/sustainable-use-license/
  - Files marked `.ee.` need an Enterprise License. — https://github.com/n8n-io/n8n/blob/master/LICENSE.md
- **Activepieces.** The core is "MIT Expat". Content under `packages/ee/` and `packages/server/api/src/app/ee` is under a separate licence. — https://github.com/activepieces/activepieces/blob/main/LICENSE

### Inferences
- **Workers fit.** Only the Cloudflare kit is native to Workers. `mcp-handler` and the AI SDK MCP client are Web-standard, so they should run on Workers, but neither is documented for it. Nango, Arcade, Composio and Paragon self-hosts are Kubernetes or VM stacks with Postgres and Redis. They run on AWS, not on Workers.
- **Hosted lock-in.** Connected accounts in a hosted vault are not portable. Refresh tokens are bound to the OAuth client that issued them. If we register our own OAuth apps from day one and choose a vendor that allows token export, migration stays possible:
  - Pipedream allows export with a custom client.
  - Composio does not: "No token export".
  - Nango and Arcade self-hosts keep the tokens in our own database.
- **Activepieces pieces as a catalog.** MIT pieces are the only large, permissively licensed action catalog. n8n nodes are not usable for a customer-facing product without a deal.

### Gaps
- Licence of the Arcade Engine and Coordinator images.
- Whether Nango free self-hosting includes the MCP and tool features. The free-self-hosting doc URL returned 404 after its redirect.
- Paragon self-host licence terms.
- Whether Workday changed Pipedream's terms or roadmap after the acquisition. The pricing page still says "© 2026 Pipedream, Inc."

---

## 3. Security model

### Takeaway
Every buy vendor claims the model never sees tokens and injects credentials server-side. Composio, Pipedream, Nango, Scalekit and Activepieces say so explicitly. Some expose raw tokens to your backend: Pipedream with a custom client, Vercel Connect's `getToken`, Cloudflare `props` inside your MCP server, and Arcade's "authorize existing tools" pattern. That is not the model, but it is code that might run near a sandbox. SOC 2 Type II is near-universal. The 2025–26 incident record is significant and argues for least privilege and short-lived, scoped credentials whatever we choose:

- the Composio breach (May 2026);
- the Smithery build-host token leak (June 2025);
- a stream of Nango SSRF and webhook-forgery advisories (Aug–Nov 2026);
- an `mcp-handler` cross-session response leak (Mar 2026);
- `workers-oauth-provider` PKCE and redirect bugs (May 2025);
- critical and high Activepieces advisories, including cross-tenant ones (Jul–Aug 2026).

### Cited findings
- **Composio: custody**
  - "Your application and the model receive tool results, not tokens. No token export. Connected-account API responses redact credentials by default". "Proxy Execute … requires its own API key permission". "Scoped API keys separate session management from tool execution". — https://docs.composio.dev/docs/authentication
  - "Composio associates connections with the supplied ID. That ID is not proof of identity." The customer must enforce tenant membership. — https://docs.composio.dev/docs/security/token-custody.md
- **Composio: compliance.** (search summary) "Composio is SOC 2 Type II compliant", with reports at trust.composio.dev. The enterprise page also claims ISO 27001:2022. — https://docs.composio.dev/docs/security/overview, https://composio.dev/enterprise
- **Composio: May 2026 incident.** The official bulletin's update log runs 2026-05-21 to 05-27, with the latest page version dated 2026-11-10.
  - The attacker used "LLM generated attack patterns" to get into an internal monitoring tool, then reached the remediation systems. They registered malicious tool definitions in the sandboxed tool-execution environment and escalated from there.
  - Exposed: "5,241 API keys" held in an auxiliary cache. Leaked connections were about 0.3% of active connections: GitHub 5,001, Gmail 12, and 1–5 each for other connectors.
  - Fixes: envelope encryption, keys stored as hashes, OIDC replacing static secrets, IP allowlisting and optional customer KMS.
  - "Deleting a connection does not guarantee the provider invalidated the token."
  - — https://composio.dev/blog/composio-may-2026-security-incident
- **Composio: SDK CVEs.** (secondary) CVE-2026-59807 is a file-path issue in SDK versions before 0.2.32-beta.283. — https://app.opencve.io/cve/CVE-2026-59807
- **Arcade**
  - Enterprise includes "SSO, RBAC, audit logs". — https://www.arcade.dev/pricing
  - Audit logs record administrative actions and are available through an API. "OpenTelemetry audit logs". Worker trust boundaries withhold static secrets from API-registered servers by default. — https://docs.arcade.dev/llms.txt
  - Production auth flows should use a custom user verifier "to prevent phishing attacks". — https://docs.arcade.dev/llms.txt (entry "Secure and Brand the Auth Flow in Production")
  - (secondary) Arcade announced SOC 2 Type 2 on 2025-08-18. — https://blog.arcade.dev/soc-2-compliance-ai-agents-production-security
- **Pipedream**
  - "Credentials are encrypted at rest, scoped per project, and never exposed to your app". SOC 2 Type 2 and GDPR on all plans, HIPAA on Business. — https://pipedream.com/pricing
  - "Pipedream does not store API request payloads or response bodies when you use Connect." The SOC 2 Type 2 report is available on request, and BAAs are available. — https://pipedream.com/docs/connect, https://pipedream.com/docs/privacy-and-security
  - "Credentials are never exposed to AI models or your client-side code". — https://pipedream.com/docs/connect/mcp
- **Nango**
  - "Credentials never reach the model". It has RBAC, per-user scopes and an audit trail. — https://nango.dev/platform/mcp
  - SOC 2 Type II, HIPAA BAA on Enterprise, and an audit trail. — https://www.nango.dev/pricing
  - GitHub advisories for 2026 include:
    - GHSA-2j37-g5f6-h55p, high: "Nango proxy SSRF via base-url-override header (empty default denylist)", Aug 2026;
    - GHSA-gqqr-9p2x-78h6, high: Slack, GitHub App and Gmail "webhook handlers accept forged provider events", Sep 2026;
    - GHSA-h3g7-xch2-49c7, high: "Unverified webhooks from six providers are forwarded … with a valid Nango signature", 2026-11-13;
    - GHSA-cw2h-845h-g3x6, medium: MCP-generic OAuth SSRF, 2026-11-11.

    — https://github.com/NangoHQ/nango/security/advisories
- **Merge.** "DLP (data loss prevention) scanning on tool-call inputs and outputs, and policy-based guardrails that block, redact, or mask sensitive data". It has a "searchable audit trail". — https://www.merge.dev/agent-handler. Enterprise can "Stream tool call and API request logs to SIEM". — https://www.merge.dev/pricing/agent-handler
- **Paragon.** "SOC 2 Type II, HIPAA, and GDPR compliant". ISO 27001 is "Coming soon". — https://www.useparagon.com/security
- **Zapier**
  - "operates under Zapier's SOC 2 Type II certification". The History tab "displays user-level activity logs for tool calls". MCP events go to the account audit log. "Users cannot bring tools in from third-party sources." — https://docs.zapier.com/mcp/manage/security
  - The page doesn't say whether credentials reach the model.
- **Smithery: June 2025 incident.** (secondary) GitGuardian reported a path-traversal flaw in Smithery's build process that exposed a Fly.io token covering about 3,243 apps. It was reported on 2025-06-13 and fixed by 06-15. Coverage claims thousands of client API keys were exposed. — https://blog.gitguardian.com/breaking-mcp-server-hosting/ (not opened; via https://scworld.com/news/smithery-ai-fixes-path-traversal-flaw-that-exposed-3000-mcp-servers)
- **Docker.** "MCP Gateway runs MCP servers in isolated Docker containers with restricted privileges", and "The Gateway then injects any required credentials". — https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/
- **Cloudflare**
  - "Tokens, codes and secrets are stored only as hashes; `props` are encrypted with a key only the token holder can unwrap". Caveat: "the library advertises the required scopes but doesn't enforce them". Ownership and tenancy are left to the handler. — https://github.com/cloudflare/workers-oauth-provider
  - Advisories GHSA-qgp8-v765-qxx9 ("PKCE bypass via downgrade attack") and GHSA-4pc9-x2fx-p7vj ("Missing validation of redirect_uri"), both medium, 2025-05-01. — https://github.com/cloudflare/workers-oauth-provider/security/advisories
  - The `agents` repo has two medium 2026 advisories, neither in MCP OAuth. — https://github.com/cloudflare/agents/security/advisories
- **Vercel**
  - `mcp-handler` advisory GHSA-w2fm-25vw-vh7f, high, 2026-03-31: "Tool response leak across concurrent client sessions ('Race Condition')". — https://github.com/vercel/mcp-handler/security/advisories
  - Vercel Connect issues "Short-lived, scoped token[s]" to your code. Each connector has an Observability tab logging token requests, authorizations, triggers and revocations. — https://vercel.com/docs/connect
- **Activepieces**
  - "credentials are stored under 256-bit encryption, with no API to retrieve them". — https://www.activepieces.com/mcp
  - Advisories include GHSA-m992-8rcw-vmrx, critical: "Queue dashboard (Bull-Board) exposed without authentication", Aug 2026. GHSA-5h2x-g6m3-grmq, high: "Cross-tenant data exposure and code injection via the Code piece sandbox cache", Jul 2026. — https://github.com/activepieces/activepieces/security/advisories
- **n8n.** Nov 2026 advisories include GHSA-c772-hjfp-gfc2: "Integration Nodes Send Authenticated Requests to Unintended API Endpoints". — https://github.com/n8n-io/n8n/security/advisories

### Inferences
- **Hosted vaults are a target.** "Model never sees the token" is table stakes. The bigger risk is the vendor becoming a high-value aggregate target. Composio's breach came through internal agent tooling and tool-execution sandboxes, the same pattern our platform will have. Self-hosting removes the cross-customer aggregate but makes us the operator.
- **Pick the minting pattern deliberately.** Two patterns exist:
  - (a) A broker injects the token and returns only results: Composio, Nango, Pipedream with its own clients, Merge, Docker Gateway.
  - (b) A broker mints short-lived tokens that our host-side code uses: Vercel Connect, Auth0 Token Vault, Cloudflare `props`.

  Both keep credentials out of sandboxes if the call happens host-side, through our credential proxy. Pattern (b) fits a design where a host-side proxy injects headers.
- **Tenancy is ours in every option.** Every vendor keys connections on an ID we supply and treats it as unauthenticated (Composio says so explicitly). Tenant isolation is our job in all cases.

### Gaps
- Whether Arcade tools receive raw tokens in worker context. "tokens are securely injected into the tool's context" for custom tools, per https://docs.arcade.dev/llms.txt, so the token reaches tool code.
- Paragon's and Merge's statements on model token exposure.
- Pen-test reports are all gated behind trust centres.
- No independent confirmation of the Composio breach counts beyond its own bulletin.

---

## 4. Approvals, human-in-the-loop and idempotency for writes

### Takeaway
The connector vendors mostly offer policy gates (allow, deny, modify) rather than human approval. Arcade has Contextual Access pre-execution hooks, Merge has rules and DLP, Composio has Firewall, and Zapier has action restrictions. Human approval is a framework feature:

- AI SDK `toolApproval`;
- Cloudflare Agents `waitForApproval` and Code Mode `requiresApproval`, which survive Durable Object hibernation;
- MCP elicitation in both the Cloudflare and AI SDK clients;
- n8n "Human approval for tool calls".

No vendor page read documents idempotency keys for write actions.

### Cited findings
- **Arcade Contextual Access.** The Pre-Execution Hook runs "Before each tool execution" and can "Allow, deny, or modify inputs". The Post-Execution Hook can modify results. The page has no mention of human approval. — https://docs.arcade.dev/en/operate/governance/contextual-access
- **Arcade template.** (secondary) A "Human approval workflow" gateway template exists, built around the agent rather than as an engine gate. — https://www.arcade.dev/agents/gateway-templates/human-approval-workflow/
- **Composio Firewall.** It "checks each tool call against yo[ur policies]". It is billed as "Plain-English Firewall policies $0.50 / 1M tokens" and is not on Hobby. — https://composio.dev/pricing, https://composio.dev/pricing/platform
- **Merge.** "policy-based guardrails that block, redact, or mask". "Default rules" on all plans, "Custom rules" on paid plans. — https://www.merge.dev/agent-handler, https://www.merge.dev/pricing/agent-handler
- **Zapier.** Account-level "action restrictions" apply in MCP, and no approval step is documented. — https://docs.zapier.com/mcp/manage/security
- **Cloudflare**
  - `AgentWorkflow.waitForApproval(step, {timeout})`, `approveWorkflow()` and `rejectWorkflow()` are a "durable gate backed by Cloudflare Workflows".
  - Code Mode `requiresApproval: true`: "Pending approvals and execution history survive request completion and Durable Object hibernation".
  - MCP elicitation through `this.mcp.configureElicitationHandlers({ form, url })`.
  - — https://developers.cloudflare.com/agents/guides/human-in-the-loop/
  - "Do not use form mode to request passwords, API keys, access tokens …". — https://developers.cloudflare.com/agents/model-context-protocol/mcp-client-api/
- **AI SDK**
  - `toolApproval` returns `'not-applicable' | 'approved' | 'denied' | 'user-approval'`, with `tool-approval-request` and `tool-approval-response` parts. `experimental_toolApprovalSecret` HMAC-signs requests. — https://ai-sdk.dev/docs/agents/tool-approvals
  - MCP tool annotations are hints: "The MCP client does not turn them into an approval policy automatically". — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- **Vercel Connect.** A Shopify guide shows how to "request approval before changing your catalog", which is app-level. — https://vercel.com/docs/connect
- **n8n.** "Human approval for tool calls" is included on all plans. — https://n8n.io/pricing/
- **Retries.** The AI SDK MCP client has opt-in `maxRetries` for `tools/call`, disabled by default. — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools

### Inferences
- **Approval stays in our harness.** The vendor can serve as a second deny layer through policy hooks.
- **Idempotency is ours too.** No vendor promised exactly-once writes. Retries are where duplicates come from, so keep MCP-client retries off for non-idempotent tools.

### Gaps
- Idempotency-key support in Composio, Nango actions, Pipedream actions, Paragon ActionKit and Merge was not found on the pages read.
- Arcade "How Hooks Work" failure modes (fail open or fail closed) were not fetched.

---

## 5. Pricing (list, 2026-11-18)

### Takeaway
Pricing comes in three models:

- **Per call:** Composio, Arcade, Merge credits, Zapier tasks, Vercel Connect token requests.
- **Per end user or connection:** Pipedream ($2 per external user), Nango ($0.29 per connection), Paragon (Connected Users, quote only), Merge Unified ($65 per linked account; not Agent Handler).
- **Per seat:** Composio "for you", n8n, Activepieces.

At 10,000 end users with a few connections each, per-connection pricing dominates. Nango is about $0.29 × connections at list, with volume pricing down to $0.01, and Pipedream is $2 × users. At high call volume, Composio's $0.0003 per call is far below Arcade's $0.01.

### Cited findings
- **Composio Platform**
  - Hobby is $0, with 100,000 tool calls a month (up to 20,000 on Composio-managed apps), 50,000 triggers and unlimited connected accounts (first 1,000 free on managed apps).
  - Pro is $29/mo with $29 in credits. Extra tool calls cost $0.0003, trigger events $0.003, and managed-app connected accounts $0.10 each, one time, after the first 1,000.
  - Enterprise is custom, with SSO/SCIM and customer-managed keys.
  - — https://composio.dev/pricing/platform
  - The consumer "for you" plan is $18 per seat per month. — https://composio.dev/pricing
- **Arcade.** Free: 2,000 tool calls a month. Team: $25/mo plus $0.01 per tool call. Enterprise: custom, with VPC or air-gapped deployment. — https://www.arcade.dev/pricing
- **Pipedream Connect**
  - Free covers development only.
  - Startup is $99/mo billed annually ($150 monthly), with 100 external users then $2 per user and 10,000 credits then $0.012. One credit is 30 seconds of compute per action, MCP call, proxy request or trigger event.
  - Business is custom, with SSO, SCIM, HIPAA and static IPs.
  - — https://pipedream.com/pricing
- **Nango**
  - Free: 10 connections, 10 compute hours and 10 GB.
  - Pay-as-you-go: $50/mo, then $0.29 per connection, $0.72 per compute hour and $0.5 per GB. The Growth add-on is $450/mo.
  - Enterprise connections can be "as low as $0.01/connection/month at scale".
  - — https://www.nango.dev/pricing
- **Merge Agent Handler.** Free: 2,000 credits a month. Pro: $1,000/mo with 25,000 credits, tiers up to 100,000, and overages billed monthly. Enterprise: custom. — https://www.merge.dev/pricing/agent-handler
- **Paragon.** No public numbers: "Usage costs scale based on the number of tenants (customer orgs)", and you "Get Custom Quote". — https://www.useparagon.com/pricing
- **Zapier MCP.** "Each tool call uses two tasks from your existing task quota". "Next Gen Zaps" are free until billing starts on Dec. 1, 2026. — https://zapier.com/mcp. "failed calls do not count". — https://docs.zapier.com/mcp/get-started/quickstart
- **Vercel Connect.** Hobby includes 500 token requests and 1,000 triggers a month. Pro is $3 per 1,000 token requests and $0.95 per 1,000 triggers. — https://vercel.com/changelog/vercel-connect-ga, https://vercel.com/docs/connect
- **Activepieces.** Free: 1,000 credits. Plus: $20/mo. Team: $200/mo. "Embed: From $36k a year". — https://www.activepieces.com/pricing
- **n8n.** Business is 667€/mo billed annually. Self-hosted Business and Enterprise license keys "must ping our license server daily". — https://n8n.io/pricing/
- **Auth0 Token Vault.** (search summary) Bundled in Auth0 for AI Agents. Connected-app counts are tiered by plan. — https://auth0.com/pricing

### Inferences
- **Worked example.** Take 5,000 users × 3 connections and 300,000 calls a month:
  - Nango: about $4.3k/mo for connections, plus compute.
  - Pipedream: about $10k/mo for users, plus credits.
  - Composio Pro: about $90/mo for calls with own OAuth apps.
  - Arcade Team: about $3k/mo for calls.
  - Merge Pro: $1k/mo if 300,000 calls fit the credit tiers; credits per call were not published.

  Composio's price is low enough that it reads as a loss leader.
- **Self-host tiers are quote-only.** Every self-host or BYOC tier is quote-only, so the user's-own-cloud requirement moves all buy options to enterprise pricing.

### Gaps
- Merge credit cost per tool call.
- Paragon price points.
- Arcade per-user charges, if any.
- Docker AI Governance pricing.
- Official Auth0 Token Vault limits.

---

## 6. Fit for our constraints

The constraints are: credentials outside sandboxes, the user's own keys, and deployment into the user's own cloud.

### Takeaway
No hosted-only option meets "deploy into the user's own cloud". That rules out Pipedream, Zapier, Merge below Enterprise, Vercel Connect and Composio below Enterprise. The realistic choices:

- **(A) Build.** Use the Cloudflare `agents` `addMcpServer` OAuth client, which handles DCR, PKCE and refresh and stores tokens in Durable Object SQLite, as our MCP client and vault for remote MCP servers. Use `workers-oauth-provider` when we expose our own MCP endpoints. For non-MCP APIs, either license Nango self-hosted (ELv2 permits embedding in our product, as long as we don't offer Nango itself as a service) or port Activepieces pieces (MIT). All of these keep tokens host-side, and the sandbox only sees our credential proxy.
- **(B) Buy, self-hosted.** Arcade via Helm or AWS/Azure Marketplace has the strongest documented self-host story plus Contextual Access hooks, and it absorbed Smithery's users. Paragon has a VPC option. Composio Enterprise offers Helm and customer KMS, but it carries breach history and a "No token export" lock-in.
- **(C) Hybrid.** A hosted broker during beta (Nango Cloud or Composio with our own OAuth apps), switching to self-hosted Nango later. Nango is the one vendor whose cloud and self-host share an open codebase, which keeps migration plausible.

### Cited findings
These are the facts that decide fit; section numbers point to the full citations.

- "Zapier MCP runs on multi-tenant cloud infrastructure … VPC or on-premises deployments are not currently available" (§2).
- Pipedream is "hosted on … AWS … us-east-1" (§2).
- Composio's self-host is "Enterprise arrangement, with Helm", and its customer-managed key mode means "Composio doesn't hold the key material" (§2, §3).
- Arcade's Helm chart "deploys the full Arcade platform onto a Kubernetes cluster you manage" (§2).
- Nango is ELv2 with a restriction on the hosted or managed service (§2), and its "Agents never touch credentials" (§3).
- Cloudflare: "OAuth tokens are securely stored in SQLite, and persist across agent restarts", and `createMcpOAuthProvider` allows our own pre-registered clients (§1).
- Smithery shut its connection management on 2026-10-31, Klavis archived its OSS, and mcp.run pivoted (§2). Three of the 2025 MCP-hosting startups exited the per-user connection business within a year.

### Inferences
- **Our baseline already has a reusable seam.** The `CredentialRoute.secret` thunk and the host-side credential proxy map cleanly onto a "mint short-lived token host-side" broker, whether that is the Cloudflare DO vault, Vercel Connect `getToken`, Auth0 Token Vault or a self-hosted Nango proxy. Raw tokens never need to enter a sandbox.
- **Self-host shape varies.** Arcade, Composio and Paragon need Kubernetes with Postgres and Redis, a heavy dependency in each user's cloud. The Cloudflare build path is lightest on Workers, and Nango is moderate (Docker or Helm).
- **Market churn is a risk.** Klavis, Smithery and mcp.run all changed course, and Pipedream is now owned by Workday. Prefer options with open code we could fork: Nango (ELv2), Activepieces (MIT), Cloudflare and Vercel kits (MIT/Apache).

### Gaps
- No hands-on test of any self-host install.
- No confirmation that Arcade Helm supports bring-your-own OAuth apps for every provider. It is implied by "Identity — your OIDC identity provider and OAuth providers".
- Whether Nango's self-hosted MCP and Agent Sessions require an enterprise licence key is unverified.

---

## 7. Notable newcomers (2025–26)

| Name | What | Evidence |
|---|---|---|
| **Vercel Connect** | Token broker, GA 2026-08-25. App, user and JWT subjects, triggers, MCP events, $3 per 1K token requests. Hosted on Vercel | https://vercel.com/docs/connect, https://vercel.com/changelog/vercel-connect-ga |
| **Scalekit AgentKit** | "1,100+ connectors and 55,000+ ready-to-call tools". "Scalekit injects it at runtime — your agent calls the tool, never the token". Deploys as Cloud, Private Cloud (VPC) or self-hosted with air-gap and BYO KMS. Pricing not on the page | https://www.scalekit.com/agentkit |
| **Auth0 for AI Agents / Token Vault** | (search summary) Stores users' connected-account tokens. Agent exchanges an Auth0 refresh token at `/oauth/token` for the provider access token. Async authorization. Plan-tiered connection counts | https://auth0.com/ai/docs/intro/integrations, https://auth0.com/pricing |
| **Descope Agentic Identity Hub 2.0** | (secondary) Updated 2026-01-27. MCP auth, token vault, gateways and policies | https://helpnetsecurity.com/2026/01/27/descope-agentic-identity-hub-2-0 |
| **Kong Token Vault** | (secondary) Per-user 3-legged OAuth in Kong AI Gateway, self-hostable gateway | https://konghq.com/blog/product-releases/kong-token-vault |
| **Keycard** | (secondary) Agent identity control layer with ephemeral, identity-attested credentials. No dated MCP launch found | https://www.keycard.ai/blog/agent-security-stack/ |
| **Turbo MCP (ex-mcp.run)** | Self-hosted MCP gateway with OIDC, RBAC registry, DLP, kill-switch and automatic OAuth/DCR | https://www.mcp.run/ |
| **Zapier MCP Embed** | Per-end-user Zapier MCP URLs inside your product. Cloud only | https://docs.zapier.com/mcp/embed/getting-started |

### Gaps
- Keycard, WorkOS and Stytch (now part of Twilio, per secondary sources) agent offerings were not checked first-hand.
- Scalekit pricing and SOC 2 status.
