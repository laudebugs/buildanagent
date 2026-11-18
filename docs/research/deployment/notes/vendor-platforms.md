# Vendor agent-building and agent-hosting platforms (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-building-platforms.md](../fact-check-agent-building-platforms.md) and applied in [the report](../agent-building-platforms.md), which supersede this note where they disagree.

Scope: OpenAI, Google, AWS, Microsoft, Salesforce, Anthropic. Research date 2026-11-18.

**Source-quality note (read first).** In this session only `platform.claude.com` could be fetched directly. `platform.openai.com`, `developers.openai.com`, `aws.amazon.com`, `docs.cloud.google.com` and `devblogs.microsoft.com` failed DNS resolution (outside the session's allowed network). For those vendors, findings come from web-search result summaries restricted to the vendor's own domains (`allowed_domains`), so the cited URL is the vendor's primary page but the wording reached me through a search summary, not a full read. Those rows are tagged **[search summary of primary page]**. Rows from third-party blogs are tagged **[secondary]**. Rows from pages I read in full are untagged. A fact-check pass should re-read the tagged rows against the live pages once those hosts are allowed.

## 1. How is an agent defined, and does an AI assistant generate it?

### Takeaway
Every vendor now offers a config-defined hosted agent ("harness") next to a code SDK path, and most add a natural-language "describe your agent" builder; visual canvases are in retreat (OpenAI is shutting its Agent Builder canvas on 2026-11-30). Microsoft Copilot Studio, Salesforce Agentforce Vibes and AWS Kiro are the clearest NL-to-agent generators.

### Cited Findings

**OpenAI**
- Agent Builder (visual canvas, part of AgentKit) is deprecated: notice given 2026-06-03, shutdown 2026-11-30; replacements are the Agents SDK (code) or ChatGPT Workspace Agents (natural language); ChatKit remains available — [OpenAI Deprecations](https://developers.openai.com/api/docs/deprecations.md) **[search summary of primary page]**
- The AgentKit launch post carries an update: from 2026-11-30 Agent Builder and Evals "will no longer be available on the OpenAI platform" — [Introducing AgentKit](https://openai.com/index/introducing-agentkit/) **[search summary of primary page]**
- Migration path: open the workflow, click Code, choose Agents SDK; the guide warns the export does not convert the workflow graph or guarantee identical behavior — [Migrate from Agent Builder](https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder) **[search summary of primary page]**
- Prompt objects (`/v1/prompts`) also shut down 2026-11-30; Evals went read-only on 2026-10-31 (community checklist) — [Community: Nov 30 shutdown checklist](https://community.openai.com/t/nov-30-shutdown-checklist-agent-builder-evals-prompt-objects-evals-go-read-only-oct-31/1411075) **[secondary]**
- Agents API (public beta): OpenAI runs a managed Codex harness and its sandbox; your app starts sessions and receives events — [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview); [Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/) **[search summary of primary page]**
- OpenAI's comparison: the Agents SDK runs inside your application and gives it control of deployment, storage, approvals and runtime; the Agents API runs the managed Codex harness — [Agents guide](https://developers.openai.com/api/docs/guides/agents) **[search summary of primary page]**
- Workspace Agents are built in ChatGPT in natural language, and published workspace agents can be triggered from your own systems — [Workspace Agents](https://developers.openai.com/workspace-agents) **[search summary of primary page]**

**Google**
- Gemini Enterprise Agent Platform launched at Google Cloud Next '26 (2026-04-22) as the evolution of Vertex AI; Vertex AI Agent Engine was renamed Agent Runtime and Vertex AI Studio renamed Agent Studio — [Introducing Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform); [Name changes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes) **[search summary of primary page]**
- Agent Studio is the low-code path, "prototype prompts to deployed agents", with export to the full-code Agent Development Kit (ADK) — [Introducing Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform) **[search summary of primary page]**
- `agents-cli` scaffolds and deploys ADK agents to Agent Runtime, Cloud Run or GKE — [agents-cli deployment](https://google.github.io/agents-cli/guide/deployment/); [ADK quickstart on Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/agents/quickstart-adk) **[search summary of primary page]**

**AWS**
- AgentCore harness (GA, June 2026): define an agent in configuration (model, tools, skills, instructions) with `CreateHarness` and run it with `InvokeHarness`, or via the AgentCore CLI or console — [What's New: AgentCore harness GA](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-agentcore-harness-generally-available/); [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-harness-is-now-generally-available-go-from-idea-to-production-grade-agent-in-minutes/) **[search summary of primary page]**
- Bedrock Agents Classic (the older console/config agents) stopped accepting new customers on 2026-07-30; it stays in maintenance mode for existing customers with no planned end-of-life, no new features, and a frozen model catalog; new models go to AgentCore — [Bedrock Agents Classic maintenance mode](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-classic-maintenance-mode.html) **[search summary of primary page]**
- Kiro CLI 1.27: `/agent create` defaults to AI-assisted mode (merging the old `/agent generate`); users describe the agent and Kiro generates the agent configuration. This creates Kiro agents, not AgentCore deployments — [Kiro changelog 1.27](https://kiro.dev/changelog/cli/1-27/) **[search summary of primary page]**
- Kiro "powers" include an AWS Agents power for AgentCore workflows (tools, memory, policies, evaluation, observability) — [Kiro Powers](https://kiro.dev/powers/) **[search summary of primary page]**

**Microsoft**
- Copilot Studio standard harness: from a short prompt, AI generates name, description and instructions and suggests triggers, channels, knowledge and tools — [Quickstart: standard harness](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-get-started); [FAQ for agent creation from natural language](https://learn.microsoft.com/en-us/microsoft-copilot-studio/faqs-agent-creation) **[search summary of primary page]**
- A newer "Microsoft Copilot harness" in Copilot Studio lets you describe the agent in natural language (preview) and the system generates the configuration; agents cannot move between the two harnesses; NL creation is unavailable in sovereign clouds or when cross-geo is disabled — [About agents powered by the Microsoft Copilot harness](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/overview) **[search summary of primary page]**
- Agent flows can also be built from natural language — [Build an agent flow with natural language](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-nl) **[search summary of primary page]**
- Foundry Agent Service has prompt agents (config, invoked through the Responses API), workflow agents and hosted agents (your container); the Copilot harness in Foundry (public preview) runs the loop and sandbox for a prompt agent — [Prompt agents](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/prompt-agents); [Copilot harness in Foundry](https://devblogs.microsoft.com/foundry/microsoft-copilot-harness-in-foundry/) **[search summary of primary page]**
- Microsoft Agent Framework (code, .NET/Python) reached 1.0 GA on 2026-04-02 with stable APIs and long-term support — [MAF Version 1.0](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) **[search summary of primary page]**

**Salesforce**
- Agent Script is the YAML-based DSL for agents in the new Agentforce Builder, mixing natural-language instructions with programmatic expressions ("hybrid reasoning"); edit it in the Builder's Script view, in VS Code, or via the CLI — [Code Your Agent](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-nga-script.html); [Introducing Hybrid Reasoning with Agent Script](https://developer.salesforce.com/blogs/2025/10/introducing-hybrid-reasoning-with-agent-script) **[search summary of primary page]**
- Agentforce Vibes vibe-codes Agent Script from prompts, with `developing-agentforce`, `testing-agentforce` and `observing-agentforce` skills — [Build an Agent (Agentforce Vibes)](https://developer.salesforce.com/docs/platform/code-builder/guide/afv-agentdev-overview.html) **[search summary of primary page]**
- New Agentforce Builder debuted as a Pilot at Dreamforce 2025; the legacy builder gets no new features — [Build and Optimize Agents with New Agentforce 360 Features](https://developer.salesforce.com/blogs/2025/10/build-and-optimize-agents-with-new-agentforce-360-features); [Migrate to Agentforce Builder](https://www.salesforce.com/agentforce/agent-builder/migration/) **[search summary of primary page]**

**Anthropic**
- Claude Managed Agents (beta, header `managed-agents-2026-04-01`): an Agent is "the model, system prompt, tools, MCP servers, and skills", created once via `/v1/agents` and referenced by ID; Environment, Session and Events are the other core concepts — [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- Built-in features include compaction, prompt caching, multiagent orchestration and dynamic workflow runs, outcomes (`user.define_outcome`), budgets and scheduled deployments on cron — [Managed Agents reference](https://platform.claude.com/docs/en/managed-agents/reference); [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- Self-hosted deployments ship a console where people sign in via your IdP "to create agents and run sessions" — [Self-hosted Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/self-hosted)

### Inferences
- The market has converged on "agent = model + instructions + tools + skills + MCP servers" as a config object served by a vendor-run loop (Claude Managed Agents, AgentCore harness, Foundry prompt agents with Copilot harness, OpenAI Agents API). A builder-of-agents should target that shape as its intermediate representation.
- OpenAI's retreat from the canvas (and AWS freezing Bedrock Agents Classic) suggests vendors see code or config plus NL generation as the durable authoring surfaces, not flowchart canvases.

### Gaps
- Google Agentspace / Gemini Enterprise "agent designer" (no-code NL builder inside the Gemini Enterprise app) and Agent Garden: my searches returned nothing primary on their November 2026 state.
- No primary source found on a Claude.ai consumer/Team agent builder; I found none.
- Whether Agentforce Builder (new) is GA and on what date: not confirmed.

## 2. Deployment targets, portability and export

### Takeaway
Anthropic and AWS offer the most portability: Anthropic sells a self-hostable Managed Agents server (any infrastructure, PostgreSQL) and AWS's harness exports to Strands code. Google's ADK is open source and deploys to Cloud Run/GKE as well as Agent Runtime, and Google previewed a cross-cloud Agent Gateway. OpenAI exports to Agents SDK code. Copilot Studio and Agentforce stay inside their vendor's cloud.

### Cited Findings
- **Anthropic:** three options: cloud sandboxes (Anthropic hosts sandbox, service and model), self-hosted sandboxes (you host the sandbox), and self-hosted Managed Agents (you host sandbox and service; the model runs at Anthropic "or a provider that you choose") — [Self-hosted Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/self-hosted)
- **Anthropic:** self-hosted runs on "a cloud account or an on-premise data center": `cma-server` (API, agent loop, storage), PostgreSQL 16+, workers (`ant beta:worker`), Docker Compose stack and a `cma-sandboxes` Helm chart; access via account team; licensed under a proprietary "Software License Agreement: Claude Managed Agents Server" — [Self-hosted Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/self-hosted)
- **Anthropic:** hosted Managed Agents is in beta on the Claude API, Claude Platform on AWS and Claude Models on Google Cloud (Anthropic managed) — [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **OpenAI:** Agents API compute can be an OpenAI-managed sandbox, your own infrastructure, or a sandbox partner; self-hosted means running `codex exec-server` in your environment, registered with an environment ID and restricted API key (laptop, container or remote sandbox) — [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview); [Self-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted) **[search summary of primary page]**
- **OpenAI:** ChatKit can be self-hosted ("custom authentication, data residency, on-prem"); new ChatKit apps should use your own server-side agent with the ChatKit SDKs and Agents SDK — [Advanced integrations with ChatKit](https://developers.openai.com/api/docs/guides/custom-chatkit) **[search summary of primary page]**
- **OpenAI:** a ChatKit frontend pointed at an Agent Builder-hosted workflow ID loses its backend on 2026-11-30 — [Community thread](https://community.openai.com/t/nov-30-shutdown-checklist-agent-builder-evals-prompt-objects-evals-go-read-only-oct-31/1411075) **[secondary]**
- **AWS:** one CLI command exports a harness to Strands-based code on the same compute and primitives; Claude Agent SDK export is "coming soon" — [AWS ML blog: harness GA](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-harness-is-now-generally-available-go-from-idea-to-production-grade-agent-in-minutes/) **[search summary of primary page]**
- **AWS:** AgentCore Runtime runs agents from open-source frameworks (LangGraph, CrewAI, Strands) in microVMs — [AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html); [microVMs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html) **[search summary of primary page]**
- **AWS:** next-generation Runtime is the default for new runtimes (posted 2026-11-12); sessions start in under 2 s at P75 on a 2 GB image vs 29.7 s before; opt in with `platformVersion` V2 — [What's New: next-gen runtime default](https://aws.amazon.com/about-aws/whats-new/2026/11/new-agentcore-runtime-default/) **[search summary of primary page]**
- **AWS:** persistent "runtime instances" GA in August 2026 — [What's New: runtime instances GA](https://aws.amazon.com/about-aws/whats-new/2026/08/aws-bedrock-agentcore-runtime-instances-generally-available/) **[search summary of primary page]**
- **Google:** ADK deploys with `adk deploy cloud_run`, `adk deploy agent_engine` and `adk deploy gke` — [ADK Cloud Run](https://adk.dev/deploy/cloud-run/); [ADK CLI reference](https://adk.dev/api-reference/cli/); [ADK GKE](https://google.github.io/adk-docs/deploy/gke/) **[search summary of primary page]**
- **Google:** Agent Runtime claims sub-second cold starts, and agents can run continuously for up to 7 days — [What's new in Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/whats-new-in-gemini-enterprise-agent-platform) **[search summary of primary page]**
- **Google:** Agent Gateway GA 2026-06-18; a cross-cloud version for agents on non-Google Kubernetes clusters in Limited Preview as of 2026-11-11 — [Agent Platform release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes) **[search summary of primary page]**
- **Microsoft:** hosted agents in Foundry are framework-agnostic (Agent Framework, LangGraph, others); a Build 2026 post expected GA by early July 2026 — [Build 2026: Foundry Agent Service](https://devblogs.microsoft.com/foundry/agent-service-build2026/) **[search summary of primary page]**; GA since July 2026 per [DEV Community](https://dev.to/az365ai/foundry-hosted-vs-in-process-vs-copilot-studio-agents-2026-decision-2ek1) **[secondary]**
- **Microsoft:** publishing Foundry agents to Teams and Microsoft 365 Copilot is GA; Copilot Studio can hand tasks to Foundry-hosted connected agents — [Build 2026 post](https://devblogs.microsoft.com/foundry/agent-service-build2026/); [What's new in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/whats-new) **[search summary of primary page]**
- **Salesforce:** Agentforce agents run in the Salesforce org; agents built with the new Agent Script builder can be exposed to external AI clients as MCP tools — [MCP for Agentforce](https://help.salesforce.com/s/articleView?id=ai.agent_mcp.htm&language=en_US); [Agentforce hosted MCP servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/agentforce.html) **[search summary of primary page]**

### Inferences
- None of the vendors deploy a built agent to Cloudflare or Vercel as a first-class target. The open code paths (ADK, Strands export, OpenAI Agents SDK, MAF, Claude Agent SDK) are the only route onto non-vendor clouds, which is the niche an "agent that builds agents, deploys anywhere" platform would occupy.
- Self-hosted Claude Managed Agents is the closest vendor analogue to "deploy the harness to your own cloud with your own model provider", but it is licensed, gated by the account team, and Claude-only.

### Gaps
- Whether Google Agent Studio exports produce portable ADK code that runs off Google Cloud unchanged: not verified.
- Copilot Studio export (solution packages exist, but not code export) not researched in this pass.

## 3. Model choice and bring-your-own key

### Takeaway
AWS AgentCore and Microsoft Foundry are multi-vendor (Foundry hosts OpenAI, Anthropic, Meta, Mistral models; AgentCore works with models in and outside Bedrock). Anthropic, OpenAI and the hosted harnesses are mostly single-vendor, except self-hosted Claude Managed Agents, which routes to Bedrock, Google, Foundry or your own gateway (still Claude models).

### Cited Findings
- **Anthropic:** hosted Managed Agents supports all Claude models (list includes claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, claude-fable/mythos families and 4.x models) — [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **Anthropic:** self-hosted inference provider can be Amazon Bedrock, Claude Models on Google Cloud (Google managed), Microsoft Foundry, or your own model gateway; the server holds the inference credential — [Self-hosted Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/self-hosted)
- **AWS:** AgentCore Runtime works with models inside and outside Amazon Bedrock — [AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) **[search summary of primary page]**
- **AWS:** harnesses on managed defaults in commercial Regions use Claude Opus 5 — [AgentCore release notes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/release-notes.html) **[search summary of primary page]**
- **Microsoft:** Foundry runs models "from OpenAI, Anthropic, Meta, Mistral, and more"; the Copilot harness lets you choose a supported Foundry model — [Copilot harness in Foundry](https://devblogs.microsoft.com/foundry/microsoft-copilot-harness-in-foundry/) **[search summary of primary page]**
- **OpenAI:** Agents API model usage is billed at the selected OpenAI model's rates (no third-party model in the hosted harness found) — [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview) **[search summary of primary page]**
- **Salesforce:** model can be chosen per subagent — [Winter '27 developer guide](https://developer.salesforce.com/blogs/2026/10/developers-guide-to-the-winter-27-release) **[search summary of primary page]**

### Inferences
- "Bring your own model key" in the sense of plugging an arbitrary provider's API key into the vendor's hosted harness is not offered by any of the six; multi-model is offered as "models we resell" (Bedrock, Foundry, Model Garden).

### Gaps
- Google Agent Runtime/Agent Studio third-party model support (Claude in Model Garden etc.) not confirmed in this pass.
- Salesforce BYO LLM (formerly "Einstein BYOLLM") status in Nov 2026 not confirmed.

## 4. Tools, MCP, connectors and credential handling

### Takeaway
MCP is universal. Anthropic documents the strongest credential isolation: vaulted credentials injected at connection time or substituted at egress so "the agent never sees the secret value". AWS AgentCore Identity and Gateway, Google Agent Identity/Gateway and OpenAI's Connector Registry cover the same ground with less detail available to me.

### Cited Findings
- **Anthropic:** vaults hold per-user credentials referenced by ID at session creation; MCP credentials (`mcp_oauth`, `static_bearer`) are keyed by MCP server URL and injected automatically; with a `refresh` block, Anthropic refreshes OAuth tokens on your behalf — [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- **Anthropic:** `environment_variable` credentials are stored in the sandbox as an opaque placeholder and replaced with the real secret at egress; "The agent never sees the secret value"; secret fields are write-only; not yet supported in self-hosted sandboxes (run your own substituting proxy) — [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- **Anthropic:** vaults and credentials are workspace-scoped; any API key with workspace access can reference them — [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- **Anthropic:** remote MCP over streamable HTTP (SSE fallback), private MCP servers through MCP tunnels (research preview); built-in bash, file ops, web search/fetch with domain allow/block lists — [reference](https://platform.claude.com/docs/en/managed-agents/reference); [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **Anthropic (self-hosted):** the server never runs shell or file tools; workers do, and "The worker doesn't isolate that shell", so isolation comes from the container/pod — [Self-hosted](https://platform.claude.com/docs/en/managed-agents/self-hosted)
- **AWS:** Identity charges $0.010 per 1,000 token/API-key requests, free when used through Runtime or Gateway — [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) **[search summary of primary page]**
- **AWS:** Okta Cross App Access integration for governing agent access — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/govern-ai-agent-access-with-okta-cross-app-access-and-amazon-bedrock-agentcore-part-2/) **[search summary of primary page]**
- **Google:** Agent Identity gives each agent a unique cryptographic ID with auditable authorization policies; Agent Registry indexes agents and tools; Agent Gateway enforces security policy and Model Armor — [Introducing Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform); [Agent Gateway ISV ecosystem](https://cloud.google.com/blog/products/identity-security/introducing-agent-gateway-isv-ecosystem-for-security-and-governance) **[search summary of primary page]**
- **OpenAI:** Connector Registry consolidates data sources in one admin panel across ChatGPT and the API; beta; requires the Global Admin console — [Introducing AgentKit](https://openai.com/index/introducing-agentkit/) **[search summary of primary page]**
- **Salesforce:** Agentforce can call MCP tools (Streamable HTTP only; auth limited to none or OAuth 2.0 client credentials; server tools only) and register servers in the Agentforce Registry — [Considerations for MCP for Agentforce](https://help.salesforce.com/s/articleView?id=ai.agent_mcp_considerations.htm&language=en_US); [Register an MCP Server](https://help.salesforce.com/s/articleView?id=ai.agent_mcp_connect_register.htm&language=en_US) **[search summary of primary page]**

### Inferences
- Salesforce's MCP auth (client credentials only) means no per-end-user OAuth to external MCP servers, which limits "on behalf of user" actions outside Salesforce.

### Gaps
- Microsoft Foundry tool/identity (Entra Agent ID, toolbox, MCP auth) not confirmed in this pass.
- Whether AWS keeps credentials out of the Code Interpreter sandbox not confirmed.

## 5. Human-in-the-loop, guardrails and policy

### Takeaway
Anthropic's `always_ask` approvals wait indefinitely on a durable server-side session; AWS AgentCore Policy (GA 2026-03-03) is the only vendor policy engine found with a formal language (Cedar) that checks every tool call at the gateway. No vendor documents signed or tamper-evident approval records.

### Cited Findings
- **Anthropic:** policies `always_allow`, `always_ask`, `auto` (server evaluates each call and runs, denies or pauses); agent toolset defaults to `always_allow`, MCP toolsets to `always_ask`; custom tools are outside policy — [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
- **Anthropic:** on `always_ask`, the session goes `session.status_idle` with `stop_reason.type = requires_action`; "The session waits indefinitely for a response"; answer with `user.tool_confirmation` — [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
- **Anthropic:** each `agent.tool_use` / `agent.mcp_tool_use` event carries `evaluated_permission` and an `evaluation`, whose `reason_code` is meant to be kept "in audit records" — [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies); [reference](https://platform.claude.com/docs/en/managed-agents/reference)
- **AWS:** Policy GA 2026-03-03: policies authored in natural language convert to Cedar, attach to an AgentCore Gateway, and check every tool call; 13 Regions — [What's New: Policy GA](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/) **[search summary of primary page]**
- **AWS:** Policy pricing $0.000025 per authorization request, $0.13 per 1,000 input tokens for NL authoring — [cloudburn.io](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing) **[secondary]**
- **AWS:** Gateway supports Lambda interceptors alongside Policy — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-policy-and-lambda-interceptors-in-amazon-bedrock-agentcore-gateway/) **[search summary of primary page]**
- **AWS:** Dogwood, an open-source runtime-verification (temporal-logic) extension compatible with Cedar policies — [Introducing Dogwood](https://aws.amazon.com/blogs/opensource/introducing-dogwood-runtime-verification-for-ai-agents/) **[search summary of primary page]**
- **Google:** Agent Gateway enforces security policies and Model Armor protections — [Introducing Gemini Enterprise Agent Platform](https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform) **[search summary of primary page]**
- **OpenAI:** Agent Builder had a safety guide (guardrails node) — [Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety) **[search summary of primary page]**; in the Agents SDK, approvals are the application's job — [Agents guide](https://developers.openai.com/api/docs/guides/agents) **[search summary of primary page]**
- **Salesforce:** Agentforce Builder Simulate mode does not change real data; Live Test mode runs real actions — [How to Debug Agent Script](https://developer.salesforce.com/blogs/2026/03/agent-script-decoded-how-to-debug-agent-script) **[search summary of primary page]**

### Inferences
- Signed/tamper-evident approvals are an open gap across all six vendors (I found no documentation for any).

### Gaps
- Durability of approvals on AgentCore harness, Foundry and Copilot Studio not found.

## 6. Reversibility, idempotency and audit

### Takeaway
No vendor offers undo or compensation for agent actions. The closest features are Salesforce's simulate-vs-live split and Microsoft's statement that hosted-agent recovery depends on app checkpoints and "safe handling of repeated work".

### Cited Findings
- **Microsoft:** long-running hosted-agent resilience is GA, with recovery still depending on application checkpoints and safe handling of repeated work — [What's new in Microsoft Foundry](https://devblogs.microsoft.com/foundry/whats-new-in-microsoft-foundry-october-2026/) **[search summary of primary page]**
- **Anthropic:** `session.status_rescheduled` marks automatic retry after a transient error; the full event history is stored server-side and fetchable — [reference](https://platform.claude.com/docs/en/managed-agents/reference); [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **Salesforce:** Simulate mode vs Live Test mode — [How to Debug Agent Script](https://developer.salesforce.com/blogs/2026/03/agent-script-decoded-how-to-debug-agent-script) **[search summary of primary page]**

### Inferences
- Retries without vendor-provided idempotency keys or compensation mean repeated side effects are the builder's problem everywhere; this is a differentiator for a platform that adds sagas/rollback (see repo `docs/research/reversible-actions/`).

### Gaps
- No primary documentation found for undo, rollback or compensation on any of the six platforms.

## 7. Evals, testing, tracing and cost accounting

### Takeaway
AWS (AgentCore Evaluations GA 2026-03-31, 13 built-in evaluators) and Salesforce (Testing Center, Agentforce DX tests) have the most built-in testing; OpenAI is removing its hosted Evals (read-only 2026-10-31, gone 2026-11-30). Anthropic exposes per-session usage, list cost and budgets in the event stream.

### Cited Findings
- **AWS:** Evaluations GA 2026-03-31: 13 built-in evaluators, online and on-demand modes, nine Regions — [What's New: Evaluations GA](https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available/) **[search summary of primary page]**
- **AWS:** Evaluations pricing: built-in $0.0024 per 1K input tokens and $0.012 per 1K output tokens; custom $1.50 per 1,000 evaluations — [cloudburn.io](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing) **[secondary]**
- **AWS:** observability and cost controls for harness; runtime metrics docs — [Harness observability and cost controls](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-operations.html); [Runtime observability data](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-runtime-metrics.html) **[search summary of primary page]**
- **Anthropic:** `session.usage` carries cumulative usage, "tracked list cost" and the session's budget; `span.model_request_*` span events carry token counts; outcome evaluation spans report `satisfied`, `needs_revision`, etc.; webhooks available — [reference](https://platform.claude.com/docs/en/managed-agents/reference)
- **OpenAI:** Evals read-only and pointing to Promptfoo — [Deprecations](https://developers.openai.com/api/docs/deprecations.md) **[search summary of primary page]**
- **Salesforce:** test via Testing Center UI (CSV, no custom evals), Agentforce DX (YAML, custom evals) or Testing API (XML); next-gen Testing Center adds custom scoring evals, multi-turn and voice simulation, listed GA in May 2026 — [Agentforce DX](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx.html); [TDX 2026 Roundup](https://www.salesforce.com/blog/tdx-2026-roundup-agentforce-edition/) **[search summary of primary page]**
- **Salesforce:** Testing Center runs are unmetered for Flex Credits, though Data 360 queries are metered — [valintry360](https://valintry360.com/blogs/agentforce-implementation-cost/) **[secondary]**
- **Google:** a preview cost-estimator agent models Agent Runtime vCPU/RAM hours, sessions and Agent Gateway requests — [Estimate your monthly costs](https://docs.cloud.google.com/billing/docs/how-to/estimate-costs) **[search summary of primary page]**

### Inferences
- OTel export was not confirmed for any vendor in this pass; AWS (CloudWatch-based) and Google (Cloud Trace) almost certainly emit OTel-compatible traces, but treat that as unverified.

### Gaps
- OTel `gen_ai.*` support per platform; Foundry and Google evaluation services; OpenAI's replacement for hosted traces/evals.

## 8. Pricing, licensing and status

### Takeaway
Hosted runtimes price at roughly $0.08–0.13 per vCPU-hour (or $0.08 per session-hour at Anthropic) plus model tokens; seat/credit models dominate at Microsoft (Copilot Credits, $0.01 each) and Salesforce (Flex Credits, $0.005 each).

### Cited Findings
- **Anthropic:** token rates plus $0.08 per session-hour, no platform or seat fees — [Claude Managed Agents product page](https://claude.com/platform/claude-managed-agents) **[search summary of primary page]**; metered to the millisecond while running; web search $10 per 1,000 — [verdent.ai](https://www.verdent.ai/guides/claude-managed-agents-pricing) **[secondary]**
- **Anthropic:** rate limits 300 create req/min, 1,200 read req/min per org; not eligible for ZDR (except self-hosted) or HIPAA — [reference](https://platform.claude.com/docs/en/managed-agents/reference); [overview](https://platform.claude.com/docs/en/managed-agents/overview)
- **OpenAI:** Agents API has no platform fee; model, tool and hosted-container rates apply; container billing reported as per-minute with a 5-minute minimum (sources conflict with older per-20-minute rates) — [API pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=standard) **[search summary of primary page]**
- **OpenAI:** AgentKit carried no separate fee; ChatKit upload storage $0.10/GB-day after 1 GB free — [binaryverseai](https://binaryverseai.com/agentkit-guide-pricing-access-build-setup/) **[secondary]**
- **AWS:** Runtime v1 $0.0895/vCPU-hour, $0.00945/GB-hour; v2 $0.1276/vCPU-hour, $0.0169/GB-hour; v2 committed baseline $0.0997/$0.0132 (launching by Oct 2026); Browser and Code Interpreter $0.0895/$0.00945; CPU not billed during I/O wait — [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/); [harness operations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-operations.html) **[search summary of primary page]**
- **AWS:** Gateway $0.005 per 1,000 invocations — [cloudburn.io](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing) **[secondary]**
- **Google:** Agent Compute $0.085/vCPU-hour, Agent Memory $0.009/GiB-hour, per-second, idle between turns not billed — [Gemini platform pricing](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing) **[search summary of primary page]**; lowered 2025-12-16; Sessions, Memory Bank and Code Execution billable from 2026-01-28; Sessions storage $0.30/GiB-month — [Vertex AI release notes](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes) **[search summary of primary page]**
- **Google:** Gemini Enterprise seats from $21/seat/month (Business) — [coworker.ai](https://coworker.ai/blog/gemini-enterprise-pricing) **[secondary]**
- **Microsoft:** Foundry prompt/workflow agents carry no agent charge (tokens and tools billed); hosted agents billed on container compute — [Foundry Agent Service pricing](https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/) **[search summary of primary page]**; preview-era rates $0.0994/vCPU-hour and $0.0118/GiB-hour — [Introducing the new hosted agents](https://devblogs.microsoft.com/foundry/introducing-the-new-hosted-agents-in-foundry-agent-service-secure-scalable-compute-built-for-agents/) **[search summary of primary page]**; Copilot harness in Foundry free until consumption billing starts 2026-12-01 — [Copilot harness in Foundry](https://devblogs.microsoft.com/foundry/microsoft-copilot-harness-in-foundry/) **[search summary of primary page]**
- **Microsoft:** Copilot Studio: $0.01 per Copilot Credit pay-as-you-go; $200/month for 25,000-credit packs; classic answer 1 credit, generative answer 2, agent action 5; Agent Pre-Purchase Plan (P3) covers Copilot Studio and Foundry — [Billing rates](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management); [Copilot Studio pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio); [Agent Pre-Purchase Plan](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/agent-pre-purchase) **[search summary of primary page]**
- **Salesforce:** Flex Credits $500 per 100,000 ($0.005 each); standard action 20 credits (~$0.10); voice action 30 credits (~$0.15); Foundations ($0) includes Agentforce Builder, Prompt Builder and Agent Script; bundled credit allowances conflict across sources — [getmacha](https://www.getmacha.com/blog/agentforce-complete-guide); [concret.io](https://www.concret.io/blog/new-agentforce-pricing-model) **[secondary]**

Status summary (as of November 2026): Claude Managed Agents beta (since 2026-04); OpenAI Agents API public beta, Agent Builder/Evals shut down 2026-11-30; AgentCore harness GA (June 2026), Policy GA (2026-03-03), Evaluations GA (2026-03-31); Google Agent Platform launched 2026-04-22, Agent Gateway GA 2026-06-18, cross-cloud gateway limited preview; MAF 1.0 GA 2026-04-02, Foundry hosted agents GA ~July 2026 (secondary), Copilot harness preview; Copilot Studio NL "describe your agent" on Copilot harness preview; Agentforce Builder new version (pilot at Dreamforce 2025, GA date unconfirmed). Sources as cited above.

### Inferences
- Per-vCPU-hour hosting is commoditized (~$0.085–0.13); differentiation is in harness features, governance and integration, not compute price.

### Gaps
- Primary AWS Gateway/Memory/Observability numbers and Google Memory Bank rates not read in full.

## 9. Notable lock-in

### Takeaway
Lock-in concentrates in data/identity planes (Salesforce org data, Microsoft 365/Entra, Google Gemini Enterprise seats) and in vendor-hosted state (sessions, memory, approval queues). OpenAI's Agent Builder shutdown is a live example of the cost: canvas workflows must be exported to code by 2026-11-30 with no guarantee of identical behavior.

### Cited Findings
- OpenAI Agent Builder shutdown and lossy export — [Migrate from Agent Builder](https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder) **[search summary of primary page]**
- AWS Bedrock Agents Classic frozen for new customers and new models since 2026-07-30 — [maintenance mode](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-classic-maintenance-mode.html) **[search summary of primary page]**
- Copilot Studio agents cannot move between the standard harness and the Copilot harness — [Copilot harness overview](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/overview) **[search summary of primary page]**
- Agentforce: only agents built with the new Agent Script builder can be exposed as MCP tools — [MCP for Agentforce](https://help.salesforce.com/s/articleView?id=ai.agent_mcp.htm&language=en_US) **[search summary of primary page]**
- Claude Managed Agents: Claude models only; self-hosted server under a proprietary license; some features exist only on the hosted service — [Self-hosted](https://platform.claude.com/docs/en/managed-agents/self-hosted)

### Inferences
- Two vendors retired their first-generation agent builders within ~18 months of launch (OpenAI Agent Builder, AWS Bedrock Agents Classic), which supports pitching a vendor-neutral definition format that compiles to each vendor's harness or to open SDK code.

### Gaps
- Copilot Studio and Agentforce export formats were not researched.
