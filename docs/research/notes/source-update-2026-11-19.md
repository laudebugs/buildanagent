# Source update notes: fourteen sources read against the main report (2026-11-19)

Working notes for [the source update report](../source-update-2026-11-19.md). Each entry gives what the source says that bears on our design, with quotes, its quality, and whether it confirms, extends or contradicts [the main report](../agent-sdks-and-harness-design.md). Where a secondary source cited a primary one, I fetched the primary and recorded it under "Primary sources followed".

The owner chose the fourteen URLs. Ten are seeds that the [custom-harness notes](custom-harness-architecture.md) list as unfetched (scope note and Gaps). An eleventh, Anthropic's MCP launch post, is a seed those notes cite as "not re-fetched." Mastra and Langfuse sit on seed hosts that the [frameworks notes](oss-frameworks.md) record as blocked, although those notes name the hosts and not the URLs. The SWE-bench docs are new. All fourteen were fetched on 2026-11-19 (UTC) with plain `curl` and no login, and each returned HTTP 200 ([fetch log](#fetch-log)). Fetched pages were treated as data, and nothing in them was followed as an instruction.

This round leaves other seeds unread, because the owner chose these fourteen. From the custom-harness notes: aiagent.org (line 42), six planning blogs (safeguard.sh, nomadx.ae, aiagentslist, masterdexter, taskade and GitHub huangjia2019; line 116) and gotburnout.io (line 136). From the frameworks notes' method note: futureagi.com, ianas.fr, resources.rework.com, uvik.net, splunk.com and reddit.com.

Quality scale: **primary** (spec, official docs, the paper itself), **vendor** (a company writing about its own product or market), **secondary** (encyclopedia, explainer or survey that relays other sources).

## Fetch log

Every fetch used `curl -sL` with a generic browser user agent, on 2026-11-19 (UTC). "Final URL" appears only where a redirect changed it.

| # | URL | HTTP | Final URL |
| --- | --- | --- | --- |
| 1 | <https://mastra.ai/articles/ai-agent-architecture> | 200 | |
| 2 | <https://langfuse.com/blog/2025-03-19-ai-agent-comparison> | 200 | |
| 3 | <https://www.swebench.com/SWE-bench/> | 200 | |
| 4 | <https://www.anthropic.com/news/model-context-protocol> | 200 | |
| 5 | <https://en.wikipedia.org/wiki/Model_Context_Protocol> | 200 | |
| 6 | <https://cloud.google.com/discover/what-is-model-context-protocol> | 200 | |
| 7 | <https://arxiv.org/html/2503.12687v1> | 200 | |
| 8 | <https://www.ibm.com/think/topics/agentic-architecture> | 200 | |
| 9 | <https://www.ibm.com/think/topics/model-context-protocol> | 200 | |
| 10 | <https://www.philschmid.de/mcp-introduction> | 200 | |
| 11 | <https://parallel.ai/articles/what-is-an-ai-agent> | 200 | |
| 12 | <https://atlan.com/know/ai-agent/ai-agent-architecture-explained/> | 200 | |
| 13 | <https://mem0.ai/library/agent-memory/what-is-ai-agent-memory> | 200 | |
| 14 | <https://www.freecodecamp.org/news/ai-agent-engineers-guide-60-patterns-for-building-autonomous-systems-book/> | 200 | |
| P1 | <https://modelcontextprotocol.io/specification/2026-07-28/changelog> | 200 | |
| P2 | <https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices> | 200 | <https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices> |
| P3 | <https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation> | 200 | |
| P4 | <https://arxiv.org/abs/2407.01502> | 200 | |
| P5 | <https://arxiv.org/abs/2412.14161> and <https://arxiv.org/abs/2412.14161v1> | 200, 200 | |
| P6 | <https://arxiv.org/abs/2512.04123> | 200 | |
| P7 | <https://arxiv.org/abs/2511.14136> | 200 | |
| P8 | CrewAI `README.md` on `main` and at commit `a143512` (raw.githubusercontent.com) | 200, 200 | Byte-identical |
| — | `https://arxiv.org/a/pan_m_1` (a guessed author page) | 404 | Not used; MAP was found through Atlan's link instead |

## Sources the owner added beyond the custom-harness seeds

Sources 1 and 2 sit on seed hosts the frameworks round could not reach, source 4 is a custom-harness seed that was never re-fetched, and source 3 is new.

### 1. Mastra, "AI Agent Architecture" (vendor)

URL: <https://mastra.ai/articles/ai-agent-architecture>, published 2026-08-17 (page metadata), by Mastra's head of demand generation and its CEO.

- Iteration caps: "Set an iteration limit on every loop. An agent that never stops is not autonomous, it is a bug with a token bill."
- Complexity ladder: "Use the lowest level that reliably meets your requirements … Most enterprise use cases stop at a single agent with tools."
- Human-in-the-loop: "Persist state at every gate so the workflow can resume without replaying prior work. You can scope gates to specific high-risk tool calls rather than entire agent outputs."
- Policy layer: "Governance rules, permissions, approval gates, and access policies belong in a distinct layer, not tangled into agent prompts or tool code."
- Evals: "use scoring rubrics or LLM-as-judge evaluations against a dataset rather than exact-match assertions."
- Product claims: Mastra is "open-source … (Apache 2.0)" and its model router "reaches 90+ providers" (as of the page date, 2026-08-17).
- Cites a Gartner prediction (40% of enterprises will demote or decommission autonomous agents by 2027) without a link to the primary. Not checked.

Verdict: **confirms** the loop, stop conditions and permission gate in [layer 2 and the staged path](../agent-sdks-and-harness-design.md#build-vs-buy-depends-on-three-questions), and the separate approval policy in [sandboxing](../agent-sdks-and-harness-design.md#sandboxing-needs-two-boundaries-and-no-secrets-inside). It adds no evidence, because every claim is advice without measurement.

### 2. Langfuse, "Comparing Open-Source AI Agent Frameworks" (vendor)

URL: <https://langfuse.com/blog/2025-03-19-ai-agent-comparison>. The URL dates from March 2025, but the text says it covers frameworks "as of July 2026."

- Same picks as our tier table: "Strands Agents, the OpenAI Agents SDK, the Claude Agent SDK, Google ADK, and Microsoft Agent Framework are the natural picks if you are committed to the AWS, OpenAI, Anthropic, Google, or Microsoft ecosystems respectively."
- Claude Agent SDK: "Instead of writing your own agent loop, you get a production-tested one: the SDK bundles the Claude Code runtime."
- AutoGen: "in maintenance mode … 'will not receive new features or enhancements and is community managed going forward'" (verified by Langfuse in July 2026).
- Vercel AI SDK 7: "ships three agent abstractions: ToolLoopAgent …, HarnessAgent runs preconfigured harnesses such as Claude Code or Codex …, and WorkflowAgent makes each tool execution a durable, automatically retried step."
- Mastra: "unified model routing across more than 40 providers" (as of July 2026; Mastra's own article of 2026-08-17 says 90+).
- CrewAI "is a standalone framework (it is not built on LangChain)."
- Build-or-adopt: "A single-model tool loop can be written in under a hundred lines with a provider SDK … Frameworks earn their place when you need durable state, retries, multi-agent delegation, human-in-the-loop steps, and consistent tracing."

Verdict: **confirms** [the three tiers](../agent-sdks-and-harness-design.md#vendor-sdks-split-into-three-tiers-of-loop-ownership) and [the framework steelman](../agent-sdks-and-harness-design.md#open-source-frameworks-are-better-quarries-than-foundations). Its AutoGen status is older than ours: the main report, checked against the AutoGen README in R1, says AutoGen is archived as of November 2026. The HarnessAgent and WorkflowAgent claims are unchecked here; our [Vercel AI SDK reference](../../reference/vercel-ai-sdk/) is the place to check them.

### 3. SWE-bench documentation, overview page (primary)

URL: <https://www.swebench.com/SWE-bench/>, the benchmark's own docs site.

- "Given a codebase and an issue, a language model is tasked with generating a patch that resolves the described problem."
- "Docker-based evaluation harness for consistent results"; "[Aug. 13, 2024]: SWE-bench Verified release with 500 engineer-confirmed solvable problems."
- Latest news item is dated Jan. 13, 2025. The page says nothing about task flaws or OpenAI's audit.

Verdict: **confirms** the Verified subset's size and its containerized harness, which [observability and evals](../agent-sdks-and-harness-design.md#observability-and-evals-close-the-loop) relies on. It does **not** close the open item on OpenAI's audit of 138 tasks, which stays ⚠️.

### 4. Anthropic, "Introducing the Model Context Protocol" (primary)

URL: <https://www.anthropic.com/news/model-context-protocol>, published Nov 25, 2024.

- "developers can either expose their data through MCP servers or build AI applications (MCP clients) that connect to these servers."
- Launch components: "The Model Context Protocol specification and SDKs; Local MCP server support in the Claude Desktop apps; An open-source repository of MCP servers."
- "MCP was created at Anthropic by David Soria Parra and Justin Spahr-Summers."

Verdict: **confirms** the origin and client/server split that [tools and MCP](../agent-sdks-and-harness-design.md#tools-and-context-deserve-more-effort-than-the-prompt) assumes. It describes the 2024 launch only, so it says nothing about the 2026-07-28 revision.

## Seeds the custom-harness notes list as unfetched

### 5. Wikipedia, "Model Context Protocol" (secondary)

URL: <https://en.wikipedia.org/wiki/Model_Context_Protocol>, revision 1386480394, last edited 18 November 2026.

- Governance: "In December 2025, Anthropic donated MCP to the Agentic AI Foundation (AAIF), a directed fund under the Linux Foundation, co-founded by Anthropic, Block and OpenAI."
- 2026-07-28 revision: it "removes protocol-level session tracking … information about protocol version, client identity, and capabilities is instead carried in a _meta parameter with each request."
- Deprecations: "deprecated several features that had seen limited use, including sampling … and roots …; deprecated features remain functional for a minimum of twelve months." Tasks moved "into optional extensions."
- Security: tool poisoning (Invariant Labs, April 2025); CVE-2025-6514 in `mcp-remote` (CVSS 9.6, fixed in 0.1.16); CVE-2025-49596 in MCP Inspector; the spec "states that token passthrough is forbidden"; an NSA report (May 2026) said MCP's "rapid proliferation has outpaced the development of its security model."

Verdict: **extends** [the MCP paragraph](../agent-sdks-and-harness-design.md#tools-and-context-deserve-more-effort-than-the-prompt), which lists the removed handshake and sessions but omits the deprecations. I checked the deprecations, the twelve-month window, the AAIF donation and the passthrough ban against primaries (below), and all four hold. The CVE details and the NSA quote stay ⚠️: I did not fetch JFrog, the CVE records or the NSA PDF.

### 6. Google Cloud, "What is Model Context Protocol (MCP)?" (vendor)

URL: <https://cloud.google.com/discover/what-is-model-context-protocol>, undated.

- Transport: "Standard input/output (stdio) … Server-sent events (SSE): Preferred for remote resources."
- Security advice: "Developers should not trust tool descriptions unless they come from a reliable server. Users should give permission before any tool is used."
- Hosting: Cloud Run "ideal for simple, stateless tools"; GKE "for complex, stateful applications."

Verdict: **contradicts the current spec**, not our report. HTTP+SSE has been deprecated since protocol version 2025-03-26, and 2026-07-28 classes it Deprecated (changelog, SEP-2596). The security advice **confirms** our rule that tool annotations are untrusted. Do not cite this page for protocol mechanics.

### 7. Krishnan, "AI Agents: Evolution, Architecture, and Real-World Applications" (secondary)

URL: <https://arxiv.org/html/2503.12687v1>, arXiv:2503.12687v1 [cs.AI], 16 Mar 2025, one author, no peer-review venue listed.

- A survey. Its evaluation section relays Kapoor et al. (2024): "there is a narrow focus on accuracy without attention to other metrics … SOTA agents [that] are needlessly complex and costly."
- §4.2 proposes a four-dimension framework (capability, efficiency, robustness, deployment readiness) and calls it "a significant advancement over current practices," with no experiment behind it.

Verdict: **confirms** cost beside pass rate in [observability and evals](../agent-sdks-and-harness-design.md#observability-and-evals-close-the-loop), but only by relaying Kapoor et al. I cited the Kapoor abstract instead (below). The survey adds nothing primary.

### 8. IBM, "What is agentic architecture?" (vendor)

URL: <https://www.ibm.com/think/topics/agentic-architecture>, published 2025-01-08, modified 2026-11-05.

- Single agent: "Easier to design, develop and deploy … Limited scalability: A single agent can become a bottleneck."
- Taxonomy: vertical, horizontal and hybrid multi-agent shapes; reactive, deliberative, cognitive and BDI architectures.
- "crewAI, a Python-based multi-agent framework that operates on top of LangChain."

Verdict: **confirms** that a single agent is simpler and cheaper to run, which the [planning](../agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent) section relies on, with no data. It names no loop limits or human checkpoints. Its CrewAI claim is **wrong**: the CrewAI README answers "Is CrewAI a standalone framework?" with "Yes … with its own primitives." Our report makes no claim about CrewAI's base, so nothing in it changes.

### 9. IBM, "What is Model Context Protocol (MCP)?" (vendor)

URL: <https://www.ibm.com/think/topics/model-context-protocol>, published 2025-05-09, modified 2026-11-05.

- "MCP is not an agent framework, but a standardized integration layer for agents accessing tools … MCP does not decide when a tool is called and for what purpose."
- "Clients serve as the session manager by handling interruptions, timeouts, reconnections and session closures."
- Transport: stdio, and "server-sent events (SSE) which works best for integrating remote resources."

Verdict: the first point **confirms** our design, where MCP is a removable extension of the tool registry and the harness owns the loop ([layer 4](../agent-sdks-and-harness-design.md#a-reference-architecture-in-eight-swappable-layers)). The session and SSE points **contradict the current spec**: 2026-07-28 removed protocol-level sessions (SEP-2567). The page was modified on 2026-11-05 without changing them.

### 10. Phil Schmid, "Model Context Protocol (MCP) an overview" (secondary)

URL: <https://www.philschmid.de/mcp-introduction>, published 2025-04-03.

- Frames MCP as turning an "M×N problem" into an "M+N problem."
- Primitives: "Tools (Model-controlled) … Resources (Application-controlled) … Prompts (User-controlled)."
- Flow: "Initialization: When a Host application starts it creates N MCP Clients, which exchange information about capabilities and protocol versions via a handshake."
- 2025-03-26 changes: OAuth 2.1, Streamable HTTP replacing HTTP+SSE, and tool annotations "(e.g., read-only vs. destructive)."

Verdict: a clear introduction that is **stale** on the handshake, which 2026-07-28 removed (SEP-2575). Its primitives split still matches the spec. It adds nothing our report lacks.

### 11. Parallel, "What is an AI agent?" (vendor)

URL: <https://parallel.ai/articles/what-is-an-ai-agent>, published 2025-11-12, modified 2026-11-15. Parallel sells a web-retrieval API.

- Loop: ReAct "interleaves thought processes with actions rather than planning everything upfront."
- Runaway loops: an agent "might continue searching indefinitely without proper termination conditions. Implementing timeouts, iteration limits, and progress monitoring prevents runaway execution."
- Practice: "Start with comprehensive activity logging … Implement human-in-the-loop controls for high-stakes decisions."

Verdict: **confirms** ReAct-first ([planning](../agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent)) and explicit stop conditions (layer 2), as advice only. Its retrieval-layer sections promote its own product.

### 12. Atlan, "AI Agent Architecture Explained" (vendor)

URL: <https://atlan.com/know/ai-agent/ai-agent-architecture-explained/>, published 2026-05-15, modified 2026-09-21. Atlan sells a data catalog, and the article's "missing layer" is that product.

- Cites Pan et al., "Measuring Agents in Production": reliability "is the top development challenge … practitioners address it through systems-level design rather than better models."
- Compounding error: "90% accuracy at each of ten steps leaves you at 35% end to end" (0.9¹⁰ ≈ 0.349, so the arithmetic holds).
- Cites TheAgentCompany: "the best agent it tested completed 24% of them outright, 34.4% with partial credit." Elsewhere the page says "Carnegie Mellon benchmarks in 2025 showed leading agents completing only 30 to 35% of multi-step tasks." Its source list names only TheAgentCompany for Carnegie Mellon, and that entry links a Carnegie Mellon news page (<https://www.cs.cmu.edu/news/2025/agent-company>), not the paper. I did not read the news page.
- Cites Menlo Ventures: "only 16% of enterprise AI deployments qualify as true agents." Not checked.

Verdict: the page is marketing, but it led to two primary sources. Pan et al. **confirms** our step caps and human gates (below). Its 24% figure is **version drift**: it is the v1 abstract's figure (Dec 2024), and the current v3 abstract says 30%. That the "30 to 35%" figure tracks a later version is my inference, because the page cites a news page rather than a paper version.

### 13. Mem0, "What is AI agent memory?" (vendor)

URL: <https://mem0.ai/library/agent-memory/what-is-ai-agent-memory>, undated.

- Taxonomy: context window as working memory, short-term (session) and long-term (cross-session) memory, vector stores, and graph memory for "structured relationships and multi-hop reasoning."
- Describes, without naming them, a "Memory Stream" with "Reflections" (the Generative Agents design) and an "LLM … as an Operating System" that edits its own memory through function calls (the MemGPT design).
- Pitch: "If you're building an AI agent in 2026, it's highly likely you'd need an AI memory layer to integrate personalization."

Verdict: **confirms** the main report's rule to buy a memory service only for cross-user personalization ([planning](../agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent), last paragraph), since Mem0's own use cases are all personalization. Its claim that most agents need a memory layer is a sales pitch with no evidence, and it **contradicts** our files-first layer 6 only as opinion.

### 14. freeCodeCamp, "The AI Agent Engineer's Guide: 60 Patterns" (secondary)

URL: <https://www.freecodecamp.org/news/ai-agent-engineers-guide-60-patterns-for-building-autonomous-systems-book/>, published 2026-08-20; a book of about 120,000 words.

- The book flags its own numbers: "The case studies attached to each pattern are illustrative composites, not specific deployments … read specific numbers … as plausible illustrative values, not as audited claims."
- Cost, chapter 4B: "a fully-stacked agent … easily runs 50–100× the cost of a single model call," and "The right design move is to set the ceiling first, then choose patterns from a budget." It puts the reflection knee "at 1–2 rounds. Three or more rounds often degrade."
- Chapter 12A lists real failures it calls verifiable: Moffatt v. Air Canada (2024 BCCRT 149), the NYC MyCity chatbot, Mata v. Avianca, and the 2025 Replit Agent production-database deletion.

Verdict: **confirms** our cost-beside-pass-rate rule and the [planning](../agent-sdks-and-harness-design.md#planning-should-start-as-react-and-earn-every-extra-agent) section's view that reflection costs multiples of ReAct. By the book's own warning its multipliers are illustrative, so they cannot replace the ⚠️ "about 3x" figure. The Replit incident supports our rule that destructive actions need a gate outside the model; I did not check it against a primary account.

## Primary sources followed from the secondary ones

| Primary | What it says | Bears on |
| --- | --- | --- |
| [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | Deprecates "the Roots, Sampling, and Logging features (SEP-2577)," with migrations: "pass directories or files via tool parameters … integrate directly with LLM provider APIs instead of Sampling; log to stderr (stdio) or use OpenTelemetry." Adopts a policy with "a minimum twelve-month deprecation window" (SEP-2596). Introduces Multi Round-Trip Requests, which replace server-initiated `roots/list`, `sampling/createMessage` and `elicitation/create`: servers return `resultType: "input_required"` and clients retry with `inputResponses` (SEP-2322). Removes `ping` and `logging/setLevel`; log level is now "set per-request via io.modelcontextprotocol/logLevel in _meta," and servers "MUST NOT emit notifications/message for requests that did not include this field" (SEP-2575). Removes SSE resumability, so "clients MUST re-issue" a broken request with a new ID (SEP-2575). Requires `ttlMs` and `cacheScope` on list results (SEP-2549), asks servers to return `tools/list` "in a deterministic order to … improve LLM prompt cache hit rates," and documents `traceparent` in `_meta` (SEP-414) | Main report's MCP paragraph; harness todos N24, N25, B17 |
| [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) (2026-07-28) | "Token passthrough is explicitly forbidden"; "MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server"; proxy servers "MUST implement per-client consent" against confused-deputy attacks | Confirms Wikipedia; already covered by the [connectors report](../connectors/agent-connectors.md) |
| [Anthropic, donating MCP to the AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation), Dec 9, 2025 | AAIF is "a directed fund under the Linux Foundation, co-founded by Anthropic, Block and OpenAI"; "more than 10,000 active public MCP servers"; "97M+ monthly SDK downloads" | Governance of the protocol our MCP client targets |
| [Kapoor et al., "AI Agents That Matter"](https://arxiv.org/abs/2407.01502) | "a narrow focus on accuracy without attention to other metrics. As a result, SOTA agents are needlessly complex and costly"; "many agent benchmarks have inadequate holdout sets, and sometimes none at all" | Cost beside pass rate; own-task suites |
| [Pan et al., "Measuring Agents in Production" (MAP)](https://arxiv.org/abs/2512.04123), v4, ICML 2026 oral | 20 case studies and 86 surveyed practitioners across 26 domains: "68% execute at most 10 steps before human intervention, 70% rely on prompting off-the-shelf models instead of weight tuning, and 74% depend primarily on human evaluation." Reliability "remains the top development challenge, which practitioners currently address through systems-level design" | Step caps, human gates, harness-over-model thesis |
| [Mehta, "Beyond Accuracy" (CLEAR)](https://arxiv.org/abs/2511.14136), v1, one author | "agent performance drops from 60% (single run) to 25% (8-run consistency)"; "50x cost variations for similar precision"; accuracy-only optimization "yields agents 4.4-10.8x more expensive than cost-aware alternatives with comparable performance" | pass^k and cost on every change |
| [TheAgentCompany](https://arxiv.org/abs/2412.14161), v1 and v3 | v1 (18 Dec 2024): "24% of the tasks can be completed autonomously"; v3 (10 Sep 2025): "the most competitive agent can complete 30% of tasks autonomously" | Version drift; Atlan's 24% is the v1 figure |
| [CrewAI README](https://github.com/crewAIInc/crewAI/blob/a1435129057cb9aee5ead3f1272d25d3c84497b5/README.md) (commit `a143512`, the tip of `main` when fetched on 2026-11-19) | "CrewAI is a standalone Python framework with its own primitives for agents, tasks, crews, flows, tools, and orchestration" | Refutes IBM's "on top of LangChain" |

## Gaps

- Seeds left unread by the owner's choice of fourteen URLs: aiagent.org, the six planning blogs and gotburnout.io (custom-harness notes), and futureagi.com, ianas.fr, resources.rework.com, uvik.net, splunk.com and reddit.com (frameworks notes). The first round's gap is narrower, not closed.
- The Carnegie Mellon news page that Atlan links for its "30 to 35%" figure was not read.
- Not fetched: the Gartner and Menlo Ventures figures, the JFrog and NVD records for the two CVEs, the NSA report, and primary accounts of the Replit incident. Each stays ⚠️ wherever it appears.
- OpenAI's SWE-bench Verified audit is still unverified: the SWE-bench docs do not mention it, and openai.com was not retried.
- Whether `@modelcontextprotocol/client` 2.4.0, pinned in N24, handles `resultType: "input_required"` was not checked.
