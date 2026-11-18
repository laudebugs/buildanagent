# Vendor / First-Party Agent SDKs (state as of Nov 2026)

Research note on sources: code.claude.com and github.com pages were fetched directly. The session's network blocked openai.github.io, developers.cloudflare.com, dev.to, temporal.io and visualstudiomagazine.com. The GitHub API (gh) was also blocked, so there are no exact release tags or dates from GitHub. Facts for those vendors come from GitHub README pages and web-search summaries. Search-summary facts are marked "(search summary)" and are less reliable than directly fetched pages. Star counts come from GitHub repo pages fetched on 2026-11-18.

## Q1: Who owns the agent loop, and how extensible is it (custom tools, hooks, context compaction)?

### Takeaway
The Claude Agent SDK is the only one where the vendor's full product harness (the Claude Code binary) owns the loop. You configure it and hook into it, but you do not write it. OpenAI Agents SDK, Google ADK, Microsoft Agent Framework and Strands give you a library-level loop (Runner / Runtime / Agent) inside your own process. Cloudflare Agents is mostly a stateful runtime (Durable Objects) and leaves the LLM loop to you or to helper packages.

### Cited Findings
**Claude Agent SDK (Anthropic)**
- It is "Claude Code as a library". It gives you "the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript" — [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Architecture: `query()` spawns and supervises a `claude` CLI subprocess over stdio. "One agent session maps to one subprocess". The subprocess owns the shell, the working directory and the JSONL transcripts on local disk. Both SDKs bundle a native Claude Code binary pinned to the SDK version — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md); [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Turns run "without yielding control back to your code". Loop controls are `max_turns`, `max_budget_usd` (which covers subagent spend), `effort` (low/medium/high/xhigh/max) and `model`. Result subtypes are `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution` and `error_max_structured_output_retries` — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Built-in tools: Read/Edit/Write, Glob/Grep, Bash, WebSearch/WebFetch, ToolSearch, plus orchestration tools (Agent for subagents, Skill, AskUserQuestion, TaskCreate/TaskUpdate). Custom tools are in-process tool handlers (MCP-style). Read-only tools run in parallel, and custom tools opt into parallel execution with `readOnlyHint` — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Hooks run in your process and do not consume context: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStart/SubagentStop and PreCompact. A PreToolUse hook can block a call. TypeScript has more hook events than Python — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Compaction is automatic near the context limit and emits a `compact_boundary` system message. You can customize it with summary instructions in CLAUDE.md, a PreCompact hook, or a manual `/compact` prompt. You cannot plug in your own compaction algorithm through the documented API (no such option is documented) — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Permissions: `allowed_tools` / `disallowed_tools` with rule syntax such as `Bash(npm *)`, a `canUseTool` callback, and modes `default`, `acceptEdits`, `plan`, `dontAsk`, `auto` (a model classifier reviews actions) and `bypassPermissions` (refused when running as root, and in TypeScript also needs `allowDangerouslySkipPermissions`) — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- It also loads skills, slash commands, CLAUDE.md memory and plugins from `.claude/`, controlled by `settingSources` — [Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Alternatives within Anthropic: the Client SDK (you write the loop, or use the beta "tool runner") and **Managed Agents**, a hosted harness that runs the loop with sessions in an Anthropic cloud sandbox or a self-hosted sandbox — [Overview](https://code.claude.com/docs/en/agent-sdk/overview)

**OpenAI Agents SDK (Python and JS/TS)**
- It describes itself as "a lightweight yet powerful framework for building multi-agent workflows". Primitives: Agents (instructions, tools, guardrails, handoffs), Tools (functions, MCP, hosted tools, agents-as-tools), Handoffs, input/output Guardrails, Sessions (optional Redis), Tracing, human-in-the-loop, Sandbox agents, Realtime and Voice agents. The `Runner` runs the loop in your process — [openai-agents-python](https://github.com/openai/openai-agents-python)
- In April 2026 (OpenAI's announcement is reported as April 15, 2026) it added native sandbox execution and a redesigned "harness" for long-horizon tasks. Sandbox providers reportedly include Modal, Daytona, Docker and E2B. This is described as "separating the harness from the compute" — (search summary) [TechWyse](https://www.techwyse.com/news/ai-search/openai-agents-sdk-sandbox-execution-enterprise-marketing-automation); [Pulse](https://www.pulse.bot/ai/news/openais-agents-sdk-separates-the-harness-from-the-compute-31096239-bf21-4daa-ad91-09f8c3b4c922/); [The New Stack](https://thenewstack.io/openai-agents-sdk-sandboxes/)
- The Python README confirms "Sandbox agents" that work in a container on longer tasks, using `UnixLocalSandboxClient` on macOS/Linux. Windows needs Docker or a hosted client — [openai-agents-python](https://github.com/openai/openai-agents-python)

**Google ADK**
- ADK 2.0 moved "from a hierarchical agent executor to a graph-based execution engine". Agents, tools and functions are nodes in a Workflow graph that supports routing, fan-out/fan-in, loops, retry, state, dynamic nodes, HITL and nested workflows. A Task API handles agent-to-agent delegation — (search summary) [adk-python README via jsDelivr](https://cdn.jsdelivr.net/gh/google/adk-python@main/README.md); [Why we built ADK 2.0](https://developers.googleblog.com/en/why-we-built-adk-20/); [adk-python](https://github.com/google/adk-python)
- Its dev tools are `adk run`, `adk web` (UI) and `adk eval` — [adk-python](https://github.com/google/adk-python)

**Microsoft Agent Framework (MAF)**
- MAF has agents plus graph-based workflows "with type-safe routing, checkpointing, and human-in-the-loop". Human approval is modeled as a content type in the message pipeline. Middleware is also reported. DevUI is a dev/debug sample app, described as beta and not for production — (search summary) [MS Learn overview](https://learn.microsoft.com/en-us/agent-framework/overview/); [Victor Dibia newsletter](https://newsletter.victordibia.com/p/microsoft-agent-framework-semantic)

**AWS Strands Agents**
- Strands is a model-driven loop in your process with lifecycle controls (turn limits, token budgets, cancellation, stop reasons), hooks that "intercept steps to log, validate, or redirect", steering handlers, memory/sessions, context management, multi-agent patterns, streaming and guardrails. A higher-level `create_harness()` / `createHarness()` returns an assembled agent — [strands-agents/sdk-python](https://github.com/strands-agents/sdk-python)

**Cloudflare Agents SDK**
- Its core is `Agent` classes that run as Durable Objects with state, SQL, scheduling, workflows and MCP. The chat/LLM loop comes from `@cloudflare/ai-chat` and `@cloudflare/think` (the "opinionated chat agent base" recommended for new chat projects, with older chat entry points deprecated). `@cloudflare/codemode` has the LLM write TypeScript that runs in an isolated Worker instead of making one tool call at a time — [cloudflare/agents](https://github.com/cloudflare/agents)

### Minimal code shapes
Claude Agent SDK (Python) — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md):
```python
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage
async for m in query(prompt="Fix failing tests in auth",
                     options=ClaudeAgentOptions(allowed_tools=["Read","Edit","Bash","Glob","Grep"],
                                                max_turns=30, effort="high")):
    if isinstance(m, ResultMessage): print(m.subtype, m.result, m.total_cost_usd)
```
TS: `for await (const m of query({ prompt, options: { allowedTools: [...], maxTurns: 30 } }))` from `@anthropic-ai/claude-agent-sdk`.

OpenAI Agents SDK (Python) — [repo](https://github.com/openai/openai-agents-python):
```python
from agents import Agent, Runner
agent = Agent(name="Assistant", instructions="You are a helpful assistant")
print(Runner.run_sync(agent, "Explain a closure in one sentence.").final_output)
```
OpenAI Agents SDK (JS) — [repo](https://github.com/openai/openai-agents-js):
```ts
import { Agent, run } from '@openai/agents';
const agent = new Agent({ name: 'Assistant', instructions: 'You are a helpful assistant.' });
console.log((await run(agent, 'Write a haiku about recursion.')).finalOutput);
```
Google ADK (Python) — [repo](https://github.com/google/adk-python):
```python
from google.adk import Agent
root_agent = Agent(name="greeting_agent", model="gemini-3.5-flash",
                   instruction="You are a helpful assistant. Greet the user warmly.")
# run with: adk run <folder> / adk web
```
Strands (Python) — [repo](https://github.com/strands-agents/sdk-python):
```python
from strands import Agent
from strands.vended_tools import http_request
agent = Agent(tools=[http_request]); agent("Summarize https://...")
```
Cloudflare Agents (TS, stateful agent, not an LLM loop) — [repo](https://github.com/cloudflare/agents):
```ts
export class CounterAgent extends Agent<Env, CounterState> {
  initialState = { count: 0 };
  @callable() increment() { this.setState({ count: this.state.count + 1 }); return this.state.count; }
}
// bound as a Durable Object in wrangler.jsonc with a SQLite migration
```
Microsoft Agent Framework: no code example was fetched (the GitHub repo page returned 404 to the fetcher and Learn pages were not fetched directly). See Gaps.

### Inferences
- The SDKs fall into three ownership tiers. (1) Vendor harness owns the loop: Claude Agent SDK, and Anthropic Managed Agents as the hosted variant. (2) Library loop you embed and compose: OpenAI Agents SDK, ADK, MAF, Strands. (3) Runtime substrate where you bring or choose the loop: Cloudflare Agents.
- Claude Agent SDK gives the most built-in capability (coding tools, compaction, permissions, subagents, skills) with the least code. Its extension points are hooks, custom tools, MCP, system-prompt modification and settings files, not loop rewrites. Teams that need custom compaction or turn scheduling would be working against it.
- OpenAI's April 2026 sandbox/harness update narrows the gap with Claude's coding-agent capabilities while keeping a library-style loop.

### Gaps
- No primary OpenAI docs page was reachable (openai.github.io blocked), so the exact sandbox/harness API names (e.g. `SandboxAgent`, manifests) and the compaction behavior are unverified.
- Whether OpenAI, ADK, MAF or Strands expose pluggable compaction/summarization hooks was not confirmed from primary docs. Strands' README mentions "context management" only in general terms.

## Q2: What is the provider lock-in story?

### Takeaway
Claude Agent SDK is Claude-only, though it can use Anthropic models via Bedrock or Google Cloud, and it is governed by Anthropic's Commercial Terms rather than an OSS license. OpenAI Agents, ADK, MAF and Strands are open source (MIT/Apache) and model-agnostic, each with a "home" provider default. Cloudflare's lock-in is to the Workers/Durable Objects runtime, not to a model.

### Cited Findings
- **Claude Agent SDK**: model calls go to `api.anthropic.com` "or to your provider's regional endpoint when running on Amazon Bedrock or Google Cloud's Agent Platform". `ANTHROPIC_BASE_URL` can route calls through a proxy — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- Claude Agent SDK licensing: "governed by Anthropic's Commercial Terms of Service … except to the extent a specific component or dependency is covered by a different license". Third-party products may not offer claude.ai login or rate limits without approval and must use API keys. Branding rules forbid calling products "Claude Code" — [Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- **OpenAI Agents SDK**: MIT. "Provider-agnostic, supporting the OpenAI Responses and Chat Completions APIs and 100+ other LLMs", with optional `any-llm` and `litellm` extras — [openai-agents-python](https://github.com/openai/openai-agents-python). JS is also MIT and "provider-agnostic" — [openai-agents-js](https://github.com/openai/openai-agents-js)
- Conflicting claim: one third-party comparison says the OpenAI SDK "does not support Claude directly". That conflicts with the official README's provider-agnostic/LiteLLM claim. The likely reading is no first-party Claude adapter, but reachable via LiteLLM/any-llm — (search summary) [composio comparison](https://composio.dev/blog/claude-agents-sdk-vs-openai-agents-sdk-vs-google-adk)
- Hosted tools (OpenAI-hosted web search, file search, etc.) and the tracing dashboard are tied to OpenAI's platform. Tracing is listed as built-in — [openai-agents-python](https://github.com/openai/openai-agents-python)
- **Google ADK**: Apache-2.0. "Optimized for Gemini" and "model-agnostic" — [adk-python](https://github.com/google/adk-python)
- **Microsoft Agent Framework**: MIT (search summary). Providers include Microsoft Foundry, Anthropic, Azure OpenAI, OpenAI, Ollama "and more" — (search summary) [MS Learn overview](https://learn.microsoft.com/en-us/agent-framework/overview/); license per [issoh.co.jp](https://www.issoh.co.jp/tech/details/11675/)
- **Strands**: Apache-2.0. First-class Bedrock, Anthropic, OpenAI and Gemini support plus custom providers. Bedrock is the default in TypeScript — [strands sdk-python](https://github.com/strands-agents/sdk-python)
- **Cloudflare Agents**: MIT. Runs on Durable Objects. The README mentions Workers AI and an OpenAI Agents SDK examples directory. Cloudflare's blog covers using the OpenAI Agents SDK inside Cloudflare Agents — [cloudflare/agents](https://github.com/cloudflare/agents); [Cloudflare blog (not fetched)](https://blog.cloudflare.com/building-agents-with-openai-and-cloudflares-agents-sdk)

### Inferences
- Choosing the Claude Agent SDK is a choice of a model family and harness. Switching models later means rewriting onto another SDK or your own harness. The other SDKs mostly lock in their orchestration abstractions (handoffs, graph workflows) rather than a model.
- Cloudflare Agents can be combined with another SDK: run the OpenAI Agents JS SDK, or your own loop, inside a Durable Object for state and durability.

### Gaps
- Exact Claude Agent SDK support for Azure/Microsoft Foundry was not seen in the fetched pages (only Bedrock and Google Cloud are mentioned).
- MAF's per-provider feature parity (checkpointing and HITL across all providers) comes from a third-party blog and is unverified.

## Q3: How do they handle state, durability, long-running tasks and human-in-the-loop?

### Takeaway
Cloudflare (Durable Objects) and MAF/ADK (checkpointed graph workflows) have durability built into the runtime model. OpenAI relies on Sessions plus external durable-execution integrations (Temporal, Restate, DBOS, Dapr). Claude Agent SDK state is local-disk transcripts in a subprocess, which you make durable with a `SessionStore` mirror, or you use Managed Agents. Every SDK offers some HITL primitive.

### Cited Findings
**Claude Agent SDK**
- Sessions can be resumed or forked by `session_id`. Transcripts, CLAUDE.md and working-directory artifacts live on local disk and "None of them survive a container restart". A `SessionStore` adapter mirrors transcripts only, with best-effort writes that emit `mirror_error` on failure — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- The docs describe four hosting patterns: ephemeral (one container per task), long-running (persistent containers; TS `streamInput()` / `startup()` / `prewarm()`, Python `ClaudeSDKClient`), hybrid (ephemeral plus SessionStore hydration) and multi-agent container. Suggested resources are 1 GiB RAM, 5 GiB disk and 1 CPU per agent as a floor — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- Known limitations: no top-level session timeout, memory growth over long sessions, rate limits on wide parallel subagent fanouts, and no per-subagent wall-clock deadline — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- HITL works through the `canUseTool` callback and permission modes, plus the `AskUserQuestion` tool — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)
- Multi-tenant isolation requires explicit `setting_sources=[]`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR` and `cwd`, and egress proxy rules — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- Sandboxing is your responsibility (Docker, gVisor, Firecracker, or sandbox-as-a-service). Managed Agents provides an Anthropic-hosted sandbox — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)

**OpenAI Agents SDK**
- Sessions hold automatic conversation history, with optional Redis. HITL is built in — [openai-agents-python](https://github.com/openai/openai-agents-python)
- The Temporal integration for Python went to public preview in July 2025 and is reported GA as of March 23, 2026. A Temporal extension for sandbox agents (in OpenAI's repo) runs sandbox agents as durable Temporal workflows and can switch sandbox providers mid-run. Temporal, Restate, DBOS and Dapr are listed as durable integrations, but durability is "not an automatic property of SandboxAgent" — (search summary) [Temporal blog](https://temporal.io/blog/introducing-temporal-and-agentic-sandboxes-openai-agents-sdk); [Temporal docs](https://docs.temporal.io/develop/python/integrations/openai-agents); [agentpedia guide](https://agentpedia.codes/blog/openai-agents-sdk-sandbox-memory-coding-guide)

**Cloudflare Agents**
- Durable Objects are "persistent, stateful execution environments" that "hibernate when idle and wake on demand", run one per user/session/room "millions" at a time, and use built-in SQLite. State syncs to clients (`setState`, React `useAgent`). Scheduling supports one-time, recurring and cron. Workflows give durable multi-step tasks with HITL approval and pause/resume. AI Chat provides message persistence and resumable streaming. Sandboxed code runs in isolated Workers with a virtual FS — [cloudflare/agents](https://github.com/cloudflare/agents)

**Google ADK**
- The 2.0 Workflow runtime covers state management, retry and HITL. Tool confirmation provides HITL. Deployment targets are Docker, Cloud Run (`adk deploy cloud_run`) and Agent Runtime on Gemini Enterprise Agent Platform (formerly Vertex AI Agent Engine) — [adk-python](https://github.com/google/adk-python)
- 2.0 breaking changes affect the agent API, event model and session schema. 2.0 sessions are readable by 1.28+ but not by older 1.x — (search summary) [adk-python README](https://cdn.jsdelivr.net/gh/google/adk-python@main/README.md)

**Microsoft Agent Framework**
- Graph workflows support checkpointing (e.g. to file storage) and resume, HITL approvals and pause/resume for long-running workflows — (search summary) [MS Learn](https://learn.microsoft.com/en-us/agent-framework/overview/); [noqta guide](https://noqta.tn/en/blog/microsoft-agent-framework-1-0-multi-agent-orchestration-guide-2026)

**Strands**
- Strands has memory/sessions and context management. The production deployment guide is linked but was not fetched. AgentCore deployment is not mentioned on the README — [strands sdk-python](https://github.com/strands-agents/sdk-python)

### Inferences
- For multi-day or idle-heavy agents, the patterns rank roughly: Cloudflare DO (native hibernate and wake) > MAF/ADK checkpointed workflows > OpenAI with Temporal > Claude Agent SDK with SessionStore (transcripts only; working-dir artifacts need separate sync). Claude Managed Agents may change this for Anthropic users, but it was not researched here.
- Claude Agent SDK's one-subprocess-per-session model (about 1 GiB each) makes it heavier per concurrent session than the in-process library SDKs. This matters for high-concurrency chat workloads.

### Gaps
- Primary OpenAI docs on HITL (interruptions/approvals API) and session backends were not reachable.
- Strands' AgentCore integration and session-manager backends were not verified.

## Q4: MCP, multi-agent, observability, languages, maturity (cross-cutting facts)

### Takeaway
All six support MCP. Multi-agent styles differ: subagents (Claude), handoffs and agents-as-tools (OpenAI), graph workflows and the Task API with A2A (ADK), graph workflows with A2A (MAF), graph/swarm-style patterns (Strands). All have OTel or built-in tracing. OpenAI and ADK have the largest communities by GitHub stars.

### Cited Findings
- **MCP**: Claude Agent SDK connects MCP servers, defers MCP tool schemas via tool search by default and can bundle MCP in plugins — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md). OpenAI: MCP as a tool type in Python and JS — [py](https://github.com/openai/openai-agents-python), [js](https://github.com/openai/openai-agents-js). ADK: MCP tools — [adk-python](https://github.com/google/adk-python). Cloudflare: agents can be MCP servers or clients (HTTP, SSE, RPC, elicitation) — [cloudflare/agents](https://github.com/cloudflare/agents). Strands: MCP built in — [strands](https://github.com/strands-agents/sdk-python). MAF: MCP and A2A — (search summary) [jasonmoon-dev](https://jasonmoon-dev.pages.dev/blog/2026-04-17-microsoft-agent-framework-1-0-ga)
- **Multi-agent**: Claude uses subagents via the `Agent` tool and `AgentDefinition` with per-subagent tools, effort and maxTurns. A subagent returns only its final response, which keeps parent context lean — [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md). OpenAI uses handoffs plus agents-as-tools — [openai-agents-js](https://github.com/openai/openai-agents-js). A third-party claim says OpenAI handoffs are primarily sequential with no native parallel agent execution (unverified) — (search summary) [fast.io](https://fast.io/resources/claude-agent-sdk-vs-openai-agents-sdk/). ADK's Task API reportedly integrates with A2A for delegating to non-ADK agents — (search summary) [Google dev blog](https://developers.googleblog.com/en/why-we-built-adk-20/)
- **Observability**: Claude Agent SDK exports OTel traces, metrics and logs via env vars (`CLAUDE_CODE_ENABLE_TELEMETRY=1`; traces need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`). Prompts and tool inputs are excluded by default. `ResultMessage` carries `total_cost_usd`, `usage` and `model_usage` — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md); [Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md). OpenAI has built-in tracing and a tracing UI — [openai-agents-python](https://github.com/openai/openai-agents-python). Strands traces each loop decision by default — [strands](https://github.com/strands-agents/sdk-python). ADK has `adk eval` and `adk web` — [adk-python](https://github.com/google/adk-python)
- **Languages**:
  - Claude Agent SDK: Python (3.10+) and TypeScript (Node 18.14+). Other languages can use the CLI via `-p --output-format json` — [Overview](https://code.claude.com/docs/en/agent-sdk/overview); [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
  - OpenAI: Python 3.10+ and JS/TS. JS runs on Node 22+, Deno and Bun, experimentally on Cloudflare Workers (`nodejs_compat`), with browser realtime over WebRTC — [js](https://github.com/openai/openai-agents-js)
  - ADK: Python 3.11+, Java, Kotlin, Go and TypeScript in separate repos — [adk-python](https://github.com/google/adk-python)
  - MAF: .NET and Python — (search summary) [jasonmoon-dev](https://jasonmoon-dev.pages.dev/blog/2026-04-17-microsoft-agent-framework-1-0-ga)
  - Strands: Python 3.10+ and TypeScript (Node 22+, ESM) — [strands](https://github.com/strands-agents/sdk-python)
  - Cloudflare: TypeScript on Workers — [cloudflare/agents](https://github.com/cloudflare/agents)
- **GitHub stars (2026-11-18)**: openai-agents-python about 30.7k (MIT, 2,611 commits, PRs limited to collaborators); openai-agents-js about 4.0k; google/adk-python about 22.3k (Apache-2.0, "roughly bi-weekly" releases); strands-agents/sdk-python about 9.2k (Apache-2.0); cloudflare/agents about 6.0k (MIT). Claude Agent SDK repos and MAF were not retrievable (API blocked; MAF repo page returned 404 to the fetcher) — [openai py](https://github.com/openai/openai-agents-python); [openai js](https://github.com/openai/openai-agents-js); [adk](https://github.com/google/adk-python); [strands](https://github.com/strands-agents/sdk-python); [cloudflare](https://github.com/cloudflare/agents)
- **Maturity and versions**:
  - Claude Agent SDK follows semver, and the docs reference TS v0.3.234+ and Python v0.2.140+ (still 0.x). It was renamed from "Claude Code SDK" and a migration guide exists — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md); [Overview](https://code.claude.com/docs/en/agent-sdk/overview)
  - ADK Python 2.0 alpha shipped in March 2026, GA on May 19, 2026, and Go GA on June 30, 2026. PyPI shows 2.6.x by late 2026 — (search summary) [pypi google-adk 2.6.1](https://pypi.org/project/google-adk/2.6.1/); [ADK 2.0 docs](https://adk.dev/2.0/)
  - MAF 1.0 went GA on April 3, 2026, with LTS on stable APIs, though some preview areas may still break. Semantic Kernel and AutoGen are in maintenance mode (bug and security fixes only) and migration guides exist — (search summary) [Microsoft DevBlog](https://devblogs.microsoft.com/agent-framework/?p=5212); [Visual Studio Magazine](https://visualstudiomagazine.com/articles/2026/04/06/microsoft-ships-production-ready-agent-framework-1-0-for-net-and-python.aspx); [issoh.co.jp](https://www.issoh.co.jp/tech/details/11675/)
  - Cloudflare has several deprecated packages already (`@cloudflare/shell`, `@cloudflare/voice`, older chat entry points), which shows API churn — [cloudflare/agents](https://github.com/cloudflare/agents)

### Inferences
- **Outdated-info flags**: material that describes ADK as `LlmAgent` + Sequential/Parallel/Loop agents describes ADK 1.x. 2.0 uses a graph Workflow runtime. "Semantic Kernel Agents" / AutoGen guidance is superseded by MAF. "Claude Code SDK" is the old name. Pre-April-2026 comparisons that say OpenAI lacks sandboxed execution are outdated.

### Gaps
- No exact latest release tags or dates for any repo (GitHub API blocked).
- MAF GitHub stars and repo details are unverified.

## Q5: What are practitioner comparisons saying (Claude Agent SDK vs OpenAI Agents SDK)?

### Takeaway
Practitioner comparisons frame the choice as "Claude: batteries-included, stateful, computer-access harness you don't own" versus "OpenAI: lightweight orchestration primitives (handoffs/guardrails) you compose, multi-provider". Most such posts are SEO or vendor-adjacent content of uneven quality. The user-suggested dev.to post was unreachable.

### Cited Findings
- One comparison calls Claude Agent SDK a stateful runtime with deep system access and OpenAI Agents SDK a lightweight orchestration primitive for handoffs between specialists. It describes Claude as MCP-native, says Claude forces you to own sandbox integration, and calls Claude's TS story "less mature" — (search summary) [composio](https://composio.dev/blog/claude-agents-sdk-vs-openai-agents-sdk-vs-google-adk); [fast.io](https://fast.io/resources/claude-agent-sdk-vs-openai-agents-sdk/)
- Others say handoffs are first-class in OpenAI while Claude does multi-agent through subagent composition, and that both are production-ready as of mid-2026 — (search summary) [agentpatch](https://agentpatch.pages.dev/blog/openai-agents-sdk-vs-claude-agent-sdk); [morphllm](https://www.morphllm.com/ai-agent-framework)
- Dubious claim to exclude: one page says the Claude SDK "bills per run, not per token". This contradicts the official docs, which report token usage and `total_cost_usd`, and note that token cost dominates container cost by more than an order of magnitude — [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting.md)
- The user-suggested sources [dev.to/jamilxt](https://dev.to/jamilxt/claude-agent-sdk-vs-openai-agents-sdk-who-should-own-the-agent-loop-1p04), [developersdigest](https://www.developersdigest.tech/blog/openai-agents-sdk-vs-claude-agent-sdk) and [symprio](https://www.symprio.com/blog/agent-development-kits-comparison-2026/) were not fetched (dev.to blocked by session network; the other two not attempted due to the tool budget).

### Inferences
- **Build-vs-buy implication**:
  - Claude Agent SDK fits when the agent is coding- or filesystem-shaped and Claude-only is acceptable. You get Claude Code's tuned harness for free, but you accept subprocess hosting, commercial terms and limited loop control.
  - OpenAI Agents SDK, ADK, MAF and Strands are closer to "harness toolkits" you can own and extend. Picking among them mostly tracks your cloud and language (OpenAI/Python+TS, Google/Gemini+multi-lang, Azure/.NET, AWS/Bedrock).
  - Cloudflare is a durability and hosting substrate that pairs with any loop, including a custom one.
- A custom harness is most justified when you need custom compaction, model portability across vendors and full loop control at once. No single vendor SDK provides all three.

### Gaps
- Could not read the "who should own the agent loop" dev.to article the user named. Its specific arguments are not captured.
- No quantitative benchmark (cost, latency, task success) comparing the SDKs was found.
