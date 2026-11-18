# Open-Source, Model-Agnostic Agent Frameworks (as of Nov 2026)

> **Method note / access limits:** WebFetch was blocked for almost every seed URL in this session: futureagi.com, mastra.ai, ianas.fr, resources.rework.com, uvik.net, langfuse.com and splunk.com failed DNS under the session's network allowlist, and reddit.com is unfetchable. GitHub API access through `gh` was also denied, so star counts are not first-hand. Every finding below comes from WebSearch result summaries, which carry the cited URLs. Most of those URLs are secondary blogs or aggregators, and that limits confidence. To verify the seed sources, add these hosts to the network allowlist: futureagi.com, mastra.ai, ianas.fr, resources.rework.com, uvik.net, langfuse.com, splunk.com and github.com API access.

## Comparison matrix (synthesized; see cited findings below for sources)

| Framework | Lang | Control-flow model | Persistence / durability | HITL | Multi-agent | MCP | Type safety | License | Stars (~Nov 2026) |
|---|---|---|---|---|---|---|---|---|---|
| LangGraph (+ LangChain 1.x `create_agent`) | Py, TS | Explicit graph / state machine (nodes, edges, typed state) | Checkpointers, durable execution, time-travel replay | `interrupt()` + `Command(resume=)`; HITL middleware | Yes (subgraphs, supervisor patterns) | Yes (via adapters) | State schemas (TypedDict/Pydantic); moderate | MIT core; Agent Server Elastic-2.0 | ~44.3K |
| Pydantic AI (v2.x) | Py | Typed function/tool loop; optional graph builder | Delegated to durable engines (Temporal, DBOS, Prefect and others; nine listed) | Deferred tools end the run, resumed later via `DeferredToolResults` (non-blocking) | Agent delegation / graphs | Full, including under durable engines | Strongest in Python: typed deps, tool args, outputs validated | MIT | ~21K |
| CrewAI | Py | Role-based Crews (LLM-autonomous) + Flows (deterministic, event-driven) | Flow state; persistence via Flows | Yes (Flows) | Core concept | Yes | Pydantic outputs; moderate | MIT (OSS core) + commercial platform | ~60.4K (most starred) |
| Mastra (1.x) | TS | Agents + graph-ish workflows (`.then/.branch/.parallel`), suspend/resume | Storage-backed workflow state (e.g. PostgresStore); durable execution | `suspend()` / `run.resume()` | Yes | Client **and** server authoring; storage-backed MCP tasks | TS + Zod schemas | Apache-2.0 core + `ee/` source-available | ~29.3K |
| Agno (3.x) | Py | Agent/Team/Workflow; batteries-included runtime (AgentOS) | Built-in storage + memory | Yes | Teams | Yes | Pydantic; moderate | Apache-2.0 | ~43K |
| smolagents | Py | **Code-agent** (CodeAct: LLM writes Python) or JSON ToolCallingAgent | Minimal | Minimal | Managed agents | Yes (tool import) | Low | Apache-2.0 | ~30.2K (release cadence questioned) |
| LlamaIndex Workflows | Py (TS questionable) | Event-driven steps emitting/consuming events | Context serialization | Yes (events) | Yes | Yes | Moderate | MIT | (n/a) |
| Vercel AI SDK (v6 GA Dec 2025; v7 Jun 2026) | TS | Typed tool loop (`ToolLoopAgent`, `stopWhen`, default `stepCountIs(20)`) | App-managed | `needsApproval` per tool (bool or fn of args) | Composition (agents as tools) | Yes (MCP client) | TS + Zod; strong | Apache-2.0 | (n/a) |
| DSPy | Py | Declarative modules/signatures + **optimizers** (ReAct module for agents) | None native | None native | Composition | Limited | Signatures | MIT | ~34.4K (May 2026) |

Rows marked "(n/a)" have no reliable Nov-2026 figure. MCP/multi-agent cells for LangGraph, CrewAI, Agno, LlamaIndex and DSPy rest on common knowledge plus general comparison coverage, not on a specific doc fetched this session. Treat them as "to verify."

## Which frameworks put the developer in control of the flow vs. the LLM?

### Takeaway
The field splits along a control spectrum. **Developer-controlled:** LangGraph graphs, CrewAI *Flows*, Mastra workflows, LlamaIndex Workflows and Pydantic AI graphs/durable runs. **Developer-bounded LLM loops:** Pydantic AI agents, the Vercel AI SDK `ToolLoopAgent`, LangChain `create_agent` and Agno agents. **LLM-controlled:** CrewAI *Crews* (role-based autonomy) and smolagents CodeAgent (the LLM writes the control flow as code). The 2026 consensus pattern is to wrap autonomous parts in deterministic orchestration ("Flows wrap Crews", "workflows contain agents"). DSPy is orthogonal: the developer declares the program and an optimizer tunes the prompts.

### Cited Findings
- LangGraph is typically chosen for control and durability. It supports durable execution that resumes through failures, human-in-the-loop interrupts and checkpointing — [Search summary incl. builder.io / devtoollab / delta4](https://www.builder.io/blog/ai-agent-frameworks); [devtoollab](https://devtoollab.com/blog/best-ai-agent-frameworks)
- One practitioner title frames LangGraph as "Controlled Workflows, Not Autonomous Agents" — [Medium (egrois)](https://medium.com/@egrois/langgraph-controlled-workflows-not-autonomous-agents-37332efa753f)
- LangGraph 1.0 went GA in October 2025 with a promise of no breaking changes until 2.0. Durable execution with checkpointing, persistence, streaming and HITL is "first-class" — [LangChain blog](https://www.langchain.com/blog/langchain-langgraph-1dot0); [LangGraph v1 release notes (Py)](https://docs.langchain.com/oss/python/releases/langgraph-v1)
- LangGraph's `create_react_agent` prebuilt is deprecated in favor of LangChain's `create_agent`. Middleware is the main customization path, and the HITL middleware combines with a checkpointer to pause before sensitive tool calls. Everything that works on a LangGraph graph (checkpointers, `interrupt()`, `Command(resume=...)`, streaming) also works on a `create_agent` agent — [LangGraph v1 release notes](https://docs.langchain.com/oss/python/releases/langgraph-v1); [developersdigest late-2026](https://www.developersdigest.tech/blog/langchain-langgraph-whats-new-2026)
- Versions are reported inconsistently: LangGraph 1.1.0 (Mar 2026) and v1.2 are both cited. A 1.2 deep-dive lists per-node timeouts, error handlers, graceful shutdown and DeltaChannel — [dev.to LangGraph 1.2 deep dive](https://dev.to/x4nent/langgraph-12-deep-dive-per-node-timeouts-error-handlers-graceful-shutdown-deltachannel--2mp2)
- CrewAI: Crews are the autonomous, role-based layer and Flows are the deterministic orchestration layer, with explicit triggers, state you control, conditional branching and parallel paths. "In every production system I have shipped, Flows wrap Crews" — [jahanzaib.ai](https://www.jahanzaib.ai/blog/crewai-flows-production-multi-agent-guide); [reactify-solutions](https://www.reactify-solutions.com/articles/crewai-production-multi-agent-systems-2026)
- Pydantic AI focuses on typed dependencies, tool arguments and outputs. It validates output structure before your code uses it — [search summary, builder.io/devtoollab](https://devtoollab.com/blog/best-ai-agent-frameworks)
- Pydantic AI's graph builder deliberately leaves persistence to the Harness or a durable engine — [developersdigest Pydantic AI V2](https://www.developersdigest.tech/blog/pydantic-ai-whats-new-2026)
- Mastra workflows can pause for human approval or input and continue later. Storage holds the execution state, so a paused run can wait a long time. `resume()` requires the run to still be suspended, and only one resume call can proceed — [Mastra workflows docs](https://mastra.ai/docs/workflows/overview); [Run.resume() reference](https://mastra.ai/reference/workflows/run-methods/resume)
- Vercel AI SDK 6 `ToolLoopAgent` replaced SDK 5's `Experimental_Agent`. It handles the tool-call loop, context management and stopping conditions, with `stopWhen` defaulting to `stepCountIs(20)` — [issoh.co.jp guide](https://www.issoh.co.jp/tech/details/10402/); [AI SDK 6 beta announcement](https://v6.ai-sdk.dev/docs/announcing-ai-sdk-6-beta)
- smolagents has two agent types. `ToolCallingAgent` emits JSON tool calls. `CodeAgent` generates Python with tools exposed as functions, so the LLM authors the control flow. The smolagents docs list CodeAgent's drawback as "less predictable: more prone to unexpected or unsafe outputs" — [smolagents guided tour](https://huggingface.co/docs/smolagents/en/guided_tour)
- The CodeAct paper (cited by a secondary blog) reports up to 20% higher success rates when LLMs express actions as Python code rather than JSON — [themenonlab](https://themenonlab.blog/blog/code-vs-json-llm-tool-calling)
- LlamaIndex Workflows is an event-driven orchestration layer in which agents are steps that emit and consume events. It is strongest for RAG- and data-heavy agents. One page claims the TypeScript package is deprecated (unverified) — [verifier.org](https://verifier.org/llamaindex-workflows-alternatives); [maxpool.dev](https://maxpool.dev/frameworks/)
- DSPy is optimization-first and delivers the most value with a labeled eval dataset. It has no native tool-call logs, which makes debugging harder — [langwatch 2025 guide](https://langwatch.ai/blog/best-ai-agent-frameworks-in-2025-comparing-langgraph-dspy-crewai-agno-and-more); [DSPy paper](https://arxiv.org/pdf/2310.03714)

### Inferences
- The "who controls flow" axis is converging. Every major framework now offers both a deterministic orchestration layer and an autonomous loop: LangGraph (graph + `create_agent`), CrewAI (Flows + Crews), Mastra (workflows + agents) and Pydantic AI (graph + agent). The real differentiator is which layer is primary and how cleanly the two nest.
- Code-agents (smolagents) cede the most control to the LLM and therefore carry the heaviest sandboxing burden.

### Gaps
- Could not fetch the Mastra article on agent architecture (mastra.ai blocked), so its framing of workflows vs. agents is not captured first-hand.
- Agno's Workflow control model and its 2.x→3.x changes are not documented from a primary source here.

## What do 2026 comparison articles and practitioner threads conclude about production survivability?

### Takeaway
The 2026 consensus: **LangGraph** has the deepest production history and the best durability and HITL features, but it is criticized for boilerplate, graph-debugging opacity and state-serialization overhead. **Pydantic AI** is rising as the "typed, testable" Python choice, with durability delegated to real workflow engines (Temporal/DBOS). **Mastra** is the default for TypeScript full-stack work. **CrewAI** is the most starred and fastest to demo, but it is expensive and drifts in production unless wrapped in Flows, and it had 2026 CVEs. **smolagents** is valued for research and prototyping but is less predictable. **DSPy** is a prompt-optimization tool rather than a runtime. Many practitioners say production teams use hand-written loops or thin wrappers. These verdicts come mostly from blogs, not rigorous studies.

### Cited Findings
**Adoption signals**
- Nov 2026 star snapshot (Rework table): LangGraph 44,293; CrewAI 60,395; Pydantic AI 20,990; Agno 43,011; Mastra 29,264; smolagents 30,177 — [Rework (via search)](https://resources.rework.com/tools/ai-agents/best-open-source-ai-agent-frameworks-2026); BetterClaw early-Nov gives similar figures — [BetterClaw](https://www.betterclaw.io/blog/ai-agent-frameworks)
- Trend snapshots: Jul 8 2026 had CrewAI 55,150, Agno 41,053, LangGraph 36,804, Mastra 25,950 and Pydantic AI 18,277. May 2026 had CrewAI 51,380, Agno 40,118, LangGraph 32,027, smolagents 27,302, Mastra 23,871, Pydantic AI 17,055 and DSPy 34,408 — [presenc.ai May 2026 ranking](https://presenc.ai/research/ai-agent-framework-github-rankings-2026); [the-agent-report Jul 2026](https://the-agent-report.com/2026/07/ai-agent-frameworks-comparison-2026-langgraph-crewai-autogen/); [dreaming.press Aug 2026](https://dreaming.press/posts/ai-agent-frameworks-github-ranked-by-stars-2026.html)
- On those snapshots, LangGraph grew fastest in stars, from about 32K in May to about 44K in Nov (+38%). Pydantic AI went from about 17K to about 21K. One aggregator says smolagents has not released since May 29, which suggests the project may be stale — [firecrawl / aggregator summary](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)
- Downloads (inconsistent across sources): about 71.6M PyPI downloads per month for LangGraph and about 20.5M for Pydantic AI, from one Sept 2026 table that also listed LangGraph 1.2.x, Pydantic AI 2.x, Agno 3.x and Mastra 1.x — [search summary, delta4/kernel/rework](https://delta4.io/blog/open-source-ai-agent-frameworks)

**Licensing**
- Pydantic AI is MIT and Agno is Apache-2.0. Mastra's core is Apache-2.0 with `ee/` source-available code. LangGraph's core is MIT, but its Agent Server is Elastic-2.0 — [rework/delta4 summary](https://resources.rework.com/tools/ai-agents/best-open-source-ai-agent-frameworks-2026)

**LangGraph criticisms and counterpoints**
- Debugging: graph execution isn't linear, so simple bugs required tracing several state transitions. This was one team's reason for removing LangGraph — [dev.to "Why We Removed LangGraph"](https://dev.to/nicolaric/why-we-removed-langgraph-from-our-ai-platform-i9o)
- Boilerplate: for simple or linear workflows, defining state schemas, nodes and edges is often unnecessary overhead — [intercode](https://intercode.com/blog/langgraph-alternatives); [Medium (julian.burns50)](https://medium.com/@julian.burns50/langgraph-a-tool-from-the-future-or-a-step-function-to-complexity-2535e73ebf26)
- Runtime: one author measured roughly 40–60ms per step of serialization overhead when large documents sat in state, and fixed it by storing references instead. A forum claim of 40% LangChain overhead has no published methodology — [activewizards](https://activewizards.com/blog/langgraph-vs-direct-api-orchestration-when-the-framework-earns-its-weight/); [Latenode community](https://community.latenode.com/t/what-are-the-current-limitations-of-using-langchain-and-langgraph-frameworks/39038)
- LangChain abstraction cost: one developer spent 3 days on what turned out to be a prompt-formatting issue — [KongchangAI](https://www.kongchang.com/en/articles/does-langchain-really-make-agent-development-easier-a-developer-reflects-on-the-cost-of-abstraction)
- Counterpoint: LangGraph is "unmatched for time-travel debugging and stateful execution replays," and it earns its overhead once durable checkpointing and HITL are needed at scale — [activewizards](https://activewizards.com/blog/langgraph-vs-direct-api-orchestration-when-the-framework-earns-its-weight/)

**CrewAI production verdicts**
- CrewAI's conversational default "makes it feel magical in a demo and expensive in production." The OSS package has no per-run cost tracking by default, and agents drift with non-deterministic outputs unless Flows are used carefully — [orange-its review](https://www.orange-its.ch/en/insights/crewai-review); [joshuaopolko](https://joshuaopolko.com/crewai-setup-production-guide/); [agilesoftlabs](https://www.agilesoftlabs.com/blog/2026/06/crewai-in-production-2026-real-lessons)
- Security: four 2026 CVEs, including CVE-2026-2285 (arbitrary file read, because the JSON loader lacks path validation). All are patched. The pattern to check for is a tool with an undocumented fallback to a less-isolated mode — [Drel security review](https://drel.ai/blog/crewai-security-review)
- Verdicts are split: "production-capable, but reliability still depends on you." Others advise against it for compliance, real-time or complex conditional workflows — [cybernews](https://cybernews.com/ai-tools/crewai-review/); [orange-its](https://www.orange-its.ch/en/insights/crewai-review)

**Pydantic AI production**
- Durable agents preserve progress across API failures, application errors and restarts. The README lists nine durable engines, including Temporal and DBOS, and five are co-maintained with the vendor teams. `TemporalDurability` turns each model and tool call into a durable activity, and MCP communication is offloaded to activities too — [pydantic.dev/pydantic-ai](https://pydantic.dev/pydantic-ai); [Durable Execution docs](https://pydantic.dev/docs/ai/harness/durable-execution/); [Temporal docs](https://pydantic.dev/docs/ai/capabilities/durable_execution/temporal/)
- Deferred tools end the run and a later run picks it up, with results returned as `DeferredToolResults` keyed by tool call ID, so approval does not block a thread. Sources conflict on DBOS behavior in v2: one says DBOS no longer wraps the run for you — [Cadenya](https://cadenya.com/other-content/pydantic-ai-agents-in-production); [pydantic_ai.tools](https://pydantic.dev/docs/ai/api/pydantic-ai/tools/)

**Mastra / TS**
- Mastra gives you more of the stack out of the box (studio, evals, tracing), while LangGraph has deeper production history and finer-grained state control — [search summary, devtoollab/builder.io](https://devtoollab.com/blog/best-ai-agent-frameworks)
- Mastra traces agent calls, tool calls, memory operations and token usage, and exports to external observability platforms. It can author MCP servers that expose agents and tools, and it consumes MCP tools. A release added storage-backed MCP tasks that survive restarts. It offers "Observational Memory" — [GitHub mastra-ai/mastra](https://github.com/mastra-ai/mastra); [releases](https://github.com/mastra-ai/mastra/releases); [MCPServer reference](https://mastra.ai/reference/tools/mcp-server); [Developers Digest](https://www.developersdigest.tech/blog/mastra-durable-typescript-agents)
- Mastra 1.0 covers agents, workflows with PostgresStore, durable execution, observational memory, MCP and deployers (secondary source) — [Cadenya](https://cadenya.com/other-content/mastra-for-ai-agents)
- Vercel AI SDK: `needsApproval` on a tool, as a boolean or a function of the arguments, pauses execution until a human confirms, and the approval state handling moves inside `generateText`/`streamText`. When approvals come from the client, a guide warns you must set `experimental_toolApprovalSecret`, or forged approval messages could trigger tool execution (tested on 6.0.x). SDK 6 went GA on 2025-12-22 and v7 shipped 2026-06-25 — [issoh.co.jp](https://www.issoh.co.jp/tech/details/10402/); [zenn.dev](https://zenn.dev/layerx/articles/5538adfc79b14e); [ai@7 tool-approvals doc on unpkg](https://app.unpkg.com/ai@7.0.14/files/docs/03-agents/06-tool-approvals.mdx)

**smolagents security**
- The default local executor is a rebuilt interpreter rather than plain Python, with imports outside a safe list blocked, but the docs say it is "certainly not watertight, as no local python sandbox can really be." Robust isolation requires E2B, Docker or Blaxel. Sandboxing only the snippets doesn't support multi-agents, and sandboxing the whole system may require passing API keys into the sandbox — [smolagents secure code execution docs](https://huggingface.co/docs/smolagents/main/tutorials/secure_code_execution)

**Agno**
- Agno is batteries-included (memory, storage, API surface). It had a breaking v2 rewrite, and its AgentOS runtime runs in your cloud. Performance claims come from a single unverified comparison site — [AGNT list](https://agnt.gg/articles/agents/best-open-source-ai-agents); [maxpool.dev](https://maxpool.dev/frameworks/)
- Sources describe Agno as suiting "Python agents called by other services" and fast multi-agent work — [delta4](https://delta4.io/blog/open-source-ai-agent-frameworks)

**Newcomers in 2026 (low confidence)**
- An aggregator reports "eve," a Vercel open-source agent framework under Apache-2.0, released June 2026, with about 5,800 stars and over 5M monthly npm downloads. **Unverified, and the figures look implausible;** check before citing — [O'Reilly / firecrawl / awesome-list summary](https://www.oreilly.com/radar/the-open-source-agent-toolkit-in-2026/)
- DeerFlow (ByteDance) is listed as No. 1 on GitHub Trending in Feb 2026 with 25K+ stars (community list) — [awesome-ai-agents-2026](https://github.com/caramaschiHG/awesome-ai-agents-2026)
- Strands Agents (AWS) is an open-source, model-agnostic agent SDK paired with Bedrock AgentCore — [digitalapplied](https://www.digitalapplied.com/blog/open-source-agent-frameworks-5-compared-2026)
- Microsoft Agent Framework (the AutoGen + Semantic Kernel successor) has an unclear GA date: April 2026 vs. "mid-2026." Out of scope; another researcher covers it — [alicelabs](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026)

### Inferences
- Stars track attention, not survivability. CrewAI leads on stars, yet its practitioner reviews are the most cautionary. LangGraph's star growth and the reported download numbers suggest it is still the de facto Python production default.
- "Production-ready" in 2026 effectively means four things: durable or resumable state, non-blocking HITL, built-in tracing via OpenTelemetry or a vendor platform, and a security posture for tools and code execution. Frameworks that delegate durability to proven engines (Pydantic AI → Temporal) are a credible alternative to frameworks that own their own checkpointing (LangGraph, Mastra).

### Gaps
- No rigorous 2026 practitioner survey or benchmark was found. Evidence is anecdotal (Medium, dev.to and vendor blogs selling alternatives).
- Could not read the Reddit r/LangChain comparison thread, the Langfuse comparison, futureagi, Splunk or ianas.fr (all blocked), so their conclusions are not captured.
- No first-hand Nov 2026 star counts (GitHub API denied), and no reliable download figures beyond one table.
- I found no specifics on observability integrations per framework, such as which ones emit OpenTelemetry GenAI semconv natively, beyond Mastra's tracing and LangGraph's (implicit) LangSmith link.

## What design ideas from these frameworks are worth borrowing for a custom SDK? (Plus the "no-framework" argument)

### Takeaway
Many 2026 practitioners argue for a hand-written loop or thin wrapper. They then borrow specific primitives from the frameworks:
- checkpointed state with interrupt/resume (LangGraph, Mastra)
- non-blocking deferred tools for HITL (Pydantic AI)
- per-tool `needsApproval` predicates (AI SDK)
- explicit stop conditions (AI SDK `stopWhen`)
- delegation to an external durable-execution engine (Pydantic AI + Temporal)
- typed deps/outputs (Pydantic AI)
- deterministic orchestration wrapping autonomous sub-agents (CrewAI Flows)
- MCP as both client and server (Mastra)
- an optional code-action mode behind a real sandbox (smolagents)
- eval-driven prompt optimization (DSPy)

### Cited Findings
**No-framework arguments**
- An agent is "an LLM in a loop that can call tools." The hard parts are stop conditions, tool-error handling, memory across steps and preventing infinite loops — [ai-tldr.dev](https://ai-tldr.dev/learn/agent-frameworks/choosing-a-framework/agent-without-framework/); [dev.to 300-line agent](https://dev.to/iamthedev/building-an-ai-agent-from-scratch-300-lines-one-loop-no-framework-4b26)
- One guide claims most companies running production agents use hand-written loops or thin wrappers, not frameworks. This is a vendor blog, so treat it as directional — [apiscout.dev](https://apiscout.dev/guides/building-ai-agent-architecture-patterns-2026)
- Vendor SDKs (OpenAI Agents SDK, Claude Agent SDK) are themselves deliberately thin wrappers over the raw API loop — [theaiengineer substack](https://theaiengineer.substack.com/p/the-ai-agents-stack-2026-edition)
- The cost of going framework-free is building context windowing, error handling, token counting, retry logic and observability yourself. Suggested rule: hand-build until the product works, then adopt a framework only if a specific feature pays for its weight — [ai-tldr.dev](https://ai-tldr.dev/learn/agent-frameworks/choosing-a-framework/agent-without-framework/)
- "Framework choice is an implementation detail; the loop contract is framework agnostic." Stop conditions, verification and state persistence still need design — [88labs](https://88labs.ai/learn/designing-loops-that-prompt-your-agents-2026); [topgenaijobs loop engineering](https://www.topgenaijobs.com/blog/loop-engineering-ai-agents)
- Team experience: removing LangGraph simplified debugging because execution became linear again — [dev.to](https://dev.to/nicolaric/why-we-removed-langgraph-from-our-ai-platform-i9o)

**Borrowable primitives (with source)**
1. **Checkpointer interface + interrupt/resume tokens.** LangGraph's `interrupt()` / `Command(resume=)`, and Mastra's suspend/`resume()` with a single-resume guarantee — [LangGraph v1](https://docs.langchain.com/oss/python/releases/langgraph-v1); [Mastra Run.resume()](https://mastra.ai/reference/workflows/run-methods/resume)
2. **Middleware/hooks around the model and tool calls.** LangChain 1.0 makes middleware the main extension point, and HITL is implemented as middleware — [LangGraph v1](https://docs.langchain.com/oss/python/releases/langgraph-v1)
3. **Deferred tools / non-blocking HITL.** The run ends and resumes with results keyed by tool-call ID, so no process waits — [pydantic_ai.tools](https://pydantic.dev/docs/ai/api/pydantic-ai/tools/); [Cadenya](https://cadenya.com/other-content/pydantic-ai-agents-in-production)
4. **Per-tool approval predicates.** `needsApproval: boolean | (args) => boolean`. Cryptographically bind client approvals to the call; the AI SDK learned this the hard way with `experimental_toolApprovalSecret` — [issoh.co.jp](https://www.issoh.co.jp/tech/details/10402/)
5. **Composable stop conditions.** `stopWhen` with a sane default step cap (20) — [issoh.co.jp](https://www.issoh.co.jp/tech/details/10402/)
6. **Pluggable durable-execution adapters.** Treat each model and tool call as an activity (Temporal/DBOS/Prefect) instead of owning a bespoke checkpoint store — [Pydantic AI durable execution](https://pydantic.dev/docs/ai/harness/durable-execution/)
7. **Typed dependency injection + validated outputs.** Typed deps, tool args and output validation, as in Pydantic AI — [devtoollab](https://devtoollab.com/blog/best-ai-agent-frameworks)
8. **Two-layer orchestration.** Keep a deterministic outer flow and autonomous inner agents ("Flows wrap Crews") — [jahanzaib.ai](https://www.jahanzaib.ai/blog/crewai-flows-production-multi-agent-guide)
9. **MCP as both client and server.** Expose your agents as MCP servers, and make MCP tasks storage-backed so they survive restarts — [Mastra MCPServer](https://mastra.ai/reference/tools/mcp-server); [Mastra releases](https://github.com/mastra-ai/mastra/releases)
10. **Optional code-action mode.** Ship it only with a remote sandbox (E2B/Docker), an import allowlist and no credentials inside the sandbox — [smolagents secure execution](https://huggingface.co/docs/smolagents/main/tutorials/secure_code_execution)
11. **State by reference, not by value.** Keep large documents out of serialized state to avoid per-step overhead — [activewizards](https://activewizards.com/blog/langgraph-vs-direct-api-orchestration-when-the-framework-earns-its-weight/)
12. **Built-in tracing of model calls, tool calls, memory ops and tokens, plus per-run cost accounting.** CrewAI OSS is criticized for lacking per-run cost tracking — [Mastra GitHub](https://github.com/mastra-ai/mastra); [joshuaopolko](https://joshuaopolko.com/crewai-setup-production-guide/)
13. **Time-travel / replay debugging from checkpoints.** This is LangGraph's most-praised feature — [activewizards](https://activewizards.com/blog/langgraph-vs-direct-api-orchestration-when-the-framework-earns-its-weight/)
14. **Eval-driven prompt optimization (DSPy signatures + optimizers).** Offer it as an offline layer, not part of the runtime — [DSPy paper](https://arxiv.org/pdf/2310.03714)

### Inferences
- The best custom-SDK shape implied by the evidence is a linear, debuggable core loop, which avoids LangGraph's graph-debugging complaints, with these pieces added:
  - a pluggable checkpoint/durability adapter
  - non-blocking HITL via deferred tool results
  - middleware hooks
  - typed tools and outputs
  - OpenTelemetry tracing with cost accounting

  Graph or workflow orchestration should be an optional outer layer, not the core abstraction.
- Two security lessons argue for secure-by-default tool approval and sandboxing: the CrewAI CVEs (less-isolated fallback modes) and the AI SDK approval-forgery caveat.

### Gaps
- Could not retrieve Anthropic's "Building effective agents" post or HumanLayer's "12-factor agents" directly, though both are canonical sources for the no-framework argument. They should be cited from another researcher's notes or fetched once the network allows.
- No quantitative data on how many production teams use frameworks vs. custom loops, beyond one vendor claim.
