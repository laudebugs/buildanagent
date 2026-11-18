# Independent no-code and low-code agent builders (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-agent-building-platforms.md](../fact-check-agent-building-platforms.md) and applied in [the report](../agent-building-platforms.md), which supersede this note where they disagree.

Research date: 2026-11-18. Scope: Langflow, Flowise, Dify, n8n, AutoGen Studio, CrewAI (OSS + AMP), Relevance AI, Lindy, Gumloop, Zapier Agents, Make AI Agents, Botpress, Voiceflow, Stack AI, plus newcomers Sim (sim.ai) and OpenAI Agent Builder (deprecated).

Method notes for the report writer:
- Version numbers and dates come from the package registries (PyPI, npm) and Docker Hub, fetched 2026-11-18. The GitHub API and github.com were not reachable from this session, so GitHub release pages could not be read directly. LICENSE files were read via raw.githubusercontent.com or the published npm tarball (unpkg).
- Security data comes from the CISA KEV JSON feed (catalog version 2026.11.18) and the OSV.dev API, which mirrors GitHub Security Advisories and PyPA advisories. Both are primary or near-primary sources.
- Vendor docs were read as Markdown through each docs site's `llms.txt` index. Pricing pages were fetched as HTML and stripped to text.
- Anything from a search-engine summary or third-party blog is marked **(secondary)**.

---

## 1. How is an agent defined, and does an AI assistant generate it?

### Takeaway
Every platform now ships a natural-language "builder agent" next to its canvas: n8n AI Workflow Builder, Langflow Assistant, CrewAI Crew Studio, Botpress Viber/"Vibe", Relevance "Invent", Zapier Copilot, Sim "Chat with Sim", Voiceflow "Atlas", Gumloop and Lindy (prompt-first). The artefact these builders produce is almost always the vendor's own graph format (JSON) running on the vendor's runtime. Only CrewAI Studio documents exporting generated source code (a ZIP of a CrewAI project), and Botpress (ADK) and CrewAI also offer a code-first path.

### Cited Findings
**Open-source canvas builders**
- **n8n**: node-graph workflows. The AI Agent node is a LangChain-based node ([LangChain in n8n](https://docs.n8n.io/build/integrate-ai/langchain-in-n8n.md)). **AI Workflow Builder** "enables you to create, refine, and debug workflows using natural language descriptions… including node selection, placement, and configuration". Each message counts as one credit ([n8n docs](https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder.md)). Cloud plans include Assistant credits: 1,600/month on Starter and up to 9,600 on Pro. On self-hosted n8n, "Assistant is available in preview. You bring your own key (BYOK), so no credit limits apply" ([n8n pricing](https://n8n.io/pricing/)). There is also an "n8n MCP server" for building from external coding agents ([n8n docs index](https://docs.n8n.io/llms.txt)).
- **Langflow**: a visual graph of components; flows are JSON and can be imported and exported ([Langflow docs](https://docs.langflow.org/llms.txt)). **Langflow Assistant** "understands the structure of the Langflow graph, so it can build complete flows or create individual components from natural language prompts". It runs a built-in Langflow flow on your server with its own LLM, configured via `LANGFLOW_AGENTIC_EXPERIENCE` ([Langflow Assistant](https://docs.langflow.org/langflow-assistant)).
- **Flowise**: canvas "Agentflow V2", where each node is an independent unit with an explicit Flow State; Agentflow V1 is "Deprecating" ([Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2.md); [docs index](https://docs.flowiseai.com/llms.txt)). I found no Flowise doc page for a prompt-to-agentflow generator in the docs index (see Gaps).
- **Dify**: Workflow and Chatflow canvases, plus a new beta "Agent" type that "works in a sandbox of its own: it runs commands, installs programs, and reads and writes files". You build it once and use it as a chat app or as a workflow step ([Dify Agent](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/overview.md)).
- **AutoGen Studio**: a UI over AutoGen AgentChat for prototyping agent teams. Its README warns it is "not meant to be a production-ready app" ([AutoGen Studio README](https://raw.githubusercontent.com/microsoft/autogen/main/python/packages/autogen-studio/README.md)).
- **CrewAI**: OSS is code-first (Python Crews and Flows). **Crew Studio** on AMP is the "describe your crew" generator: "Describe the automation you want; the AI generates agents, tasks, and tools". Voice input works too. A canvas and the chat "share state and can be used interchangeably" (CrewAI calls this "vibe coding AI Agents"). **Publish** deploys the automation, and **Download** exports the source as a ZIP ([Crew Studio](https://docs-platform.crewai.com/platform/en/features/crew-studio.md)). The pricing page lists "Visual editor and AI copilot", "Export as MCP server" and "Export as UI component" on both tiers ([CrewAI pricing](https://www.crewai.com/pricing)).
- **Sim (newcomer)**: open-source "AI workspace" where workflows are designed "visually, through Chat, or with code". It lists 280+ integrations ([Sim docs](https://docs.sim.ai/llms.txt); [Sim pricing](https://www.sim.ai/pricing)). "Chat with Sim" is a paid-plan feature (Pro and up) ([Sim pricing](https://www.sim.ai/pricing)).

**SaaS builders**
- **Relevance AI**: **Invent** is "a forward deployed agent that builds, manages, and improves the specialist Agents". It creates Agents, Tools, Triggers and Workforces, then "reviews live performance… proposes and tests improvements" ([Invent docs](https://relevanceai.com/docs/build/invent/invent.md)). The marketing site describes "Invent 2.0" and "Factories" ([pricing page](https://relevanceai.com/pricing)).
- **Lindy**: now positioned as "an AI employee". You "describe what you need in a conversation", and it works through Slack, iMessage and email, with scheduled "routines" ([Lindy docs](https://docs.lindy.ai/index.md); [Lindy pricing](https://www.lindy.ai/pricing)).
- **Gumloop**: agent-first ("Agents: Unlimited"). Classic node workflows are now labelled "Workflows (Legacy)". It has a Gumloop MCP and CLI ([Gumloop pricing](https://www.gumloop.com/pricing)).
- **Zapier Agents**: "Create specialized agents—with the help of Zapier Copilot" ([zapier.com/agents](https://zapier.com/agents)). The Zapier MCP page says "Building is free from any surface, including through Zapier MCP" and refers to "Next Gen Zaps" in Early Access, with billing starting Dec. 1, 2026 ([zapier.com/mcp](https://zapier.com/mcp)). **(secondary)** One glossary claims agents became an "AI by Zapier" step inside Zaps on 15 July 2026; this is unverified ([getorchestra](https://www.getorchestra.io/knowledge-hub/glossary/zapier-ai)).
- **Make**: "Make AI Agent (New)" is an app used inside scenarios. It was released February 2, 2026, is in **open beta**, and its "functionality and pricing may change" ([Make help](https://help.make.com/introduction-to-make-ai-agent-new.md)). Its tools are modules, scenarios and MCP tools ([Make help index](https://help.make.com/llms.txt)).
- **Botpress**: three ways to build. **Viber** is "the conversational builder"; inside it, **Vibe** is "the builder agent… [that] translates your requests into structured agent configuration" ([How Viber works](https://botpress.com/docs/viber/get-started/how-viber-works.md)). **Studio** is the visual builder, and the **ADK** is a "CLI tool and development framework" where "you write conversations, workflows, tools, and actions as code. Botpress handles hosting" ([ADK intro](https://botpress.com/docs/adk-v2/get-started/introduction.md)).
- **Voiceflow**: Agent studio (playbooks plus deterministic workflows) and "Atlas, your AI copilot for building better agents" ([Voiceflow pricing page nav](https://www.voiceflow.com/pricing)). It documents connecting Claude Code, Codex or Cursor through a Voiceflow CLI or MCP server ([Connect coding agent](https://www.voiceflow.com/docs/platform/connect-coding-agent.md)).
- **Stack AI**: workflow builder plus an "agent builder and skills" with import, export and versioning of skills and projects ([Stack AI docs index](https://docs.stackai.com/llms.txt)).
- **OpenAI Agent Builder (newcomer, now being retired)**: the platform deprecations page lists "Agent Builder — Deprecated", announced Jun 3, 2026 with shutdown on Nov 30, 2026. The replacements are "Agents SDK or ChatGPT Workspace Agents. ChatKit remains available" ([OpenAI deprecations](https://platform.openai.com/docs/deprecations)). The Evals dashboard follows the same timeline ([same](https://platform.openai.com/docs/deprecations)).

### Inferences
- Prompt-to-agent is now table stakes, not a differentiator. What is still scarce is a builder agent whose output is portable code that the user owns and deploys. Only CrewAI Studio's ZIP export and Botpress ADK (code, but Botpress-hosted) come close.
- OpenAI retiring Agent Builder after about 14 months (launched Oct 2025 per [OpenAI](https://openai.com/index/introducing-agentkit/)) shows the platform risk of a hosted proprietary canvas. That argues for generating code against an open SDK.

### Gaps
- Flowise: no primary doc found for a natural-language agentflow generator; the docs index has no such page.
- Make's AI-assisted scenario builder ("Maia" is named in a Make release-note title in the [help index](https://help.make.com/llms.txt)) was not read in detail.
- Gumloop's and Lindy's agent definition formats (export or JSON) were not documented in the pages read.

---

## 2. Licence, ownership, self-host options, latest version

### Takeaway
Only five tools are truly open source with permissive licences: Langflow (MIT), CrewAI OSS (MIT), Sim (Apache-2.0), AutoGen Studio (MIT, but archived) and the Botpress SDK/CLI repo (MIT). Flowise is Apache-2.0 apart from a commercial `enterprise` directory. Dify is a modified Apache-2.0 that forbids multi-tenant use. n8n is source-available under the Sustainable Use License. Two of the big open-source builders now belong to large enterprises: Langflow to IBM, via DataStax, and Flowise to Workday.

### Cited Findings
| Platform | Licence (exact) | Owner / status | Latest version (date) | Self-host |
|---|---|---|---|---|
| Langflow | MIT ([LICENSE](https://raw.githubusercontent.com/langflow-ai/langflow/main/LICENSE)) | IBM (via DataStax) | 1.13.3, 2026-11-17 ([PyPI](https://pypi.org/project/langflow/); Docker `langflowai/langflow:1.13.3` pushed 2026-11-17, [Docker Hub](https://hub.docker.com/r/langflowai/langflow/tags)); docs show 1.14.x as "Next" ([release notes](https://docs.langflow.org/release-notes)) | pip/uv, Desktop, Docker, K8s ([docs](https://docs.langflow.org/llms.txt)) |
| Flowise | "Apache 2.0" for everything outside `packages/server/src/enterprise` and files with explicit notices, which are under a "Commercial License" ([LICENSE.md in npm 3.1.4](https://unpkg.com/flowise@3.1.4/LICENSE.md)) | Workday (acquired Aug 14, 2025) ([Workday PR](https://newsroom.workday.com/2025-08-14-Workday-Acquires-Flowise%2C-Bringing-Powerful-AI-Agent-Builder-Capabilities-to-the-Workday-Platform)) | 3.1.4, 2026-07-29 ([npm](https://www.npmjs.com/package/flowise); Docker `flowiseai/flowise:3.1.4` 2026-07-29, [Docker Hub](https://hub.docker.com/r/flowiseai/flowise/tags)) | npm, Docker; guides for AWS, Azure, GCP, DO, HF, Railway, Render, Replit, Sealos, Zeabur ([deployment](https://docs.flowiseai.com/configuration/deployment.md)) |
| Dify | "a modified version of the Apache License 2.0": no multi-tenant service without written authorisation (one tenant = one workspace); no removing the LOGO/copyright in the `web/` frontend; contributors agree the producer may change the licence ([LICENSE](https://raw.githubusercontent.com/langgenius/dify/main/LICENSE)) | LangGenius, Inc. | Docker `langgenius/dify-api:1.20.0` last pushed 2026-11-18 ([Docker Hub](https://hub.docker.com/r/langgenius/dify-api/tags)); push date is not necessarily the release date | Docker Compose; the Community edition "Complies with Dify Open Source License", single workspace ([Dify pricing](https://dify.ai/pricing)) |
| n8n | "Sustainable Use License" Version 1.0; files with `.ee.` are under the n8n Enterprise License; "Content of branches other than the main branch… are not licensed" ([LICENSE.md in npm 2.48.5](https://unpkg.com/n8n@2.48.5/LICENSE.md)) | n8n GmbH | stable/latest 2.48.5 (2026-11-18); next/beta 2.49.1 (2026-11-18); v1 line still patched, 1.123.98 (2026-11-18); 2.0.0 shipped 2025-12-08 ([npm registry](https://www.npmjs.com/package/n8n)) | Docker, Compose, K8s/GKE, AWS Terraform ([docs](https://docs.n8n.io/llms.txt)); the Business plan is "Self-hosted only" ([pricing](https://n8n.io/pricing/)) |
| AutoGen Studio | MIT ([LICENSE-CODE](https://raw.githubusercontent.com/microsoft/autogen/main/LICENSE-CODE); [PyPI](https://pypi.org/project/autogenstudio/)) | Microsoft; **archived**: "Microsoft is not providing bug fixes, security fixes, new features, or support"; successor is Microsoft Agent Framework ([AutoGen README](https://raw.githubusercontent.com/microsoft/autogen/main/README.md)) | autogenstudio 0.4.2.2, 2025-05-27; autogen-agentchat 0.7.5, 2025-09-30; agent-framework 1.26.0, 2026-11-12 ([PyPI](https://pypi.org/project/agent-framework/)) | pip, local UI |
| CrewAI | OSS MIT ([LICENSE](https://raw.githubusercontent.com/crewAIInc/crewAI/main/LICENSE)); AMP proprietary | crewAI, Inc. | crewai 1.15.42, 2026-11-18 ([PyPI](https://pypi.org/project/crewai/)) | OSS anywhere Python runs; AMP Enterprise: "CrewAI cloud, your own VPC, or your own infrastructure" ([pricing](https://www.crewai.com/pricing)) |
| Sim | Apache-2.0 ([LICENSE](https://raw.githubusercontent.com/simstudioai/sim/main/LICENSE)) | Sim Studio | Not determined (see Gaps) | Docker Compose (`bunx sim-setup`) or Helm on K8s ([self-hosting](https://docs.sim.ai/platform/self-hosting)); "Self-Hosted Enterprise Features" on Enterprise only ([pricing](https://www.sim.ai/pricing)) |
| Botpress | Repo (SDK/CLI/integrations) MIT ([LICENSE](https://raw.githubusercontent.com/botpress/botpress/master/LICENSE)); platform proprietary | Botpress Technologies | `@botpress/cli` 7.1.14, 2026-11-13 ([npm](https://www.npmjs.com/package/@botpress/cli)) | **None**: "Botpress v12 has been officially sunset… includes all other self-hosted or locally installed versions" ([Botpress docs](https://botpress.com/docs/studio/guides/advanced/v12.md)) |
| Stack AI | Proprietary | Stack AI | SaaS | Enterprise "On-prem deployment" and "VPC deployment" ([pricing](https://www.stack-ai.com/pricing)) via "StackAI Auto CLI… complete Docker deployment" on customer infrastructure ([docs](https://docs.stackai.com/stackai-auto-cli/docs.md)) |
| Relevance, Lindy, Gumloop, Zapier, Make, Voiceflow | Proprietary SaaS | — | SaaS | Gumloop Enterprise has optional "Virtual Private Cloud" ([pricing](https://www.gumloop.com/pricing)); no self-host found for the others |

Ownership detail:
- IBM closed the DataStax acquisition on 28 May 2025; the deal was agreed 25 Feb 2025 ([DBTA](https://www.dbta.com/Editorial/News-Flashes/IBM-Officially-Closes-Acquisition-of-DataStax-169711.aspx); [Seedtable](https://seedtable.com/exits/datastax)) **(secondary)**. DataStax had acquired Langflow in April 2024 ([Verdantix](https://www.verdantix.com/insights/blogs/ibm-acquires-datastax-as-enterprise-data-moves-within-reach-of-ai-everything)) **(secondary)**. An IBM community post says Langflow is being rebranded into "IBM Elite Support" offerings ([IBM Community](https://community.ibm.com/community/user/blogs/datastax-pm-team-datastax-pm-team/2025/10/02/ibm-datastax)). The Langflow docs now carry an "IBM Elite Support for Langflow" page ([release notes nav](https://docs.langflow.org/release-notes)). CISA KEV lists the August 2026 Langflow entry under vendor "IBM" ([CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)). IBM's product page offers "Langflow Cloud or watsonx Orchestrate" as publish targets ([IBM Langflow](https://www.ibm.com/products/langflow)); a search summary says Langflow Cloud is in "Private Preview" **(secondary)**.
- Workday acquired Flowise on Aug 14, 2025 (terms undisclosed) and said it would build agents into the Workday platform ([Workday PR](https://newsroom.workday.com/2025-08-14-Workday-Acquires-Flowise%2C-Bringing-Powerful-AI-Agent-Builder-Capabilities-to-the-Workday-Platform)). The Flowise team wrote that it is "doubling down" ([Flowise blog](https://blog.flowiseai.com/workday-flowise)) **(secondary, via search summary)**. A glossary claims Flowise "continues under MIT license" ([pangea](https://pangea.app/glossary/flowise)) **(secondary)**. The published 3.1.4 LICENSE.md contradicts this: it is Apache-2.0 plus a commercial enterprise directory.
- Langflow 1.13 breaking change: official packages and images now set `LANGFLOW_AUTO_LOGIN=false`, so authentication is required by default. 1.13 adds append-only audit logging, concurrent editing, instance migration, and an admin API/CLI ([release notes](https://docs.langflow.org/release-notes)).

### Inferences
- For a platform we would build on or fork, only Langflow, CrewAI and Sim are usable without commercial-licence conditions. Dify's no-multi-tenant clause rules out embedding it in a hosted multi-customer product without a licence, and n8n's SUL restricts commercial redistribution.
- Flowise's Workday ownership and the slower release cadence (3.1.4 in July, nothing newer on npm by November) point to a slowdown in OSS investment. That is inference only.

### Gaps
- Exact GitHub release dates for Dify 1.20.0 and Sim's latest version: GitHub was blocked, and Sim's npm package (`simstudio` 0.1.19, 2025-06-28) is stale and not the app version.
- Whether Sim's repo has an `ee/` directory under a different licence was not checked.

---

## 3. Deployment: SaaS-only, self-host, export to code, serverless (Cloudflare Workers / Vercel)?

### Takeaway
None of the platforms documents deploying a built agent onto Cloudflare Workers or Vercel Functions. All the self-hostable ones are long-running servers that need Postgres or SQLite, often Redis, plus workers and sandbox containers. Portability today means "Docker/K8s on any cloud", or an exported artefact called over HTTP or MCP. That leaves a clear gap for a builder that emits serverless-native code.

### Cited Findings
- **n8n**: Docker, Compose, GKE and AWS-Terraform guides; queue mode (multiple instances) and multi-main ("Coming soon") on Enterprise ([docs index](https://docs.n8n.io/llms.txt); [pricing](https://n8n.io/pricing/)). Workflows can be exposed as an MCP server via the "MCP Server Trigger" node ([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md)).
- **Langflow**: Docker, Kubernetes and cloud deploy docs; flows run via API, webhooks, or as an MCP server ([docs](https://docs.langflow.org/llms.txt)). `lfx` 1.13.3 ("Langflow Executor - A lightweight CLI tool for executing and serving Langflow AI flows") gives a lighter runtime for exported flows ([PyPI lfx](https://pypi.org/project/lfx/)). It is still Python, not a Workers runtime.
- **Flowise**: deployment guides cover AWS, Azure, GCP, Digital Ocean, Hugging Face, Railway, Render, Replit, Sealos and Zeabur. Vercel and Cloudflare are not listed ([deployment](https://docs.flowiseai.com/configuration/deployment.md)).
- **Dify**: Docker Compose; the new Agent's runtime is "bundled in" on Compose ([Dify Agent](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/overview.md)). Apps publish as an API, as web apps, to IM channels (Slack, Teams, Feishu, DingTalk, WeCom), and as MCP servers ([docs index](https://docs.dify.ai/llms.txt); [MCP Server](https://docs.dify.ai/en/self-host/use-dify/publish/publish-mcp.md)).
- **CrewAI**: Studio offers "Publish" (deploy to AMP) or "Download source as a ZIP" ([Crew Studio](https://docs-platform.crewai.com/platform/en/features/crew-studio.md)). AMP Enterprise deploys on "CrewAI cloud, your own VPC, or your own infrastructure" ([pricing](https://www.crewai.com/pricing)). The OSS project is plain Python, so it can be containerised anywhere.
- **Sim**: Docker Compose (bundles PostgreSQL, Redis and a scheduler) or a Helm chart ([self-hosting](https://docs.sim.ai/platform/self-hosting)). Deployed workflows are invoked via `POST /api/v2/workflows/{id}/execute` ([Sim docs](https://docs.sim.ai/llms.txt)).
- **Botpress**: hosted only. The ADK lets you write code, but "Botpress handles hosting, scaling, and channel delivery" ([ADK](https://botpress.com/docs/adk-v2/get-started/introduction.md)). Self-hosted v12 has been sunset ([v12](https://botpress.com/docs/studio/guides/advanced/v12.md)).
- **Voiceflow**: "Environments enable real production pipelines, from development to staging, and then to final production. All hosted on Voiceflow" ([pricing page](https://www.voiceflow.com/pricing)).
- **Stack AI**: SaaS, or on-prem/VPC on Enterprise through a Docker-based CLI that orchestrates a "50+ service platform" ([Stack AI CLI](https://docs.stackai.com/stackai-auto-cli/docs.md)).
- **Zapier, Make, Relevance, Lindy, Gumloop**: SaaS only. Zapier exposes its actions to external agents via Zapier MCP and the "Zapier SDK… from their own code, agents, or command-line tools" ([Zapier pricing](https://zapier.com/pricing)).

### Inferences
- Every builder's runtime assumes a stateful server, and many assume container sandboxes for code (Dify sandbox, n8n task runners, Gumloop VMs). This is why none targets Workers or Vercel. A Cloudflare or Vercel target would need durable state (Durable Objects, Workflows) and an external sandbox, which is our planned architecture.
- The "export as MCP server" feature in n8n, Langflow, Dify and CrewAI is the de facto interop path. A generated agent could call such flows as tools.

### Gaps
- No primary doc found for any of these platforms running on Cloudflare Workers or Vercel; this is absence of evidence, not a vendor statement.
- AWS, GCP and Azure marketplace listings were not checked.

---

## 4. Model choice, bring-your-own-key, MCP support

### Takeaway
Bring-your-own-key is universal on self-hosted OSS, and common on SaaS but often limited to paid tiers (Make, Relevance Pro+) or shown as "custom proxy" (Gumloop). MCP is now everywhere. n8n, Langflow, Dify, CrewAI and Gumloop act as both MCP client and MCP server (or MCP host). Zapier and Voiceflow expose MCP servers so external coding agents can drive them.

### Cited Findings
- **n8n**: "MCP Server Trigger", "MCP Client" and "Instance-level MCP" are on all plans. Cloud includes "AI models without API keys" via "Gateway credits" (not on Enterprise) ([pricing](https://n8n.io/pricing/); [MCP Client node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient.md)).
- **Langflow**: "MCP client and server"; flows can be served as MCP tools ([MCP server](https://docs.langflow.org/mcp-server); [docs](https://docs.langflow.org/llms.txt)). Global model providers are configured by the user ([Assistant prerequisites](https://docs.langflow.org/langflow-assistant)).
- **Dify**: cloud message credits cover "OpenAI, Anthropic, Gemini, xAI, Tongyi… Once they're used up, you can switch to your own API key" ([pricing](https://dify.ai/pricing)). MCP tools can be used in workflows and agents, and apps can be exposed as MCP servers (disabled by default) ([MCP Server](https://docs.dify.ai/en/self-host/use-dify/publish/publish-mcp.md)).
- **Flowise**: Tools & MCP tutorial, with Custom MCP, Browserless MCP and Pipedream MCP nodes ([docs index](https://docs.flowiseai.com/llms.txt)). Note that its CustomMCP node was the vector for the exploited CVE-2025-59528 (§9).
- **CrewAI**: MCP over stdio, SSE and Streamable HTTP, plus an "MCP Security Considerations" page ([docs](https://docs.crewai.com/_llms/en/v1-15-42/documentation.txt)). AMP has "Custom MCP Servers" and "Export as MCP server" ([AMP docs](https://docs-platform.crewai.com/llms.txt); [pricing](https://www.crewai.com/pricing)). AMP has an "Azure OpenAI Setup" guide and "LLM management" ([AMP docs](https://docs-platform.crewai.com/llms.txt)).
- **Sim**: "every major LLM"; MCP connections, with control over "which operations your workflow agents can call" ([Sim docs](https://docs.sim.ai/llms.txt)).
- **Gumloop**: "35+" models, "Bring Your Own API Keys", "custom proxy support" on Enterprise, "MCP Server Hosting" (1 on Pro), "MCP Server Proxying", and managed tunnels to private MCP servers ([pricing](https://www.gumloop.com/pricing); [docs index](https://docs.gumloop.com/llms.txt)). Enterprise "AI model governance" controls "which API keys those calls run on" ([docs index](https://docs.gumloop.com/llms.txt)).
- **Relevance AI**: Pro includes "Bring Your Own API Keys (BYOK)" ([Relevance docs pricing](https://relevanceai.com/docs/get-started/pricing.md)). "MCP & Plugins" lets you build and manage agents from Claude Code ([docs index](https://relevanceai.com/docs/llms.txt)).
- **Lindy**: "Model selection, all models"; "MCP support, connect any tool" ([pricing](https://www.lindy.ai/pricing)). It points at hosted MCP servers and saves API-key credentials ([docs index](https://docs.lindy.ai/llms.txt)). I found no explicit BYOK for LLM inference.
- **Make**: all plans use "Make's AI Provider"; paid plans can use "custom AI provider connections, such as OpenAI and Anthropic Claude" ([Make credits](https://help.make.com/credit-usage-for-ai-agents.md)). There are MCP tools for agents ([help](https://help.make.com/mcp-tools-for-ai-agents.md)).
- **Zapier**: Agents use "Zapier Agent's fine-tuned model" per a customer quote ([zapier.com/agents](https://zapier.com/agents)). Zapier MCP "is included in every Zapier plan. Each tool call uses two tasks" ([zapier.com/mcp](https://zapier.com/mcp)). I found no BYOK for Agents.
- **Botpress**: "Use different LLM for Autonomous Nodes" ([docs](https://botpress.com/docs/llms.txt)); AI usage is billed through Botpress ("$25 AI usage included" on Plus) ([pricing](https://botpress.com/pricing)).
- **Voiceflow**: "Choose from the biggest LLM providers, or bring your own model" ([pricing](https://www.voiceflow.com/pricing)); MCP step and MCP tool ([docs index](https://www.voiceflow.com/docs/llms.txt)).

### Inferences
- Per-run model markups and credits are the SaaS business model (Dify message credits, Botpress AI usage, Gumloop 8% orchestration fee). That makes true BYOK with zero markup a differentiator our platform can offer.

### Gaps
- Whether Zapier Agents or Lindy accept a customer's LLM key was not confirmed.

---

## 5. Human-in-the-loop approvals and their durability; guardrails

### Takeaway
Tool-level approval gates are now standard: n8n, Gumloop, Flowise, Dify, Sim, CrewAI, Lindy and Relevance all have them. Durability varies a lot. Dify documents per-node timeouts and a 7-day global cap. Flowise checkpoints and resumes after restart. Sim's pause "has no automatic response timeout". CrewAI AMP routes approvals by email with auto-response fallbacks. Guardrails exist as nodes (n8n Guardrails, CrewAI hallucination guardrail) or as org policy (Gumloop).

### Cited Findings
- **n8n**: human approval on selected tools of an AI Agent node. "The workflow pauses and sends an approval request through your configured channel (such as Slack, Telegram, or the n8n Chat interface)". Approve runs the tool "with the AI-specified input"; Deny cancels it and "the AI is informed" ([n8n HITL](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md)). It is listed on all plans as "Human approval for tool calls" ([pricing](https://n8n.io/pricing/)). n8n also has a "Guardrails" node ([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.guardrails.md)). Cloud "Max execution duration" is 5 min (Starter) or 40 min (Pro and Enterprise) ([pricing](https://n8n.io/pricing/)); whether waiting time counts was not stated (see Gaps).
- **Dify**: the **Human Input** node sends a form by email and IM. "The first response decides." A **Timeout** branch handles no-response. "Each run also has an overall limit of 7 days by default… When a run reaches it, any request still waiting expires, and the run stops." The limit is configurable via `HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS`. External contacts can respond without a Dify account ([Human Input](https://docs.dify.ai/en/self-host/use-dify/nodes/human-input.md)).
- **Flowise**: a Human Input node, or "Require Human Input" on an Agent's tools ([HITL tutorial](https://docs.flowiseai.com/tutorials/human-in-the-loop.md)). "Execution is paused while awaiting human input, without blocking the running thread. Each checkpoint is saved, allowing the workflow to resume from the same point even after an application restart" ([Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2.md)).
- **CrewAI**: OSS `@human_feedback` decorator (v1.8.0+) for Flows, plus Checkpointing that "saves a snapshot of execution state… so a crew, flow, or agent can resume after a failure or be forked" ([Checkpointing](https://docs.crewai.com/v1.15.42/en/concepts/checkpointing.md)). AMP "Flow HITL Management" is an "email-first architecture… anyone with an email address" can respond, with routing rules and "automatic fallback responses when no human replies in time" ([AMP HITL](https://docs-platform.crewai.com/platform/en/features/flow-hitl-management.md)). AMP also has a "Hallucination Guardrail" and "PII Redaction for Traces" ([AMP docs](https://docs-platform.crewai.com/llms.txt)), and a `POST /resume` API ([API ref](https://docs.crewai.com/v1.15.42/en/api-reference/resume.md)).
- **Sim**: the Human block "pauses a run until a person submits input… The pause has no automatic response timeout; it remains pending until resumed or cancelled" ([Sim HITL](https://docs.sim.ai/workflows/blocks/human-in-the-loop)).
- **Gumloop**: "The agent never executes a gated tool call without your explicit go-ahead." Approvals arrive in-app, by Slack DM or in the chat thread; "If approved, the agent continues from where it left off" ([Gumloop HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)). Guardrails are "Agent-scoped" on Pro and "Org-wide" on Enterprise ([pricing](https://www.gumloop.com/pricing)). Enterprise also has redaction that hides "sensitive text from the AI model while letting tools and people use the original value" ([docs index](https://docs.gumloop.com/llms.txt)).
- **Relevance AI**: Workforce "Approvals and Escalations" ([docs index](https://relevanceai.com/docs/llms.txt)).
- **Lindy**: "Approvals built in"; integrations controlled "with guardrails". If credits run low, "Lindy pauses and tells you" ([pricing](https://www.lindy.ai/pricing); [docs index](https://docs.lindy.ai/llms.txt)).
- **Botpress**: "Human Handoff" and an HITL integration interface, which is about escalating chats to human agents ([docs index](https://botpress.com/docs/llms.txt)).
- **Voiceflow**: agent "global instructions and guardrails" ([pricing](https://www.voiceflow.com/pricing)).

### Inferences
- Durable approvals are only explicitly documented by Flowise (checkpoint + restart) and Dify (timeouts + 7-day cap). Sim's unbounded pause and CrewAI's email auto-response sit at two different design points. Our harness should make approval durability explicit: persisted state, a timeout branch and a default action.

### Gaps
- n8n: whether a paused HITL approval survives restarts, and whether it is bounded by Cloud "max execution duration", is not stated on the HITL page.
- Zapier and Make approval features for agents were not confirmed from primary docs.

---

## 6. Reversibility, idempotency, audit logs

### Takeaway
Builders version the *agent definition* (draft/published versions, Git, rollback of deployments). None documents reversing or compensating the *side effects* an agent caused, and none offers idempotency keys for tool calls. Audit logs are enterprise-tier features nearly everywhere; Langflow 1.13 added an append-only audit log in OSS.

### Cited Findings
- **n8n**: workflow history (1, 5 or 365+ days by tier), Git version control and environments, workflow diff, audit logging and log streaming on Enterprise, automatic retries on all plans ([pricing](https://n8n.io/pricing/)). There is also a security audit command ([docs](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/run-security-audits.md)).
- **Langflow 1.13**: `LANGFLOW_AUDIT_ENABLED=true` "record[s] an append-only history of flow and project operations, including who attempted a change, on which resource, when, how it completed" ([release notes](https://docs.langflow.org/release-notes)).
- **Dify**: version control for Chatflow and Workflow, with a Current Draft and a published "Latest Version" ([Version Control](https://docs.dify.ai/en/self-host/use-dify/build/version-control.md)). Cloud has "Unlimited Log History" on Professional ([pricing](https://dify.ai/pricing)).
- **CrewAI**: checkpoints with lineage IDs allow resume or fork; "Callbacks are saved only as references" ([Checkpointing](https://docs.crewai.com/v1.15.42/en/concepts/checkpointing.md)). AMP has "Deployment history" ([pricing](https://www.crewai.com/pricing)).
- **Voiceflow**: "Preview your changes before publishing, see every version, and roll back when you need to" ([Publishing](https://www.voiceflow.com/docs/documentation/deploy/environments/publishing.md)); environments support A/B tests with traffic splits ([Environments](https://www.voiceflow.com/docs/documentation/deploy/environments/overview.md)).
- **Relevance**: version history to "Track, restore, and manage versions of your Agents, Tools, and Workforces" ([docs index](https://relevanceai.com/docs/llms.txt)). Audit logs are on Enterprise ([pricing page](https://relevanceai.com/pricing)).
- **Botpress**: bot Versions and Import & Export ([docs index](https://botpress.com/docs/llms.txt)).
- **Audit logs on enterprise tiers**: Gumloop ([pricing](https://www.gumloop.com/pricing)), Lindy ([pricing](https://www.lindy.ai/pricing)), Zapier Agents Enterprise "Enterprise-grade audit logs" ([pricing](https://zapier.com/pricing)), Sim (API "Requires an Enterprise subscription") ([Sim docs](https://docs.sim.ai/llms.txt)). Make added "MCP tools for audit logs" ([help index](https://help.make.com/llms.txt)).
- **Gumloop**: agent artifacts are versioned ([docs index](https://docs.gumloop.com/llms.txt)). **Lindy**: memory is "a versioned file system" and team files have version history ([docs index](https://docs.lindy.ai/llms.txt); [pricing](https://www.lindy.ai/pricing)).

### Inferences
- Side-effect reversibility (sagas, compensations, idempotent retries) is an open gap across the whole category. This links to our own `docs/research/reversible-actions/` work.

### Gaps
- No platform docs found on idempotency keys or deduplication for agent tool calls.

---

## 7. Evals, testing, tracing (OTel, LangSmith/Langfuse), cost tracking

### Takeaway
Most OSS builders integrate third-party tracers (Langfuse, LangSmith, Arize/Phoenix, Opik). n8n and CrewAI AMP export OpenTelemetry. Built-in evals exist in n8n, Flowise, Relevance, Gumloop, Voiceflow and CrewAI AMP. Cost tracking appears as token counts or credit dashboards, rarely as per-run dollar cost.

### Cited Findings
- **n8n**: OpenTelemetry tracing is in "Preview from n8n 2.19.0"; it emits `workflow.execute` and `node.execute` spans, with metrics planned ([OTel](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry.md)). LangSmith and OTel tracing are "Available in self-hosted". Light evaluations are on all plans; metric-based evaluations cover 1 workflow on Starter and are unlimited on Pro+ ([pricing](https://n8n.io/pricing/); [evaluations](https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows/use-metrics-to-measure-quality.md)). Insights dashboards run 7 to 365 days by tier ([pricing](https://n8n.io/pricing/)).
- **Langflow**: observability integrations for OpenTelemetry, Arize, Langfuse and LangSmith ([Langflow docs](https://docs.langflow.org/integrations-langfuse)).
- **Flowise**: analytics for Arize, Langfuse, LangWatch, Lunary, Opik and Phoenix, plus an "Evaluations" feature ([docs index](https://docs.flowiseai.com/llms.txt); [evaluations](https://docs.flowiseai.com/using-flowise/evaluations.md)).
- **Dify**: LangSmith, Langfuse and Alibaba Cloud Monitor integrations, a Dashboard and an Annotation System ([docs index](https://docs.dify.ai/llms.txt)).
- **CrewAI AMP**: Tracing, OpenTelemetry, "LLM testing", usage dashboard, "Token count" and performance metrics on both tiers ([pricing](https://www.crewai.com/pricing)). There are OpenTelemetry export and Datadog guides ([AMP docs](https://docs-platform.crewai.com/llms.txt)).
- **Sim**: Logs "Trace every agent run block by block, including actions, cost, and failures" ([pricing nav](https://www.sim.ai/pricing)).
- **Relevance**: an Evals suite with simulated-conversation tests, check types and "Monitoring Evals" on real conversations ([docs index](https://relevanceai.com/docs/llms.txt)). Enterprise adds "A/B testing & analytics" ([pricing page](https://relevanceai.com/pricing)).
- **Gumloop**: "Evaluations: Automatically grade every agent interaction", org-level evaluations, "AI Spend Insights" and a usage analytics agent ([docs index](https://docs.gumloop.com/llms.txt); [pricing](https://www.gumloop.com/pricing)).
- **Voiceflow**: "Tests & simulations" and "LLM-powered evaluations" ([pricing](https://www.voiceflow.com/pricing)).
- **Make**: "Credit usage history… across scenarios and AI agents, with run-level" detail ([help index](https://help.make.com/llms.txt)).
- **OpenAI**: the Evals dashboard and API go read-only, with "Migrate to Promptfoo" listed, on the same Jun 3 to Nov 30, 2026 timeline ([deprecations](https://platform.openai.com/docs/deprecations)).

### Inferences
- OTel `gen_ai.*` semantic conventions are not explicitly claimed by any builder read here. n8n's spans are workflow and node spans, not GenAI spans. Native `gen_ai.*` spans would be a differentiator.

### Gaps
- Per-run dollar cost tracking was not confirmed for n8n, Langflow or Dify from primary pages.

---

## 8. Pricing tiers and numbers (as of November 2026)

### Takeaway
Pricing has converged on usage meters: executions (n8n), credits (Lindy, Gumloop, Make, Sim, Voiceflow), conversations (Botpress), actions (Relevance) and activities (Zapier Agents). Prices run from roughly $20 to $50 a month at entry to custom enterprise contracts. Several vendors (CrewAI, Stack AI, Relevance's public page, Voiceflow) hide everything except a free tier and "Contact sales".

### Cited Findings
- **n8n Cloud** ([pricing](https://n8n.io/pricing/)), annual billing:
  - Starter: €20/mo, 2.5K executions, 5 concurrent.
  - Pro: €50/mo, 10K executions, up to 50 concurrent.
  - Business: €667/mo, 40K executions, "Self-hosted only", with SSO/LDAP, environments, queue mode and Git.
  - Enterprise: custom.
  - Annual billing saves 17%. The Community Edition is free and self-hosted. The Startup plan gives 50% off Business for under 20 employees.
- **Dify Cloud** ([pricing](https://dify.ai/pricing)):
  - Sandbox: free, 200 message credits.
  - Professional: $590 per workspace per year, 5,000 credits/mo, 3 members, 50 apps.
  - Team: $1,590 per workspace per year, 10,000 credits/mo, 50 members, 200 apps.
  - Enterprise: custom, including a "Commercial License Authorization".
  - Community: free.
- **CrewAI AMP** ([pricing](https://www.crewai.com/pricing)): Basic is free with 50 workflow executions/month and 2 automations. Enterprise is custom, with a "45-day onboarding" and "Forward deployed engineering… a la carte".
- **Flowise Cloud**: the pricing page could not be read (it returned an empty shell) — see Gaps.
- **Relevance AI**: the public pricing page shows only Enterprise ("Talk to sales") ([pricing](https://relevanceai.com/pricing)). The docs pricing page lists:
  - Pro: $19/mo annual or $29 monthly, with 2,500 Actions/mo, $20/mo Vendor Credits and BYOK.
  - Team: $234/mo annual or $349 monthly, with 7,000 Actions/mo and $70/mo Vendor Credits.
  - "The Free plan is retired for new signups and existing accounts" ([docs pricing](https://relevanceai.com/docs/get-started/pricing.md)).
  - Conflict: the public page and the docs disagree on whether self-serve tiers are still offered.
- **Lindy** ([pricing](https://www.lindy.ai/pricing)): Free is $0 with $50 in credits that last 7 days. Team starts at $49.99/mo for 5,000 credits, with bundles up to 1,750,000 credits for $9,999.50. "Every active user in your workspace is billed". Top-ups cost $10 per 1,000 credits. Enterprise is custom (HIPAA BAA, SSO/SCIM, audit logs).
- **Gumloop** ([pricing](https://www.gumloop.com/pricing)): Pro costs $37/month with 20k credits/month, unlimited seats and an "Orchestration Fee 8%". Enterprise is custom. There is a 14-day trial.
- **Zapier** ([pricing](https://zapier.com/pricing)): Free is $0 (100 tasks/mo), Professional from $19.99/mo, Team from $69/mo. For Agents: Free gives 400 activities/mo; Pro is $33.33/mo billed annually ($400/yr) for 1,500 activities/mo; Enterprise is custom, with audit logs and restricted apps. Zapier MCP tool calls cost 2 tasks each ([zapier.com/mcp](https://zapier.com/mcp)).
- **Make**: the official pricing page was blocked by a Cloudflare challenge. **(secondary)** Aggregators say Free has 1,000 credits/mo, and Core, Pro and Teams start at 10,000 credits. Quoted annual prices range from about $9 to $12 (Core), $16 to $21 (Pro) and $29 to $38 (Teams) per month, and sources disagree ([jetadmin](https://www.jetadmin.io/blog/make-pricing/); [eesel](https://eesel.ai/blog/make-pricing)). The AI Agent (New) app is in open beta and its "pricing may change" ([Make help](https://help.make.com/introduction-to-make-ai-agent-new.md)).
- **Botpress** ([pricing](https://botpress.com/pricing)), annual billing:
  - Free: $0, 100 conversations, 3 seats, 3 agents.
  - Plus: $150/mo, 250 conversations, extra packs at $0.65 per conversation, $25 AI usage included.
  - Team: $750/mo, 1,500 conversations, $0.50 per conversation, $150 AI usage included, unlimited seats.
  - Enterprise: custom.
  - "Every conversation includes $0.10 of AI usage."
- **Voiceflow**: four plans exist, with Free and Enterprise named ([billing docs](https://www.voiceflow.com/docs/documentation/account-management/billing.md)). Public pricing is "Request pricing" for businesses and "usage-based billing" for agencies ([pricing](https://www.voiceflow.com/pricing)).
- **Stack AI** ([pricing](https://www.stack-ai.com/pricing)): Free is $0 (500 runs/mo, 2 projects, 1 seat). Enterprise is custom (on-prem, VPC, SSO, HIPAA, BAA).
- **Sim** ([pricing](https://www.sim.ai/pricing)):
  - Free: $0, 1,000 one-time credits, 2 concurrent executions, 30-day logs.
  - Pro: $25 per user/month, 6,000 credits/mo.
  - Max: $100 per user/month, 25,000 credits/mo, sandboxes.
  - Enterprise: custom, with SSO, SOC 2 and self-hosted enterprise features.
- **Langflow**: OSS is free; IBM sells "Elite Support" ([release notes nav](https://docs.langflow.org/release-notes)). No public Langflow Cloud price was found.

### Inferences
- The low-end anchor is about $20 to $50 a month. Enterprise deals are "contact sales" with forward-deployed engineers (CrewAI, Relevance "Invent" as a "forward deployed agent"). A BYOK, deploy-to-your-cloud product could undercut on the markup line items: Gumloop's 8% fee, Botpress AI usage, Dify credits.

### Gaps
- Official Make and Flowise Cloud prices could not be read (Make: Cloudflare challenge; Flowise: a page shell with no prices).
- Voiceflow's paid self-serve tier prices are visible only in-app.

---

## 9. Security incidents and sandboxing of code nodes

### Takeaway
Visual agent builders became a top exploited category in 2025–2026. Langflow has **six CISA KEV entries**: CVE-2025-3248 (ransomware use "Known"), plus five in 2026. n8n has one KEV entry and **21 critical advisories in 2026**. Flowise has 17 critical advisories in 2026 and repeated in-the-wild exploitation. The recurring root causes are code-execution nodes (Python REPL, CSV agent, Code node) and expression engines escaping weak in-process sandboxes (NodeVM, Pyodide validators, n8n's expression sandbox), plus unauthenticated public endpoints.

### Cited Findings
**CISA KEV entries** (catalog version 2026.11.18, [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), JSON feed):
- Langflow CVE-2025-3248, Missing Authentication, added 2025-05-05, ransomware use: **Known**.
- Langflow CVE-2026-33017, Code Injection, added 2026-03-25.
- n8n CVE-2025-68613, Improper Control of Dynamically-Managed Code Resources, added 2026-03-11.
- Langflow CVE-2025-34291, Origin Validation Error, added 2026-05-21.
- Langflow CVE-2026-55255, Authorization Bypass Through User-Controlled Key, added 2026-07-07.
- Langflow CVE-2026-0770, Inclusion of Functionality from Untrusted Control Sphere, added 2026-07-21.
- IBM Langflow CVE-2026-9198, Code Injection, added 2026-08-04.
- No KEV entries for Flowise, Dify, CrewAI, AutoGen, Botpress, Zapier, Make, Gumloop, Lindy, Relevance or Sim as of the same catalog.

**Advisory counts from OSV.dev** (GitHub/PyPA advisories; [OSV](https://osv.dev/)):
- **n8n (npm)**: 156 advisories in total; 2026 has 21 critical, 51 high and 67 moderate. Critical 2026 examples:
  - CVE-2026-25049, expression escape to RCE (2026-02-04).
  - CVE-2026-25115, Python sandbox escape.
  - CVE-2026-27495, "Sandbox Escape in its JavaScript Task Runner".
  - CVE-2026-27493, "Unauthenticated Expression Evaluation via Form Node".
  - CVE-2026-27577, expression sandbox escape.
  - CVE-2026-33660, Merge node AlaSQL RCE.
  - CVE-2026-42231 and CVE-2026-42232, XML prototype pollution to RCE.
  - CVE-2026-44789, HTTP Request pagination prototype pollution to RCE (2026-05-14).
  - The latest batch (2026-09-10) is moderate, including "Git Node… Bypasses Sandbox Path Restriction" ([OSV n8n](https://osv.dev/list?ecosystem=npm&q=n8n)).
  - **(secondary)** CVE-2026-21858 "Ni8mare" is an unauthenticated CVSS 10.0 flaw disclosed January 2026 ([AhnLab ASEC](https://asec.ahnlab.com/en/92019/); [Rapid7](https://careers.rapid7.com/blogs/Rapid7-Blogs/ni8mare-and-n8scape-flaws-among-multiple-critical-vulnerabilities-affecting-n8n)).
- **Flowise (npm)**: 114 advisories; 2025 has 12 critical, and 2026 has 17 critical and 48 high. Examples:
  - CVE-2026-40933, "Authenticated RCE Via MCP Adapters".
  - CVE-2026-46442, NodeVM sandbox escape via custom function.
  - CVE-2026-69253 and CVE-2026-69254, sandbox escapes.
  - CVE-2026-70470, "Pyodide validator Unicode homoglyph bypass leads to RCE".
  - CVE-2026-70478, "Unauthenticated OAuth2 token refresh endpoint returns access tokens".
  - CVE-2026-73483 / CVE-2026-119978, "NodeVM sandbox escape via puppeteer allowlist" (2026-10-07).
  - CVE-2026-73487, prompt injection to RCE via CSV/Airtable agent (2026-10-07) ([OSV flowise](https://osv.dev/list?ecosystem=npm&q=flowise)).
  - **(secondary)** CVE-2025-59528 (CustomMCP node, CVSS 10.0) was exploited from April 6, 2026 per VulnCheck. It was "the third Flowise vulnerability exploited in the wild" after CVE-2025-8943 and CVE-2025-26319, with about 12,000+ exposed instances; the fix is in 3.0.6 ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-flowise-cve-2025-59528-active-exploitation/); [Security Affairs](https://securityaffairs.com/190471/security-attackers-exploit-critical-flowise-flaw-cve-2025-59528-for-remote-code-execution.html)).
- **Langflow (PyPI)**: 84 advisories; 2026 has 13 critical. Examples:
  - CVE-2026-33017, unauthenticated RCE via public flow build endpoint (KEV).
  - CVE-2026-33873, "Authenticated Code Execution in Agentic Assistant Validation".
  - CVE-2026-48519, "Unauthenticated RCE in Shareable Playgrounds".
  - CVE-2026-10561, "PythonREPLComponent executes unsandboxed Python code".
  - CVE-2026-8505, webhook authentication bypass.
  - CVE-2026-9205, "Weak Fernet Key via random.seed()".
  - CVE-2026-105697, "OS command injection (RCE) via arbitrary command in MCP stdio server configuration" (2026-10-07) ([OSV langflow](https://osv.dev/list?ecosystem=PyPI&q=langflow)).
  - **(secondary)** CVE-2026-0768 and CVE-2026-5027 were reported exploited; there were reports of OpenAI and AWS key theft ([BleepingComputer](https://bleepingcomputer.com/news/security/critical-langflow-flaw-exploited-to-steal-openai-and-aws-keys); [The Hacker News](https://thehackernews.com/2026/06/unpatched-langflow-flaw-cve-2026-5027.html)).
- **Dify (secondary)**: the "DifyTap" research (May/June 2026) covers CVE-2026-41947 (tracing authorization bypass, CVSS about 9.1), CVE-2026-41948 (Plugin Daemon path traversal, about 9.3–9.4) and CVE-2026-41949/41950 (cross-tenant file access). The fix is reportedly in 1.14.2, but sources disagree on whether CVE-2026-41948 was patched at disclosure ([SecurityWeek](https://www.securityweek.com/data-exposure-flaws-threaten-dify-ai-platform-powering-over-1-million-apps/); [Security Affairs](https://securityaffairs.com/194081/hacking/difytap-four-bugs-put-over-1-million-ai-apps-at-risk.html)). CVE-2026-61461 is a MyScale SQL injection fixed before 1.16.0-rc1 ([Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2026-61461)).
- **CrewAI, AutoGen Studio**: OSV lists 0 advisories for the `crewai` and `autogenstudio` PyPI packages ([OSV](https://osv.dev/)). AutoGen is archived with no security fixes ([README](https://raw.githubusercontent.com/microsoft/autogen/main/README.md)).
- **Stack AI**: its own docs contain an upgrade plan for "storage-api upgrade (CVE-2026-42043)" ([Stack AI docs index](https://docs.stackai.com/llms.txt)).

**Sandboxing of code nodes**
- **n8n**: Code node runs in "task runners". Hardening guidance: run them in external mode as sidecar containers, use the `-distroless` image and run as `nobody` (UID 65532) ([Harden task runners](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/harden-task-runners.md)). "Run bash scripts" and custom nodes are self-hosted only ([pricing](https://n8n.io/pricing/)).
- **Dify**: Code nodes (Python/JS) "run in secure sandboxes". Network is on by default (`SANDBOX_ENABLE_NETWORK=true`) ([Code node](https://docs.dify.ai/en/self-host/use-dify/nodes/code.md)). The new Agent's isolation is "not intended to provide a hardened security boundary between mutually untrusted users or workloads" ([Dify Agent](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/overview.md)).
- **Flowise**: custom function and tool code runs in NodeVM. Module access is controlled by `TOOL_FUNCTION_BUILTIN_DEP`, `TOOL_FUNCTION_EXTERNAL_DEP` and `ALLOW_BUILTIN_DEP`, and the docs show `TOOL_FUNCTION_BUILTIN_DEP=*` as an option ([env vars](https://docs.flowiseai.com/configuration/environment-variables.md)). Repeated NodeVM escapes are listed above.
- **Langflow**: PythonREPLComponent was "unsandboxed" (CVE-2026-10561, [OSV](https://osv.dev/list?ecosystem=PyPI&q=langflow)). Since 1.13, auth is on by default ([release notes](https://docs.langflow.org/release-notes)).
- **AutoGen Studio**: recommends a "Docker code execution environment", and says it does not implement other security features ([README](https://raw.githubusercontent.com/microsoft/autogen/main/python/packages/autogen-studio/README.md)).
- **Gumloop**: each conversation runs in "its own secure cloud sandbox (an isolated VM)" for Python and shell ([Gumloop sandbox](https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md)).
- **Sim**: "Sandboxes" (dependency environments) need "a configured remote Function runtime" and the Max or Enterprise tier ([Sim docs](https://docs.sim.ai/llms.txt); [pricing](https://www.sim.ai/pricing)).

### Inferences
- In-process JS/Python sandboxes (NodeVM, Pyodide validators, expression evaluators) have failed repeatedly across n8n, Flowise and Langflow. VM or container isolation (Gumloop VMs, n8n external task runners) is the pattern that holds. This supports our planned "sandbox behind a pluggable interface, no credentials inside the sandbox".
- MCP config is a new RCE vector: Flowise CVE-2025-59528 (CustomMCP) and CVE-2026-40933, and Langflow CVE-2026-105697 (MCP stdio command). Letting users or LLM-generated configs specify stdio MCP commands is dangerous.
- Credential theft (stolen OpenAI and AWS keys from Langflow) shows why storing BYOK keys in the builder's DB is risky. Keys should live in the user's cloud secret store.

### Gaps
- CVSS scores for the OSV entries were not extracted per CVE; severity labels are GitHub's.
- No primary advisories were read for Zapier, Make, Lindy, Relevance, Gumloop, Botpress, Voiceflow or Sim; OSV coverage only applies to published packages.
