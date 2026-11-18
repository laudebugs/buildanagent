# Developer-focused agent hosting and app-builder platforms (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-building-platforms.md](../fact-check-agent-building-platforms.md) and applied in [the report](../agent-building-platforms.md), which supersede this note where they disagree.

**How these notes were gathered (read first).** In this session, direct page fetches were blocked: WebFetch could not resolve langchain.com, mastra.ai, blog.cloudflare.com or developers.cloudflare.com, and the GitHub API was not enabled. Evidence therefore comes from four channels, and each finding is tagged with one of them:
- **[registry]**: read directly from the npm registry (`registry.npmjs.org/<pkg>`) or PyPI JSON (`pypi.org/pypi/<pkg>/json`) on 2026-11-18. This is primary for versions, publish dates and declared licences. The Mastra licence split was read from the `@mastra/core@1.85.0` tarball's `LICENSE.md`.
- **[cf-docs]**: verbatim chunks of developers.cloudflare.com, returned by Cloudflare's documentation-search tool. These are primary.
- **[snippet]**: a web-search summary of an official page (the URL is official, but I saw only the search engine's extract, not the full page). Treat this as primary-URL, secondary-reading, and re-verify before relying on it.
- **[secondary]**: a third-party blog, aggregator or pricing tracker. Treat it as unverified.

Today is 2026-11-18, and every version, price and status below is "as of November 2026".

## Q1. How is an agent built on each platform: code with an SDK, a studio, or generated from a prompt?

### Takeaway
The market splits three ways. Code-first frameworks with an optional hosted control plane are LangGraph/LangSmith, Mastra, Letta, Agno, VoltAgent, Pydantic AI, Inngest AgentKit, Trigger.dev, Temporal, Rivet and Cloudflare Agents. Infrastructure primitives that agents run on are Vercel Sandbox/Workflow, Cloudflare Sandbox/Containers, Modal and Smithery. Prompt-to-app builders are v0, Replit Agent, Lovable and Bolt. Only LangChain (LangSmith Fleet, formerly Agent Builder), Replit (Agents & Automations) and, in enterprise code, Mastra (`agent-builder/ee`) ship a dedicated "build an agent" product. Vercel's headless v0 API is the closest existing analogue to an "agent that builds agents and deploys them".

### Cited Findings
**LangChain (LangGraph / LangSmith)**
- LangSmith Agent Builder was launched as a "no-code agent builder"; LangChain says it is "an agent builder, not a visual workflow builder", and it is built on the `deepagents` package. [snippet] — [LangChain blog](https://blog.langchain.com/langsmith-agent-builder)
- Agent Builder has been renamed **LangSmith Fleet**; existing agents and integrations still work. [snippet] — [LangSmith Fleet docs](https://docs.langchain.com/langsmith/fleet/index)
- Fleet tools connect through "Agent Authorization" (Gmail, Slack, Linear and others) plus bring-your-own MCP servers. [snippet] — [LangChain blog](https://blog.langchain.com/langsmith-agent-builder)
- Code path: `@langchain/langgraph` 1.7.5 (2026-11-17), `deepagents` (npm) 1.17.0 (2026-11-17), `deepagents` (PyPI) 0.7.40 (2026-11-18), Python `langgraph` 1.2.22 (2026-11-14). [registry] — [npm @langchain/langgraph](https://registry.npmjs.org/@langchain/langgraph); [npm deepagents](https://registry.npmjs.org/deepagents); [PyPI deepagents](https://pypi.org/pypi/deepagents/json); [PyPI langgraph](https://pypi.org/pypi/langgraph/json)

**Mastra**
- Mastra is code-first TypeScript. The hosted "Mastra Platform" offers Observability (the baseline for every project), Studio (a hosted visual environment for testing agents and running workflows) and Server (a production API target); you deploy with `mastra deploy` or GitHub push-to-deploy. [snippet] — [Mastra Platform overview](https://mastra.ai/docs/mastra-platform/overview.md)
- `@mastra/core` 1.85.0 (2026-11-18) ships an enterprise-licensed `agent-builder/ee` module whose exports cover model allowlists and policies (`enforceModelAllowlist`, `builderToModelPolicy`, `resolvePickerVisibility`, `ModelNotAllowedError`), plus an `@mastra/editor` package ("Agent management and instantiation", 0.17.2). This points to a governed in-product agent builder. [registry] — [npm @mastra/core](https://registry.npmjs.org/@mastra/core); [npm @mastra/editor](https://registry.npmjs.org/@mastra/editor)

**Letta**
- Agents are built through the SDK/API or the web **Agent Development Environment (ADE)**. The ADE imports and exports `.af` agent files ("Export Agent"). [snippet] — [Letta Agent File docs](https://docs.letta.com/guides/agents/agent-file)
- The current emphasis is moving to **Letta Code** (CLI, `@letta-ai/letta-code` 0.34.65, 2026-11-17) and an "App Server". A mirrored AGENTS.md calls the legacy server repo deprecated. [registry] for the version — [npm @letta-ai/letta-code](https://registry.npmjs.org/@letta-ai/letta-code); [secondary] for the deprecation — [search summary citing Letta repo mirror](https://github.com/ifuryst/letta)

**Vercel**
- Vercel positions agents as AI SDK plus AI Gateway, made durable and capable with Sandbox, Chat SDK, Vercel Connect and Workflow. [snippet] — [Vercel AI agents guide](https://vercel.com/guides/ai-agents)
- **Agent harnesses**: Vercel docs list the Pi, fx, OpenCode, eve, Claude Code and Codex harnesses. **eve** is Vercel's "filesystem-first framework for durable backend AI agents that run anywhere" (npm `eve` 1.0.2, 2026-11-17, Apache-2.0), and "every eve session already runs as a durable workflow on the Workflow SDK". [snippet] — [Vercel agent harnesses](https://vercel.com/docs/agent-harnesses); [Vercel eve](https://vercel.com/docs/agent-harnesses/eve); [registry] — [npm eve](https://registry.npmjs.org/eve)
- **v0 API (GA)** gives programmatic access to v0's app-building agent: it generates and runs an app in an isolated Vercel Sandbox, returns an embeddable preview URL, and deploys via `chats.deploy`. v0 can also be used as a tool inside other agents via MCP, the AI SDK or eve. [secondary] — [InfoQ, Aug 2026](https://infoq.com/news/2026/08/vercel-v0-api); [developersdigest](https://www.developersdigest.tech/blog/vercel-v0-api-ga-2026)
- Vercel publishes a "v0 clone" template (OpenAI Agents + Vercel Sandbox; Next.js app builder with chat editing and live previews). [snippet] — [Vercel KB](https://vercel.com/kb/guide/v0-clone-openai-agents-vercel-sandbox.md)
- **Vercel Agent** is a Vercel-operated agent for code review and incident "investigations". It is not a way to build your own agents. [snippet] — [Vercel Agent docs](https://vercel.com/docs/agent)

**Cloudflare**
- Code-first. Cloudflare's docs split the stack into **runtime** (a Durable Object, the Lifecycle and capabilities such as WebSockets, State, Scheduler and MCPClientManager) and **harness** (the loop). "Most people building new agents should start with the Pi harness". [cf-docs] — [Cloudflare Harnesses](https://developers.cloudflare.com/agents/harnesses/); [Cloudflare Agents](https://developers.cloudflare.com/agents/)
- Listed harnesses: Pi (Pi Durable), OpenCode, Think (Experimental), Claude Code and Codex (CLIs in a Linux container), Nanocode and Exo (pre-1.0), Self-modifying (experimental), Flue (a third-party TypeScript framework built on Pi with a Cloudflare target), and "build your own". [cf-docs] — [Cloudflare Harnesses](https://developers.cloudflare.com/agents/harnesses/)
- Starter: `npm create cloudflare@latest agents-starter -- --template="cloudflare/agents-starter"`, a chat agent with tool calling and human-in-the-loop. [cf-docs] — [Changelog 2025-03-18](https://developers.cloudflare.com/changelog/post/2025-03-18-npm-i-agents/)
- Project Think was announced in Cloudflare's Agents Week, April 2026 (one secondary source says August; April is better supported). [secondary] — [lilting.ch](https://lilting.ch/en/articles/cloudflare-agents-week-think-browser-run-workflows); primary post (not fetched): [blog.cloudflare.com/project-think](https://blog.cloudflare.com/project-think/)
- Versions: `agents` 0.33.0 (2026-11-03, MIT), `@cloudflare/think` 0.23.0 (2026-10-29, MIT), `@cloudflare/ai-chat` 0.12.2, `@cloudflare/computer` 0.11.3 (2026-11-17, MIT), `@cloudflare/codemode` 0.5.6, `@cloudflare/sandbox` 1.0.3 (2026-10-22, Apache-2.0), `@flue/sdk` 2.3.1 (2026-11-18, Apache-2.0). [registry] — [npm agents](https://registry.npmjs.org/agents); [npm @cloudflare/think](https://registry.npmjs.org/@cloudflare/think); [npm @cloudflare/sandbox](https://registry.npmjs.org/@cloudflare/sandbox); [npm @flue/sdk](https://registry.npmjs.org/@flue/sdk)
- I found no evidence of a Cloudflare prompt-to-agent product beyond the AI Playground and starters (see Gaps).

**Replit**
- **Agents & Automations (beta)** shipped in the 2025-09-12 changelog. It covers a Slack Agent, a Telegram Agent and Timed Automations, which the agent creates from a prompt and a chosen trigger. An agent must be deployed to respond to external triggers. [snippet] — [Replit changelog 2025-09-12](https://docs.replit.com/updates/2025/09/12/changelog); [Replit automations](https://docs.replit.com/features/agent/automations.md)
- Replit **Agent 4** is current; the April 2026 changelog says it is powered by Claude Opus 4.7 and that it runs parallel agents and merges their results (sources conflict on the release date). [snippet] — [Replit changelog 2026-04-17](https://docs.replit.com/updates/2026/04/17/changelog)
- Replit Agent 3 ran Mastra agents in sandboxes ("thousands of Mastra agent sandboxes weekly"). [snippet] — [Mastra blog](https://mastra.ai/blog/replitagent3)

**Lovable / Bolt**
- **Lovable**: prompt-to-app. "Agent Mode" generates a Postgres table, a Supabase Edge Function in `supabase/functions` and a review UI. Lovable Cloud is a Lovable-managed Supabase instance. [secondary] — [RapidDev guide](https://www.rapidevelopers.com/md/lovable-issues/building-ai-agents-in-lovable); official integration page (snippet only): [Lovable Supabase docs](https://docs.lovable.dev/integrations/supabase.md)
- **Bolt** (StackBlitz): prompt-to-app with Bolt Cloud (hosting on `.bolt.host`, plus Bolt Database with tables, auth, storage, server functions and secrets; Supabase and Netlify are alternatives). It offers Standard and Max agents, and the v1 agent was retired on 2026-08-03. [snippet/secondary] — [Bolt support glossary](https://support.bolt.new/concepts/glossary); [Bolt intro](https://support.bolt.new/building/intro-bolt)

**Others (all code-first)**
- **Inngest AgentKit** (`@inngest/agent-kit` 0.13.2, last published 2025-11-13, Apache-2.0): networks of agents, and its human-in-the-loop requires wrapping the network in an Inngest function. [registry] — [npm @inngest/agent-kit](https://registry.npmjs.org/@inngest/agent-kit); [snippet] — [AgentKit HITL](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop)
- **Trigger.dev**: agents are "normal TypeScript" tasks (`@trigger.dev/sdk` 4.8.6, 2026-11-18, MIT). [registry] — [npm @trigger.dev/sdk](https://registry.npmjs.org/@trigger.dev/sdk); [snippet] — [trigger.dev llms-full](https://trigger.dev/llms-full.txt)
- **Temporal**: wraps other frameworks through plugins: `OpenAIAgentsPlugin` (Python, with a TypeScript version) and `AiSdkPlugin` in `@temporalio/ai-sdk` (TypeScript). [snippet] — [Temporal AI SDK integration](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [Temporal integrations](https://docs.temporal.io/integrations)
- **Pydantic AI** (PyPI `pydantic-ai` 2.70.0, 2026-11-17, MIT): code-first Python. [registry] — [PyPI pydantic-ai](https://pypi.org/pypi/pydantic-ai/json)
- **Agno** (PyPI `agno` 3.2.1, 2026-11-17, Apache-2.0): a framework plus AgentOS runtime, with a control-plane UI (local free, or hosted). [registry] — [PyPI agno](https://pypi.org/pypi/agno/json); [snippet] — [Agno control plane docs](https://docs.agno.com/agent-os/control-plane)
- **VoltAgent** (`@voltagent/core` 2.11.1, 2026-11-04, MIT): TypeScript framework plus the VoltOps console. [registry] — [npm @voltagent/core](https://registry.npmjs.org/@voltagent/core)
- **Rivet** (rivet.dev; `rivetkit` 3.1.1, 2026-11-11, Apache-2.0): an actor runtime where "each agent runs as its own actor with persistent context, memory, and the ability to schedule tool calls". Rivet also markets an "agentOS". Note that the unrelated **Ironclad Rivet** visual graph builder (`@ironclad/rivet-node` 1.25.0) was last published 2025-06-30, so it looks dormant. [registry] — [npm rivetkit](https://registry.npmjs.org/rivetkit); [npm @ironclad/rivet-node](https://registry.npmjs.org/@ironclad/rivet-node); [snippet] — [rivet.dev](https://rivet.dev/)
- **Modal** (PyPI `modal` 1.6.4, 2026-11-12; JS `modal` 0.11.2, 2026-11-17; both Apache-2.0): Python-first serverless compute plus Sandboxes. It is infrastructure, not an agent builder. [registry] — [PyPI modal](https://pypi.org/pypi/modal/json); [npm modal](https://registry.npmjs.org/modal)
- **Smithery**: an MCP server registry and host. Owners deploy servers from a "Deployments" tab or `smithery deploy`. [snippet] — [Smithery deployments docs](https://smithery.ai/docs/deployments)

### Inferences
- A builder that emits plain code for an open framework (AI SDK, Mastra, LangGraph, the Pi harness) fits our multi-cloud goal best. Studio-only products (LangSmith Fleet, Replit automations, Lovable Agent Mode) produce artefacts tied to their host.
- The v0 API (generate into a sandbox, preview, deploy) and Mastra's `agent-builder/ee` model-allowlist policy are the closest design references for an "agent that builds agents" with governance.

### Gaps
- I could not open the full Project Think post, the Cloudflare AI Playground page, or confirm a Cloudflare "build an agent from a prompt" product.
- I could not confirm whether Replit's Slack and Telegram agent templates carried over unchanged into Agent 4.
- I could not fetch Mastra's Agent Builder docs, so whether the `ee` builder is generally available or still internal is unverified.

## Q2. Where does the agent run, can it be self-hosted or deployed to another cloud, and what lock-in exists?

### Takeaway
Portability is best where the durable-state layer is pluggable: Vercel Workflow "Worlds" (Postgres), Pydantic AI (Temporal/DBOS/Prefect/Restate), Mastra deployers, Agno, VoltAgent, Rivet and Temporal. It is worst where the runtime itself is the product. Cloudflare Agents are bound to Durable Objects and SQLite. The full LangGraph Agent Server is source-available under Elastic-2.0 and needs an Enterprise licence to self-host with a control plane. Lovable Cloud and Replit run on their own managed infrastructure.

### Cited Findings
- **LangSmith Deployment** topologies: Cloud; **Hybrid** (LangChain-hosted control plane, your data plane; Enterprise plan); **Self-hosted with control plane** (Enterprise); **Standalone** Agent Server containers on Docker or Kubernetes that bring your own PostgreSQL, Redis and LangSmith licence. [snippet] — [LangSmith deployment](https://docs.langchain.com/langsmith/deployment); [Self-hosted Agent Server](https://docs.langchain.com/langsmith/enable-self-hosted-agent-server)
- PyPI `langgraph-api` (the Python Agent Server) 0.18.3 (2026-11-17) declares licence **Elastic-2.0**, while the JS `@langchain/langgraph-api` 1.8.0 declares MIT and describes itself as an "In-memory implementation of the LangGraph.js API". [registry] — [PyPI langgraph-api](https://pypi.org/pypi/langgraph-api/json); [npm @langchain/langgraph-api](https://registry.npmjs.org/@langchain/langgraph-api)
- **Mastra** offers optional deployers for Vercel, Netlify and Cloudflare (`@mastra/deployer-cloudflare` and `@mastra/deployer-vercel` 1.2.44, 2026-11-18), plus server adapters (Express, Hono, Fastify, Koa) that expose agents, workflows, tools and MCP servers on your own server. Self-hosted apps can still export telemetry to the platform through `MastraPlatformExporter`. [registry] — [npm @mastra/deployer-cloudflare](https://registry.npmjs.org/@mastra/deployer-cloudflare); [snippet] — [Mastra deployment overview](https://mastra.ai/docs/deployment/overview); [secondary] for the adapter list
- Mastra Enterprise lists "deploy Mastra Platform on-prem or in your cloud". [snippet] — [Mastra pricing](https://www.mastra.ai/pricing)
- **Letta**: the self-hosted Docker image `letta/letta` serves the API on port 8283. `.af` files import and export between any Letta server, self-hosted or Letta Cloud. [snippet] — [Letta Docker](https://docs.letta.com/guides/server/docker); [Letta Agent File](https://docs.letta.com/guides/agents/agent-file)
- Letta's `.af` spec repo is [letta-ai/agent-file](https://github.com/letta-ai/agent-file), and Letta described the format in a [launch post](https://letta.com/blog/agent-file). One source says `.af` export and import were removed from Letta Code; the date is unconfirmed. [secondary] — search summary (no stable URL)
- **Vercel Workflow DevKit**: "for self-hosting or deploying to other cloud providers, you can use community-maintained Worlds or build your own". The Postgres World (`@workflow/world-postgres` 5.3.0, 2026-11-17, Apache-2.0) uses PostgreSQL plus a job worker, runs in Docker, Kubernetes or any long-running server, and does **not** work on serverless. It passed 304/312 end-to-end tests (97%). The community Worlds for Turso, MongoDB and Redis are partial. [snippet] — [Workflow deploying](https://useworkflow.dev/docs/deploying); [Worlds ecosystem](https://useworkflow.dev/docs/worlds); [registry] — [npm @workflow/world-postgres](https://registry.npmjs.org/@workflow/world-postgres)
- Sources conflict on the Postgres World's queue: graphile-worker in some docs, pg-boss in another; package names also differ (`@workflow/world-postgres` vs `@workflow-worlds/postgres`). [snippet] — [Postgres World](https://useworkflow.dev/en/worlds/postgres)
- **eve** can self-host as a Node service "with your own workflow storage, sandbox provider, and routing". eve 0.31.3 was a preview subject to Vercel beta terms; 1.0.2 was published 2026-11-17. [snippet] — [eve self-hosting doc](https://unpkg.com/eve@0.65.0/docs/guides/deployment/self-hosting.md); [Vercel harness self-hosting](https://vercel.com/docs/agent-harnesses/self-hosting); [registry] — [npm eve](https://registry.npmjs.org/eve)
- **Cloudflare**: "each agent is a Durable Object"; harnesses keep state in the object's SQLite (`cf_agents_` tables; OpenCode tables carry an `opencode_` prefix). Pi and OpenCode manage their own transcripts, Think and AIChatAgent use the SDK's Sessions capability, and Claude Code and Codex use a SQLite-backed `HarnessStore`. [cf-docs] — [Cloudflare Agents](https://developers.cloudflare.com/agents/); [Add to existing project](https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/); [Harnesses](https://developers.cloudflare.com/agents/harnesses/)
- Cloudflare: "the Agents SDK keeps this input the same across harnesses, so you can switch harnesses without changing how your app talks to the agent", but "events and the transcript format" are harness-specific. [cf-docs] — [Harness concepts](https://developers.cloudflare.com/agents/concepts/harness/)
- **Agno**: the framework, local AgentOS and local control plane are free; the self-hosted control plane is Enterprise-only. [snippet] — [Agno pricing](https://www.agno.com/pricing)
- **VoltAgent**: VoltOps runs in the cloud or self-hosted, and the open-source framework runs standalone. [secondary] — [everydev](https://www.everydev.ai/tools/voltagent)
- **Rivet**: you "run the same open-source control plane as a Rust binary or container on your own infrastructure", or use Rivet Cloud. [snippet] — [rivet.dev](https://rivet.dev/)
- **Trigger.dev** has a "BYO cloud" offering. [snippet] — [Trigger.dev BYO cloud](https://trigger.dev/byo-cloud)
- **Temporal** is open source (MIT SDKs: `@temporalio/workflow` 1.26.0, Python `temporalio` 1.36.1) and self-hostable, with Temporal Cloud as the managed option. [registry] — [npm @temporalio/workflow](https://registry.npmjs.org/@temporalio/workflow); [PyPI temporalio](https://pypi.org/pypi/temporalio/json)
- **Lovable**: Lovable Cloud is a Lovable-managed Supabase that is not visible in your own Supabase account. Connecting your own Supabase project gives you direct ownership; Edge Functions run on Deno. [secondary] — [RapidDev](https://rapidevelopers.com/lovable-issues/what-is-lovable-cloud); [DEV: Lovable Cloud to your own Supabase](https://dev.to/andrewk17/lovable-cloud-to-your-own-supabase-without-the-password-resets-20c6)
- **Replit**: Slack, Telegram and timed agents must be deployed on Replit to respond to triggers. [snippet] — [Replit automations](https://docs.replit.com/features/agent/automations.md)

### Inferences
- Lock-in ladder, from most to least portable: Temporal and Pydantic AI ≈ Mastra ≈ VoltAgent ≈ Agno framework > Vercel Workflow (needs a non-serverless worker off Vercel) > LangGraph (MIT library, but the production server is Elastic-2.0 and Enterprise features are gated) > Cloudflare Agents (Durable Objects) > Lovable, Replit and Bolt.
- For multi-cloud deployment, a durable-execution abstraction with interchangeable backends (the Workflow World interface, Pydantic AI's four backends) is the pattern to copy. Cloudflare's "same input across harnesses" contract is a useful API boundary.

### Gaps
- I could not read the Elastic-2.0 terms as applied to the LangSmith Standalone Agent Server (that is, whether a free licence key is required).
- No authoritative statement says whether eve 1.0 is GA or still covered by beta terms.

## Q3. Do the platforms support bring-your-own model key, and which gateway features (retries, caching, cost accounting) do they offer?

### Takeaway
Every code-first platform lets you call providers with your own keys. Hosted gateways add retries, fallbacks and caching. Cloudflare AI Gateway is the most complete: stored BYOK keys in Secrets Store, a `byok_only` switch that refuses Cloudflare-billed fallback, configurable retries, fallback lists, caching and custom cost metrics. Vercel AI Gateway charges zero markup on BYOK, but on a BYOK failure it may retry on Vercel's credentials and bill your credits. Prompt-to-app builders default to their own gateway and treat BYOK as an exception.

### Cited Findings
- **Cloudflare AI Gateway**: "No vendor keys. AI Gateway holds third-party credentials, through Unified Billing or a key you store on the gateway"; gateway options include caching, logging, metadata, timeouts, retries (`maxAttempts` 1–5, backoff), `byokAlias`, `zdr` and `fallback` lists. [cf-docs] — [Agents models](https://developers.cloudflare.com/agents/models/); [AI SDK provider options](https://developers.cloudflare.com/agents/models/ai-sdk/)
- Credential precedence is request key, then stored BYOK (`default` alias), then Unified Billing. "Require provider credentials" (`byok_only: true`, or the per-request header `cf-aig-no-wholesale`) blocks the Unified Billing fallback (changelog 2026-09-14). [cf-docs] — [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/); [Changelog 2026-09-14](https://developers.cloudflare.com/changelog/post/2026-09-14-require-provider-credentials/)
- BYOK keys are stored with Secrets Store. [cf-docs] — [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
- Custom costs support cache-read and cache-write token rates (2026-09-09). [cf-docs] — [AI Gateway changelog](https://developers.cloudflare.com/changelog/product/ai-gateway/)
- AI Gateway core features (analytics, caching, rate limiting) are free on all plans. Accounts whose first gateway dates from 2026-09-24 or later store logs in Workers Logs at Workers Logs pricing. Unified Billing is rate-limited to 200 requests per 60 s per gateway; BYOK is exempt. [cf-docs] — [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/); [Limits](https://developers.cloudflare.com/ai-gateway/reference/limits/)
- A third-party listing claims a 5% Unified Billing credit fee. [secondary] — [respan.ai](https://www.respan.ai/market-map/cloudflare-ai-gateway)
- **Vercel AI Gateway**: provider list price with no token markup, BYOK included. It retries eligible failures across providers by default, supports configured fallbacks, and offers `caching: 'auto'`. [snippet] — [AI Gateway FAQ](https://vercel.com/docs/ai-gateway/faq); [Vercel gateway comparison](https://vercel.com/i/vercel-ai-gateway-vs-cloudflare-ai-gateway)
- If a BYOK request fails, the gateway reportedly retries on system credentials billed to your credits, and budgets cover system-credential spend only. [secondary] — [rabinarayanpatra.com](https://rabinarayanpatra.com/blogs/vercel-ai-gateway-deep-dive); [mintmcp](https://www.mintmcp.com/blog/vercel-ai-gateway-pricing)
- **Pydantic AI Gateway**: "one key for models across providers with spending caps". Third parties add priority failover, weighted traffic and caps per project, user and key. [snippet] — [Pydantic AI production docs](https://pydantic.dev/docs/ai/production/); [secondary] for the failover detail
- **Inngest** runs model calls through `step.ai`, so results are retried and cached durably. [secondary] — [Inngest skill page](https://www.typingmind.com/skills/asymmetric-al-inngest-agents)
- **LangSmith Fleet** pricing "now includes the underlying model costs across three performance tiers (Fast, Pro, Max)". [secondary] — [usagepricing.com 2026-07-21](https://usagepricing.com/blueprint/activity/langsmith-2026-07-21-price-change)
- **Letta Cloud**: the free tier supports BYO API keys. The API Plan is pay-as-you-go on model tokens, and Pro includes $20/month of credits for any model. [snippet] — [Letta plans](https://docs.letta.com/guides/api/plans)
- **Lovable**: AI features use a built-in gateway by default. BYOK means storing an Anthropic or OpenAI key in Secrets and calling it from an Edge Function. [secondary] — [RapidDev](https://www.rapidevelopers.com/md/lovable-issues/building-ai-agents-in-lovable)
- **Replit**: Agent work uses effort-based pricing, and an Auto mode (August 2026) picks the mode and model. [secondary]/[snippet] — [Replit changelog 2026-08-28](https://docs.replit.com/updates/2026/08/28/changelog)

### Inferences
- Cloudflare's `byok_only` behaviour is the right default for a BYO-key product. Vercel's silent fallback to system credentials is a cost and compliance surprise to design against.
- A portable gateway layer should expose the same knobs on every cloud (retries, fallback list, cache TTL and key, metadata, custom cost), as Cloudflare's provider options do.

### Gaps
- I could not confirm whether Vercel's BYOK fallback to system credentials is on by default or opt-in, or the exact current rates for Vercel and Cloudflare caching.
- I found no source on whether Mastra Platform, Agno or VoltOps proxy model calls or account cost per run.

## Q4. How do the platforms handle durable execution, human-in-the-loop approvals across long waits, and idempotency?

### Takeaway
Durable human-in-the-loop is now table stakes. The primitives are Trigger.dev waitpoint tokens, Inngest `waitForEvent`, Temporal signals, Cloudflare fibers with `submitMessages()` idempotent retries, LangGraph interrupts with a checkpointer, Vercel Workflow steps and hooks, and Pydantic AI's durable backends. Waits cost nothing on the serverless-durable platforms, which pay only for active work.

### Cited Findings
- **Cloudflare**: `runFiber()` gives "durable execution with checkpointing and recovery". Its API includes `startFiber` with an `idempotencyKey`, `inspectFiberByKey`, `cancelFiberByKey`, `stash` (snapshot) and `onFiberRecovered`. [cf-docs] — [Durable Execution](https://developers.cloudflare.com/agents/agent-class/durable-execution/)
- "Think always wraps chat turns in recoverable fibers"; after an eviction it reconstructs buffered chunks and "schedules a continuation or retry" (page updated 2026-10-29). [cf-docs] — [Think recovery](https://developers.cloudflare.com/agents/harnesses/think/recovery/)
- `@cloudflare/think` `submitMessages()` "provides durable acceptance, idempotent retries, status inspection, cancellation, and cleanup" (Agents SDK 0.12.4 changelog, 2026-05-13). [cf-docs] — [Changelog 2026-05-13](https://developers.cloudflare.com/changelog/post/2026-05-13-agents-sdk-v0.12.4/)
- Cloudflare's harness table says Think "continues from saved output"; Claude Code and Codex in containers fail the interrupted turn by default (optional retry reruns it); self-modifying custom tools "may rerun". [cf-docs] — [Harnesses](https://developers.cloudflare.com/agents/harnesses/)
- Pi tools declare `replay: "safe" | "unsafe"` for recovery. [cf-docs] — [Filesystem tools](https://developers.cloudflare.com/agents/tools/filesystem/)
- **Vercel Workflow**: managed on top of the open-source Workflow Development Kit, with pricing split into Workflow Steps and Workflow Storage; runs use Vercel Queues; "only pay for active execution time". [snippet] — [Vercel Workflow pricing](https://vercel.com/docs/workflow/pricing); [Vercel Workflow](https://examples.vercel.com/workflow)
- Vercel harnesses: "if the function running a turn fails with an error, another function resumes the turn right away". [snippet] — [Vercel agent harnesses](https://vercel.com/docs/agent-harnesses)
- **Trigger.dev**: `wait.createToken({ timeout: "1h" })` and `wait.forToken`; tokens can be completed through a REST endpoint; a paused task "sleep[s] without consuming any resources". [snippet]/[secondary] — [Trigger.dev Tierly story](https://trigger.dev/blog/tierly-customer-story); [Trigger skills: waitpoints](https://raw.githubusercontent.com/triggerdotdev/skills/main/trigger-agents/references/waitpoints.md)
- **Inngest AgentKit**: tools "can wait for human input" through `step.waitForEvent()`, and the network must be wrapped in an Inngest function. Inngest's durable-agents page models approved, rejected and no-response outcomes. [snippet] — [AgentKit HITL](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop); [Inngest durable agents](https://www.inngest.com/docs/learn/durable-agents)
- `waitForEvent` only catches events sent after the step starts. [secondary] — [Inngest skill page](https://www.typingmind.com/skills/asymmetric-al-inngest-agents)
- **Temporal**: under the AI SDK plugin, the AI SDK can be used directly in workflow code while Temporal handles durable execution; tools run as Activities. The OpenAI Agents integration wraps LLM calls for you. [snippet] — [Temporal AI SDK](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); [Temporal + AI SDK blog](https://temporal.io/blog/building-durable-agents-with-temporal-and-ai-sdk-by-vercel)
- **Pydantic AI** officially supports Temporal, DBOS, Prefect and Restate (installed as extras such as `pydantic-ai-slim[dbos]`). `DBOSAgent.run()` treats model requests and tool calls as DBOS steps. [snippet] — [Pydantic AI durable execution](https://pydantic.dev/docs/ai/integrations/durable_execution/overview/)
- **LangGraph** interrupts and resume with checkpointers are documented in our own verified reference (`langchain` skill, `humanInTheLoopMiddleware`, `Command` resume). LangSmith Deployment persists to PostgreSQL and Redis. [snippet] — [Self-hosted Agent Server](https://docs.langchain.com/langsmith/enable-self-hosted-agent-server)
- **Rivet** offers "durable execution, persistent state, and untrusted code execution", a durable queue and SQLite per actor. [snippet] — [rivet.dev](https://rivet.dev/)

### Inferences
- The idempotency-key-on-start plus replay-safety-per-tool pattern (Cloudflare fibers and Pi `replay`) is the most explicit design here and maps directly to our tool-safety rules.
- A portable HITL contract can be "pause with token, resume by API" (Trigger.dev, Inngest and Temporal signals all fit). Our harness should express approvals as resumable tokens and let each cloud's durable backend store them.

### Gaps
- The maximum wait for a Trigger.dev waitpoint and for an Inngest `waitForEvent` (one guide says 7 days) is unverified against the official limits.
- No idempotency guarantees were found for Mastra Platform or Letta Cloud runs.

## Q5. How is code execution sandboxed, and are secrets kept out of the sandbox?

### Takeaway
Two hosted sandboxes broker credentials outside the guest, so the untrusted code never holds the secret. Cloudflare does it with outbound Workers: `outboundByHost` handlers that inject headers, with TLS interception, allow and deny lists, and per-instance keys (April 2026). Vercel does it with a host-side firewall: `transform` injection rules and `forwardURL` proxying. Modal Sandboxes bill per second, but I found no equivalent brokering. Lovable and Bolt keep secrets in edge-function environments.

### Cited Findings
- **Cloudflare Sandbox / Containers**: "Because outbound handlers run in the Workers runtime, outside the sandbox, they can hold secrets the sandbox never sees… No token is ever passed into the sandbox." It supports per-instance keys via `ctx.containerId`, TLS interception, and allow and deny lists; `deniedHosts` and `allowedHosts` are evaluated before handlers (2026-04-13). [cf-docs] — [Changelog 2026-04-13](https://developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/); [Outbound traffic](https://developers.cloudflare.com/sandbox/sdk/guides/outbound-traffic/)
- Cloudflare's security docs warn that a token in a git clone URL lands in `.git/config`, where any test dependency can read it. They also advise adding credentials only to HTTPS requests. [cf-docs] — [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)
- The SDK protects against sandbox-to-sandbox access and container escapes through VM-based isolation. [cf-docs] — [SDK security](https://developers.cloudflare.com/sandbox/sdk/concepts/security/)
- Code Mode: model-written code runs in an isolated Worker; `DynamicWorkerExecutor` blocks direct `fetch()` and `connect()` by default, and the bearer token "never enters the sandbox". [cf-docs] — [Codemode MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/)
- Containers and Sandboxes went GA on 2026-04-13. Sandbox SDK 1.0 is the current package for new apps (npm 1.0.3); the 0.x docs are for existing apps. [cf-docs] — [GA changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/); [Sandbox SDK pricing (0.x)](https://developers.cloudflare.com/sandbox/sdk/platform/pricing/)
- A sandbox stops when its Durable Object goes inactive plus `setInactivityTimeout()` (up to 6 h). "Code that runs inside the instance does not count as activity". [cf-docs] — [Sandbox lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/)
- **Vercel Sandbox**: microVMs with a host-side firewall that guest code cannot modify. Credential brokering injects keys on outbound requests, and rules use `transform` (injection) or `forwardURL` (proxying) with matchers on path, method, query and headers. The default policy is allow-all, and rules can be changed on a running sandbox. [snippet] — [Sandbox firewall](https://vercel.com/docs/sandbox/concepts/firewall); [Credentials](https://vercel.com/docs/sandbox/credentials); [Changelog: inject credentials](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox); [Blog: network boundary](https://vercel.com/blog/a-sandbox-without-a-network-boundary-is-only-half-a-sandbox)
- Vercel's known gap: literal IPs and custom DNS resolvers in allowed ranges bypass SNI filtering and brokering. [snippet] — [Sandbox firewall](https://vercel.com/docs/sandbox/concepts/firewall)
- Plan availability: "All Vercel Sandbox firewall features are now available on the Hobby plan", which conflicts with an older page that requires Pro for transformation rules. [snippet] — [Changelog: firewall on Hobby](https://vercel.com/changelog/full-sandbox-egress-firewall-now-available-on-hobby-plan); [Sandbox vs E2B](https://vercel.com/kb/guide/vercel-sandbox-vs-e2b)
- `@vercel/sandbox` 4.0.0 was published 2026-11-12 (Apache-2.0). [registry] — [npm @vercel/sandbox](https://registry.npmjs.org/@vercel/sandbox)
- **Modal Sandboxes**: billed per second on the greater of request or usage. GPU sandboxes are preemptible; CPU sandboxes are not. [snippet] — [Modal sandbox resources](https://frontend.modal.com/docs/guide/sandbox-resources)
- **Letta Cloud**: remote sandboxes (tool execution) are charged against credits on Pro, and the API Plan charges $0.00015 per second of tool execution. [snippet] — [Letta plans](https://docs.letta.com/guides/api/plans)
- **Lovable**: AI calls go through Supabase Edge Functions, never the frontend, and the service-role key lives only in Cloud → Secrets. [secondary] — [RapidDev](https://rapidevelopers.com/lovable-integration/lovable-cloud)
- **Rivet** advertises "untrusted code execution" for agents. [snippet] — [rivet.dev](https://rivet.dev/)

### Inferences
- Cloudflare and Vercel now converge on the same pattern, an egress proxy outside the guest that injects credentials. Our pluggable sandbox interface should make brokered egress a required capability and give a Modal adapter a proxy shim.
- Both vendors default to allow-all egress or need explicit lists, so a builder that generates agents should emit deny-by-default egress configuration.

### Gaps
- I could not confirm whether Modal offers outbound credential injection (Modal Secrets inject environment variables into the container, which would put them inside the sandbox; I did not verify this in this session).
- E2B and Daytona are out of scope here; they are covered in the related repo report.

## Q6. What evals, tracing (OpenTelemetry `gen_ai` conventions) and cost-per-run reporting do the platforms offer?

### Takeaway
Tracing is universal. OpenTelemetry-native exporters are Logfire ("any OTel backend") and Cloudflare's observability. LangSmith and Mastra run their own trace stores with exporters, and AI Gateways supply per-request cost. I could not confirm explicit OTel `gen_ai.*` semantic-convention support for any platform from primary pages this session.

### Cited Findings
- **Logfire**: "OpenTelemetry traces of every run, in Logfire or any OTel backend" (PyPI `logfire` 5.6.0, 2026-11-11, MIT SDK). [snippet] — [Pydantic AI production](https://pydantic.dev/docs/ai/production/); [registry] — [PyPI logfire](https://pypi.org/pypi/logfire/json)
- **LangSmith**: tracing is required on Cloud deployments and optional on Hybrid and Self-hosted (which can send traces to a self-hosted LangSmith); distributed tracing covers RemoteGraph calls. The search did not confirm OTel export. [snippet] — [LangSmith data plane](https://docs.langchain.com/langsmith/data-plane.md)
- **Mastra**: Observability (traces, logs, metrics) is the baseline platform product. Observability events are 100K/month free on Starter, then $10 per 100K. [snippet] — [Mastra pricing](https://www.mastra.ai/pricing); [Mastra pricing blog](https://mastra.ai/blog/mastra-platform-pricing)
- `@mastra/core` exports `evals`, `observability` and `telemetry` subpaths. [registry] — tarball listing of [npm @mastra/core](https://registry.npmjs.org/@mastra/core)
- **Cloudflare**: each AI Gateway response carries the gateway log id, cache status, run id and the model that answered. Agents observability covers "logs · metrics · traces" for model calls. [cf-docs] — [Agents models](https://developers.cloudflare.com/agents/models/); [Agents](https://developers.cloudflare.com/agents/)
- **VoltOps**: traces, token usage, cost analysis and session monitoring, which also works outside VoltAgent. [secondary] — [VoltAgent pricing mirror](https://18a6adc2.voltagent.pages.dev/pricing)
- **Vercel Agent investigations** require Observability Plus. [snippet] — [Vercel Agent pricing](https://vercel.com/docs/agent/pricing)

### Inferences
- For cost per run, the gateway is the reliable source of truth (Cloudflare custom costs including cache tokens). A portable harness should emit `gen_ai` spans itself rather than depend on any platform's tracer.

### Gaps
- I found no primary confirmation of OTel `gen_ai.*` semantic conventions for LangSmith, Mastra, Agno, VoltOps, Inngest, Trigger.dev or Cloudflare.
- I found no eval-suite details for Agno, VoltOps or Letta.

## Q7. What do the platforms cost, under which licences, and what are the latest versions with dates?

### Takeaway
Licences: most frameworks are MIT or Apache-2.0. The notable exceptions are LangGraph's Python Agent Server (`langgraph-api`, **Elastic-2.0**) and Mastra's `ee/` directories, which carry a separate enterprise licence; the rest of Mastra is Apache-2.0. Mastra's own FAQ still describes ELv2, which conflicts with the current package licence. Pricing has moved toward usage-based metering: LangSmith's LCU and LSU meters (July 2026), Temporal's pay-as-you-go (September 2026), Trigger.dev's per-second compute and Cloudflare's active-CPU billing.

### Cited Findings
**Licences (declared in package metadata) [registry]**
- MIT: `@langchain/langgraph`, `langgraph` (PyPI), `deepagents`, `agents`, `@cloudflare/think`, `@cloudflare/computer`, `@trigger.dev/sdk`, `@temporalio/*`, `temporalio`, `pydantic-ai`, `logfire`, `@voltagent/core`. — [npm](https://registry.npmjs.org/agents); [PyPI](https://pypi.org/pypi/pydantic-ai/json)
- Apache-2.0: `ai` 7.0.177 (2026-11-18), `workflow` 5.6.1 (2026-11-17), `@vercel/sandbox`, `eve`, `@cloudflare/sandbox`, `inngest` 4.26.2, `@inngest/agent-kit`, `letta` (PyPI 0.34.12, 2026-10-12), `@letta-ai/letta-client` 1.12.1 (2026-06-02), `agno`, `modal`, `rivetkit`, `@flue/sdk`. — [npm ai](https://registry.npmjs.org/ai); [npm workflow](https://registry.npmjs.org/workflow); [PyPI letta](https://pypi.org/pypi/letta/json)
- **Elastic-2.0**: PyPI `langgraph-api` 0.18.3. — [PyPI langgraph-api](https://pypi.org/pypi/langgraph-api/json)
- **Mastra**: `LICENSE.md` in `@mastra/core@1.85.0` says content under any `ee/` directory (including `@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee` and `@mastra/editor/ee`) is under [`ee/LICENSE`](https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE), and everything else is Apache-2.0 (© 2025 Kepler Software). A `LicenseClient` reads `MASTRA_LICENSE_KEY` or `MASTRA_EE_LICENSE` and validates against `https://license.mastra.ai`, with a 3-day grace period. [registry] — [npm @mastra/core](https://registry.npmjs.org/@mastra/core)
- Contradiction: Mastra's FAQ still describes the Elastic License 2.0 (no offering Mastra as a hosted service). [snippet] — [Mastra FAQ](https://mastra.ai/docs/faq); contradicted by the Apache-2.0 plus `ee` split in the current package (above).
- `@smithery/cli` 4.11.1 declares no licence; `@smithery/sdk` 4.3.0 is MIT. [registry] — [npm @smithery/cli](https://registry.npmjs.org/@smithery/cli)

**Pricing**
- **LangSmith** (repriced 2026-07-21): two meters, LCU ($1.50) and LSU ($1.00). Deployment runtime is 0.045 LCU per vCPU-hour and database compute 0.177 LSU per vCPU-hour. Existing customers were grandfathered until 2026-10-01. Plus includes one free Serverless (Small) deployment. Fleet includes 5 LCU/month on Developer and 25 on Plus. Seats are $0 on Developer and $39 on Plus. [secondary] — [usagepricing.com 2026-07-21](https://www.usagepricing.com/blueprint/activity/langsmith-2026-07-21-lcu-lsu-reprice); official page not fetched: [langchain.com/pricing](https://langchain.com/pricing)
- **Mastra Platform**: Starter is $0/month (pay-as-you-go plus allowances), then Teams; a $25 Starter plan is also described; Enterprise offers on-prem. [snippet] — [Mastra pricing blog (Jul 2026)](https://mastra.ai/blog/mastra-platform-pricing); [$25 Starter](https://mastra.ai/blog/mastra-platform-starter-plan) (the $0 and $25 Starter descriptions conflict; check the live page)
- **Letta**: the API Plan is $20/month with unlimited agents, $0.10 per active agent per month, $0.00015 per second of tool execution and pay-as-you-go LLM usage. Pro is $20/month of credits (changed around 2026-11-08). Free has limited agents and BYOK. [snippet] — [Letta plans](https://docs.letta.com/guides/api/plans); [secondary] — [PricingSaaS diff 2026W46](https://pricingsaas.com/companies/letta/diffs/2026W46)
- **Cloudflare Containers/Sandboxes**: Workers Paid ($5/month) includes 375 vCPU-minutes, 25 GiB-hours and 200 GB-hours. Overage is $0.000020 per vCPU-second (active CPU only, since 2025-11-21), $0.0000025 per GiB-second of memory and $0.00000007 per GB-second of disk (memory and disk are billed on provisioned size). Instance types run from lite (1/16 vCPU, 256 MiB) to standard-4 (4 vCPU, 12 GiB). [cf-docs] — [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/); [CPU pricing changelog](https://developers.cloudflare.com/changelog/post/2025-11-21-new-cpu-pricing/)
- **Vercel**: Sandbox is metered across five metrics; Workflow bills Steps plus Storage; Vercel Agent is credit-based (no separate wallet since 2026-06-30) with 10 investigations included. About $0.30 per code review is unverified. [snippet] — [Sandbox pricing](https://vercel.com/docs/sandbox/pricing); [Workflow pricing](https://vercel.com/docs/workflow/pricing); [Agent pricing change](https://vercel.com/changelog/vercel-agent-has-updated-pricing); [secondary] for $0.30
- **Modal Sandboxes**: about $0.00003942 per physical-core-second (1 core = 2 vCPU), about 3× the Function rate, and about $0.0000067 per GiB-second. [secondary] — [Beam](https://www.beam.cloud/blog/modal-pricing-explained); [developersdigest](https://www.developersdigest.tech/agent-sandboxes/modal-sandboxes)
- **Trigger.dev**: per-second machine price × duration, plus $0.000025 per run. Free includes a $5 monthly credit; Hobby is $10 and Pro $50 (with $50 of usage). [snippet] — [Trigger.dev pricing](https://trigger.dev/pricing); [secondary] for the tier details
- **Inngest**: Hobby is free (about 50K executions); Pro is $75 or $99 per month for 1M executions (sources conflict). [secondary] — [Activepieces](https://www.activepieces.com/blog/inngest-pricing-2026-plans-limits-and-overage-costs.md); official: [inngest.com/pricing](https://www.inngest.com/pricing)
- **Temporal Cloud**: pay-as-you-go with no base fee replaced Essentials (around 2026-09-14), and the Developer plan is about $50 per million Actions. [snippet] — [Temporal PAYG blog](https://temporal.io/blog/paygo-developer-support.md); [secondary] — [usagepricing.com](https://www.usagepricing.com/blueprint/activity/temporal-2026-09-14-paygo-replaces-essentials)
- **Logfire**: Personal is free (10M records/month); Team is $49 and Growth $249 (from January 2026); overage is $2 per million records. [snippet] — [Logfire pricing change](https://pydantic.dev/articles/logfire-pricing-change); [Pydantic pricing](https://pydantic.dev/pricing.md)
- **Agno**: Free, Pro $150/month (hosted control plane, one live AgentOS connection), Enterprise custom (self-hosted control plane). Seat counts conflict across sources. [snippet] — [Agno pricing](https://www.agno.com/pricing)
- **VoltOps**: Developer is $0 (250 traces/month); Pro or Core is about $50 (sources conflict); Deploy is on Core and Pro. [secondary] — [VoltAgent pricing mirror](https://18a6adc2.voltagent.pages.dev/pricing); [VoltOps deploy doc mirror](https://scriptagc.wasmer.app/https_voltagent_dev/docs/deployment/voltops)
- **Smithery**: the registry is free and hosted compute is paid; "Important Update About Smithery Hosting" was posted 2026-01-14. [secondary] — [Smithery hosting update](https://smithery.ai/blog/updates-to-our-hosting-plan); [mcp.directory](https://mcp.directory/blog/how-to-deploy-an-mcp-server-2026)
- **Bolt**: the free tier includes about 1M tokens per month, and paid plans start around $18 per month (sources conflict). [secondary] — [aigearbase](https://aigearbase.com/tool/boltnew)

### Inferences
- Licence risk for a platform that hosts customer agents: shipping LangGraph's Python Agent Server or Mastra `ee/` code as a managed service needs licence review. The core libraries (LangGraph MIT, Mastra core Apache-2.0) are safe to embed.
- Usage meters are converging on vCPU-seconds of active compute plus storage. Idle waits are free on Cloudflare, Trigger.dev and Inngest, which favours long human-in-the-loop waits on those platforms.

### Gaps
- Official pricing pages for LangSmith, Mastra, Inngest, Bolt, Lovable, Replit, Modal and Smithery could not be opened (network allowlist), so all figures need verification.
- I could not read the text of Mastra's `ee/LICENSE` (it lives on GitHub, which was not reachable).
- I could not confirm the Rivet Cloud and Lovable Cloud price points.
- The hosts that must be allowed to close these gaps are langchain.com, docs.langchain.com, mastra.ai, blog.cloudflare.com, developers.cloudflare.com, vercel.com, github.com and the vendors' pricing domains.
