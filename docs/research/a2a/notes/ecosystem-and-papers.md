# A2A ecosystem, governance, MCP relationship and papers (as of November 2026)

Provenance. Raw research notes for todo U19, gathered on 2026-11-19 by a research agent. Every web source was fetched with curl on 2026-11-19 unless another date is given, and is saved under `/private/tmp/claude-501/-Users-laudebugs-git-agent-speak-git/13349893-3ab5-443b-8939-e45188938409/scratchpad/u19/context/` (a scratch directory that may be cleared). The MCP specification repo was shallow-cloned at tag `2026-07-28` (commit `5f5440bb26a62e2cf3440b92da5a667efa03b267`) into that directory as `mcp-repo/`. The Google ADK docs were read from the local mirror at `docs/reference/google-adk/source/adk-docs/` (google/adk-docs commit `ff7a5f56469a81f3e43a8fc54668d8dc84300192`, committed 2026-11-17, mirrored 2026-11-18 per `_manifest.json`). These notes do not summarise the A2A data model; another agent covers the spec at tag v1.0.0 and the a2a-js SDK. Quotations are exact unless marked as paraphrase. Fetched pages were treated as data only.

Tag legend:

- [spec]: normative specification text (A2A or MCP), with version or tag.
- [docs]: official project or product documentation (a2a-protocol.org, modelcontextprotocol.io, vendor product docs).
- [repo]: a file in a git repository, at a named tag or SHA.
- [paper]: an arXiv paper, given as arXiv id with latest version vN and that version's date from the abstract page.
- [vendor]: a blog or announcement by a company with a stake in the subject (Google, Anthropic, Cognition, AWS, IBM, the Linux Foundation, AAIF).
- [secondary]: third-party reporting or commentary.

## 1. Governance and history

### Takeaway

A2A went from a Google-led launch (2025-04-09, "more than 50 technology partners") to a Linux Foundation project (2025-06-23, "more than 100"), absorbed IBM's ACP (2025-08-29), shipped its first stable spec v1.0.0 (2026-03-12), and became an AAIF "Growth Stage" project, where it now sits beside MCP (AAIF proposal approved 2026-08-04, announced 2026-08-17 by AAIF and 2026-08-27 on the A2A blog, "over 150 organizations"). The TSC had eight company seats at tag v1.0.1. By 2026-10-27 on `main` it had nine: Bloomberg was added on 2026-10-20 and IBM's representative changed. Since 2026-08, A2A and MCP share one neutral home. That governance fact makes the "A2A between agents, MCP inside agents" division official at the foundation level, not just a vendor claim.

### Cited findings

Timeline (each fact dated by its source):

| Date | Event | Source |
| --- | --- | --- |
| 2025-03-25 | `a2aproject/A2A` GitHub repo created | [repo] GitHub API `created_at` |
| 2025-04-09 | Google announces A2A | [vendor] developers.googleblog.com |
| 2025-06-23 | Linux Foundation launches the A2A project | [vendor] linuxfoundation.org press release |
| 2025-07-30 | Spec v0.3.0 released | [repo] GitHub releases API |
| 2025-08-29 | IBM's ACP merges into A2A | [vendor] lfaidata.foundation community blog |
| 2025-12-09 | LF forms the Agentic AI Foundation (AAIF), with MCP, goose and AGENTS.md | [vendor] linuxfoundation.org press release |
| 2026-03-12 | Spec v1.0.0 released, plus announcement post | [repo] release v1.0.0; `docs/blog/posts/announcing-1.0.md` |
| 2026-05-26 / 2026-05-28 | v1.0.1 (changelog date / GitHub release publish date) | [repo] release v1.0.1 |
| 2026-06-18 to 2026-08-04 | AAIF project proposal #37 for A2A opened, then closed with labels `Approved`, `Growth` | [repo] github.com/aaif/project-proposals/issues/37 |
| 2026-08-17 | AAIF blog: "A2A joins AAIF's open agentic stack" | [vendor] aaif.io/blog/a2a-joins-aaif |
| 2026-08-27 | A2A blog: "A New Chapter for A2A: Joining the Agentic AI Foundation" | [docs] a2a-protocol.org blog |
| 2026-10-20 | Bloomberg added to the TSC (commit 98279d6231) | [repo] GOVERNANCE.md history |

Google announcement, 2025-04-09 [vendor], https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ :

- "Today, we're launching a new, open protocol called Agent2Agent (A2A), with support and contributions from more than 50 technology partners like Atlassian, Box, Cohere, Intuit, Langchain, MongoDB, PayPal, Salesforce, SAP, ServiceNow, UKG and Workday; and leading service providers including Accenture, BCG, ..."
- "A2A is an open protocol that complements Anthropic's Model Context Protocol (MCP), which provides helpful tools and context to agents."
- The first of the five design principles: "Embrace agentic capabilities: A2A focuses on enabling agents to collaborate in their natural, unstructured modalities, even when they don't share memory, tools and context. We are enabling true multi-agent scenarios without limiting an agent to a "tool.""
- "Support for long-running tasks: ... from quick tasks to deep research that may take hours and or even days when humans are in the loop."
- "We are working with partners to launch a production-ready version of the protocol later this year." (The stable v1.0 actually shipped on 2026-03-12.)

Linux Foundation launch, 2025-06-23 [vendor], https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents :

- "DENVER – Open Source Summit North America – June 23, 2025 – The Linux Foundation ... today announced the launch of the Agent2Agent (A2A) project, an open protocol created by Google for secure agent-to-agent communication and collaboration."
- "The A2A protocol is a collaborative effort launched by Google in April and with growing support from more than 100 leading technology companies."
- The release carries supporting quotes from AWS, Cisco, Salesforce, SAP, Microsoft and ServiceNow. ServiceNow: "ServiceNow is proud to be a founding partner of the Agent2Agent protocol".

IBM ACP merging into A2A, 2025-08-29 [vendor], https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/ (byline "By Nora Anwar August 29, 2025"):

- "IBM Research launched the Agent Communication Protocol (ACP) in March 2025 to power its BeeAI Platform".
- "Today, we're excited to share that ACP is officially merging with the A2A under the Linux Foundation ... umbrella."
- "As part of this transition, the ACP team will be winding down active development and will begin contributing its technology and expertise directly to A2A."
- IBM's representative "will join the A2A Technical Steering Committee on behalf of IBM, alongside representatives from Google, Microsoft, AWS, Cisco, Salesforce, ServiceNow, and SAP."
- [repo] github.com/i-am-bee/acp is `archived: true` per the GitHub API (last push 2025-08-25). Its README line 25 says: "**ACP is now part of A2A under the Linux Foundation!**"

v1.0.0 release, 2026-03-12. [repo] The GitHub release body reads "## [1.0.0](...compare/v0.3.0...v1.0.0) (2026-03-12)". Tag v1.0.0 is at SHA 173695755607e884aa9acf8ce4feed90e32727a1 and tag v1.0.1 at 3303592588e388e62e0f69f701af531d2f4e3991. Announcement post [docs], `docs/blog/posts/announcing-1.0.md` on A2A `main` (front matter `date: 2026-03-12`), https://a2a-protocol.org/latest/blog/ :

- "The A2A Protocol community today are announcing the release of A2A Protocol v1.0, marking the first stable, production-ready version of the open standard for communication between AI agents. The protocol is guided by a technical steering committee with representatives from eight major technology companies."
- Section "Complementary to MCP, not a replacement": "MCP and A2A solve different layers of the problem. MCP is commonly used for tool and context integration at the individual agent level. A2A focuses on communication and coordination between agents. In practice, many systems will use both: MCP inside agents, A2A between agents."
- "The official SDKs ensure v1.0 A2A agents work seamlessly with older versions." and "AgentCard ... now allows agents to advertise support for both existing v0.3 protocol behavior and v1.0 simultaneously."

Technical Steering Committee at tag v1.0.1 [repo], `GOVERNANCE.md` at a2aproject/A2A@v1.0.1 (3303592): "The Committee has eight seats, each held by the following companies:"

Google, Microsoft, Cisco, Amazon Web Services, Salesforce, ServiceNow, SAP and IBM Research, one seat each. (Representatives' names are left out of these notes; they are in the file.)

Differences on `main` as of commit 89699392a3 (2026-10-27) [repo]: "The Committee has nine seats". A new **Bloomberg** row was added (2026-10-20, #2308); the ServiceNow and IBM seats changed representatives (2026-08-18, #2142, and later), and the IBM row no longer says "IBM Research". An antitrust policy line was also added. At tag v1.0.0 the table also had eight seats. v1.0.1 adds the clause "Adding new organizations to the GOVERNANCE file will be determined through a proposal to the TSC GOVERNANCE.md file. Any new organization will be added through a majority vote of the TSC" and an inactive-voting-member rule ("has not attended a meeting of the TSC within the last six weeks"). The "Steady State" clause at v1.0.1: the TSC "will decide upon a "steady state" composition ... to take effect from the date that is 18 months following the inception of the Project".

Joining AAIF:

- [repo] AAIF proposal https://github.com/aaif/project-proposals/issues/37, created 2026-06-18, closed 2026-08-04, labels `Approved`, `contribution-agreement/signed`, `Growth`. On MCP it says: "MCP is described as a vertical integration layer, acting like a "USB-C port" to connect an AI reasoning engine to external tools, databases, and local data. In contrast, A2A is a horizontal orchestration layer designed for peer-to-peer collaboration, negotiation, and task delegation between independent, autonomous agents. We see adoption increasing across perimeter boundaries where agents cannot share tools, skills, or context." It continues: "there has been discussion regarding MCP officially supporting A2A tasks as an extension to encourage "single gateway" implementations." I did not find that discussion in the MCP repo (see section 2).
- [vendor] AAIF blog, dated "August 17, 2026", https://aaif.io/blog/a2a-joins-aaif : "Agent2Agent (A2A) ... is joining the Agentic AI Foundation (AAIF) as a hosted project. ... It's backed by over 150 organizations and running in production across supply chain, financial services, and mobile platforms at OS scale." Also: "Google launched A2A in April 2025 and donated it to the Linux Foundation with founding organizations like AWS, Cisco, Google, Microsoft, Salesforce, SAP, and ServiceNow. In August 2025, IBM's Agent Communication Protocol merged into A2A".
- [docs] A2A blog, 2026-08-27, https://a2a-protocol.org/latest/blog/2026/08/27/a-new-chapter-for-a2a-joining-the-agentic-ai-foundation/ : "The Agent2Agent (A2A) protocol has officially been accepted as a Growth Stage project at the Agentic AI Foundation (AAIF)." Also: "While the Model Context Protocol (MCP) serves as the vertical integration layer connecting agents to internal tools and databases, A2A acts as the horizontal protocol enabling peer-to-peer collaboration." And: "It is currently backed by over 150 organizations". The post links to a Forbes article dated 2026-08-19 [secondary], which I did not read.

Number of supporting organisations, by official source: "more than 50 technology partners" (Google, 2025-04-09); "more than 100 leading technology companies" (LF, 2025-06-23); "over 150 organizations" (AAIF 2026-08-17 and A2A blog 2026-08-27). None of these sources publishes a list that adds up to the count. The a2a-protocol.org/latest/partners/ page lists partners but gives no total, and I did not count it.

## 2. The MCP side

### Takeaway

The current MCP specification is `2026-07-28`. modelcontextprotocol.io/specification/latest returns a 307 redirect to `/specification/2026-07-28`, and the repo's newest tag is `2026-07-28`, published 2026-07-28. The next release is targeted for 2027-03-30. Four changes in 2026-07-28 bear on "agents calling agents". (1) Tasks, introduced as experimental in core on 2025-11-25, moved out of core into an official extension `io.modelcontextprotocol/tasks` (SEP-2663, authored "on behalf of the Agents Working Group"). (2) Sampling, the feature that let servers run agentic loops on the client's model, is now Deprecated (SEP-2577). (3) Server-initiated requests (sampling, elicitation, roots) were replaced by the Multi Round-Trip Requests (MRTR) pattern. (4) MCP became stateless (no `initialize`, no sessions). MCP's roadmap names "Agent communication" and later "Agentic messaging primitives" as priority areas, and SEP-1686 cites an Amazon multi-agent system that communicates "through MCP". So MCP is growing agent-to-agent-ish features, but it frames them as long-running tool calls (call now, fetch later). In the MCP spec repo, the docs, `llms-full.txt` and the blog, I found no mention of A2A at all, neither positioning against it nor beside it. The "complementary" framing comes from the A2A side and from AAIF. MCP moved to AAIF on 2025-12-09.

### Cited findings

Current version:

- [docs] `curl -sIL https://modelcontextprotocol.io/specification/latest` returned `HTTP/2 307` with `location: /specification/2026-07-28`.
- [repo] GitHub tags for modelcontextprotocol/modelcontextprotocol: `2026-07-28` (release published 2026-07-28T16:47:49Z), `2026-07-28-RC` (2026-05-29), `2025-11-25` (2025-11-25), `2025-06-18`, `2025-03-26`, `2024-11-05`. This matches our repo's "MCP 2026-07-28".
- [vendor] MCP blog "A More Predictable Release Cycle for MCP", dated 2026-11-11 (`blog/content/posts/mcp-release-cycle.md` on `main`): "For the next release, we're targeting **March 30, 2027** - expect MCP version `2027-03-30` to land then."

2026-07-28 changelog [spec], `docs/specification/2026-07-28/changelog.mdx` at tag 2026-07-28:

- Major change 6: "Move experimental tasks out of the core protocol and into an official extension (`io.modelcontextprotocol/tasks`). The redesigned extension replaces the blocking `tasks/result` method with polling via `tasks/get` and a new `tasks/update` for client-to-server input, removes `tasks/list`, and allows servers to return task handles unsolicited without per-request opt-in ([SEP-2663]...)."
- Major change 7: "Multi Round-Trip Requests (MRTR) pattern introduced which replaces the previous approach of sending server-initiated requests, such as `roots/list`, `sampling/createMessage`, or `elicitation/create`. Servers return an `InputRequiredResult` (`resultType: "input_required"`) ..."
- Major change 2: "Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake."
- Deprecated 1: "Deprecate the Roots, Sampling, and Logging features ([SEP-2577]...). ... Suggested migrations: ... integrate directly with LLM provider APIs instead of Sampling".
- Governance: "Adopt a specification feature lifecycle and deprecation policy ... a minimum twelve-month deprecation window".

Tasks:

- [spec] 2025-11-25, `docs/specification/2025-11-25/basic/utilities/tasks.mdx`: "Tasks were introduced in version 2025-11-25 of the MCP specification and are currently considered **experimental**." and "Tasks are durable state machines that carry information about the underlying execution state of the request they wrap, and are intended for requestor polling and deferred result retrieval." So yes, tasks were introduced on 2025-11-25, as experimental.
- [vendor] MCP anniversary post, 2025-11-25 (`blog/content/posts/2025-11-25-first-mcp-anniversary.md`), listing target scenarios for tasks: "Deep research tools that spawn multiple agents internally" and "Multi-agent systems where agents can work concurrently".
- [repo] SEP-1686 (Tasks, status Final), use case 6, "Agent-to-Agent Communication (Multi-Agent Systems)": "One of Amazon's internal multi-agent systems for customer question answering faces scenarios where agents require significant processing time ... When agents communicate through MCP, slow agents cause cascading delays throughout this system". This is the clearest statement in MCP's own repo that people use MCP for agent-to-agent calls.
- [docs] Tasks extension overview, `docs/extensions/tasks/overview.mdx`: "MCP Tasks let servers return a durable handle instead of blocking, so clients can poll for progress, provide input when needed, and retrieve the final result after reconnecting." The full spec lives in github.com/modelcontextprotocol/ext-tasks, which I did not read.
- [repo] SEP-2663 (Tasks Extension, Final, Extensions Track, created 2026-04-27): "Author(s) | Luca Chang ..., Caitie McCaffrey ...; on behalf of the Agents Working Group".

Sampling and elicitation:

- [spec] 2025-11-25 sampling, line 16: "Sampling in MCP allows servers to implement agentic behaviors, by enabling LLM calls to ..." and "Tools in Sampling" (line 38): "This enables servers to implement agentic behaviors where the LLM can call tools, receive results, and continue the conversation - all within a single sampling request flow."
- [spec] 2026-07-28 sampling: "**Deprecated**: The Sampling feature is deprecated as of protocol version `2026-07-28` ... New implementations **SHOULD NOT** adopt it; existing implementations **SHOULD** migrate to integrating directly with LLM provider APIs."
- [spec] 2026-07-28 elicitation is not deprecated: "The Model Context Protocol (MCP) provides a standardized way for servers to request additional information from users through the client during interactions." It has two modes, form and URL. Changelog minor change 11 removes `notifications/elicitation/complete` because "Under the Multi Round-Trip Requests pattern, the client learns the outcome of an out-of-band interaction by retrying the original request".

Roadmap language about agents:

- [docs] `docs/development/roadmap.mdx` at tag 2026-07-28 ("Last updated: 2026-03-05"), section "2. Agent Communication": "The Tasks extension ([SEP-2663]) gave agents a reliable call-now / fetch-later pattern. Running it in production has surfaced gaps in the lifecycle semantics that the **Agents WG** should close: Retry semantics ... Expiry policies".
- [vendor] "The New MCP Roadmap", 2026-08-22 (lead maintainers David Soria Parra and Den Delimarsky): "Modern agentic workloads no longer fit the standard request-and-response pattern. Loops can run for longer, servers can push streamed results, and there is a clear need to steer work mid-flight." It plans "maturing the Tasks extension (SEP-2663) so it can move into the specification". Under "Agent identity and enterprise-ready security": "more and more of the callers are agents running as cloud workloads with their own identity, acting on behalf of a user who isn't present, or delegating narrower authority to sub-agents."

Does MCP position itself against or beside A2A? Not found. Searches run: `grep -rniE "\bA2A\b|agent2agent|agent-to-agent"` over all `.md`/`.mdx` in the MCP repo at tag 2026-07-28 (only SEP-1686's "Agent-to-Agent Communication" use case matched); the same grep over two newer blog posts on `main` (0 hits); the same grep over https://modelcontextprotocol.io/llms-full.txt, 2.4 MB (0 hits); a GitHub issue search for "A2A" in titles of modelcontextprotocol/modelcontextprotocol (0 results, though this unauthenticated search may be incomplete). The AAIF proposal's claim of "discussion regarding MCP officially supporting A2A tasks as an extension" is therefore unverified from the MCP side.

AAIF and MCP:

- [vendor] LF press release, 2025-12-09, https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation : "The Linux Foundation announced the formation of the Agentic AI Foundation (AAIF) with founding contributions of leading technical projects including Anthropic's Model Context Protocol (MCP), Block's goose, and OpenAI's AGENTS.md." and "Platinum members include Amazon Web Services, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft and OpenAI." Gold members include Cisco, IBM, Salesforce, SAP and others.
- [vendor] MCP blog, 2025-12-09 (`2025-12-09-mcp-joins-agentic-ai-foundation.md`): "Anthropic is donating MCP to the Agentic AI Foundation, a directed fund under the Linux Foundation." Also: "Over 97 million monthly SDK downloads, 10,000 active servers". On autonomy: "individual projects, such as MCP, maintain full autonomy over their technical direction and day-to-day operations."

## 3. Papers and measurement studies

### Takeaway

Surveys from 2025 frame MCP as tool access and A2A as peer task delegation, and propose phased adoption with MCP first. 2026 security work has moved from threat models to measurements against the A2A spec and real deployments. Reported results:

- A2ABreak found 11 specification-level vulnerabilities, including cross-client context injection via context IDs and identity loss in multi-hop delegation.
- A crawl of 36.1M domains found 310 public Agent Cards, and an Agent Card manipulation benchmark found LLM judges detecting attacks with 25.8% to 92.3% recall.
- A name-collision attack class caused wrong-peer dispatch in 6 of 7 open-source hosts.
- Multi-hop authorization lacks semantic attenuation.
- A 2,500-run A2A failure study found that "no agent verifies a peer's factual claim on its own initiative".

On "when to delegate", the evidence is consistent. Multi-agent setups help on decomposable, parallel, breadth-first work: Anthropic reports +90.2% on its internal research eval, and Kim et al. report +80.8% on financial reasoning. They hurt on sequential or tightly coupled work: −39% to −70% on planning, and negative returns once single-agent accuracy exceeds about 45%. Under equal compute, single agents often match or beat multi-agent setups. Costs are about 15x tokens versus chat (Anthropic, 2025) or 3 to 10x versus single-agent (Anthropic, 2026). Most of these papers are preprints. Only the JISA journal paper (2602.11327), an ICML 2026 workshop paper (2609.22949) and an ACSAC 2026 workshop paper (2611.18887) state peer review on arXiv.

### Cited findings: protocol surveys and comparisons

- [paper] arXiv 2505.02279 v2 (Fri, 23 May 2025), Ehtesham et al., "A survey of agent interoperability protocols: Model Context Protocol (MCP), Agent Communication Protocol (ACP), Agent-to-Agent Protocol (A2A), and Agent Network Protocol (ANP)". Abstract: "A2A enables peer-to-peer task delegation using capability-based Agent Cards". It proposes "a phased adoption roadmap ... beginning with MCP for tool access, followed by ACP for structured, multimodal messaging ... A2A for collaborative task execution, and extending to ANP for decentralized agent marketplaces." No journal reference on arXiv, so treat it as not peer-reviewed. ACP has since been folded into A2A (section 1), so the roadmap is dated.
- [paper] arXiv 2607.23884 v1 (Sun, 26 Jul 2026), Predoaia et al., "A Comparative Study of MCP and A2A for Inter-Agent Coordination in LLM-Based Systems". Finding: "MCP can support inter-agent coordination in constrained LLM-based systems through a comparatively lightweight implementation model with lower coordination complexity, although coordination concerns such as conversational state management and task lifecycle handling must be implemented explicitly at the application layer. In contrast, A2A provides richer native support for stateful, multi-turn coordination ... but this comes with substantially greater implementation and coordination complexity." The authors call it "an empirical experience report rather than general claims". 18 pages, no venue stated.
- [paper] arXiv 2610.04053 v1 (Fri, 2 Oct 2026), "The Cost of a Hop: Benchmarking NLIP and A2A". "For lightweight coordination, NLIP is 8.4-9.6x faster than the baseline A2A SDK implementation on two environments and about 4x on a third"; "for the end-to-end pipeline, where LLM inference dominates, the protocols are near parity. The difference comes almost entirely from connection setup." With connection caching, A2A narrows the gap "from 2.75x on one machine to near-parity on faster hardware". No venue stated. This is relevant because A2A's per-hop overhead matters only when LLM inference does not dominate.
- [paper] arXiv 2602.11327 v2 (Fri, 17 Apr 2026), "Security Threat Modeling for Emerging AI-Agent Protocols: A Comparative Analysis of MCP, A2A, Agora, and ANP". Journal ref: "Journal of Information Security and Applications, 2026, Article 104645" (peer-reviewed). It "identifies twelve protocol-level risks" and includes an MCP case study "quantifying wrong-provider tool execution under multi-server composition".

### Cited findings: A2A security

- [paper] arXiv 2504.16902 v2 (Fri, 2 May 2025), Habler, Huang, Narajala, Kulkarni, "Building A Secure Agentic AI Application Leveraging A2A Protocol". It applies the MAESTRO threat-modeling framework, "focusing on aspects such as Agent Card management, task execution integrity, and authentication methodologies". It is a threat-modeling and guidance paper with no measured numbers. Comment: "13 pages, 4 figures, 1 table". No venue stated, so not peer-reviewed as far as arXiv shows. It analyses the pre-1.0 draft.
- [paper] arXiv 2505.12490 v3 (Thu, 28 Aug 2025), Louck, Stulman, Dvir, "Improving Google A2A Protocol: Protecting Sensitive Data and Mitigating Unintended Harms in Multi-Agent Systems". Weaknesses identified: "insufficient token lifetime control, lack of strong customer authentication, overbroad access scopes, and missing consent flows". Proposed fixes: "explicit consent orchestration, ephemeral scoped tokens, and direct user-to-service data channels". "Empirical evaluation using adversarial prompt injection tests shows that the enhanced protocol substantially reduces sensitive data leakage". The abstract gives no numbers. No venue stated. It analyses the pre-1.0 spec.
- [paper] arXiv 2609.10871 v3 (Sat, 24 Oct 2026), "A2ABreak: Systematic Security Analysis of the A2A Protocol". It derived "a unified model of 37 states and 76 transitions from 929 formalized statements" and found that "Our analysis uncovers 11 new vulnerabilities, each exploitable by a specification-compliant adversary without requiring any implementation flaw. Among the findings are cross-client context injection through unprotected context identifiers, credential harvesting via multi-hop identity loss in delegation chains, and data exfiltration through rogue agents advertising unattested capability claims." Method performance: "A2ABreak achieves 73.3% precision and 84.6% F1 against manual expert review, while a zero-shot LLM baseline ... produces zero confirmed findings." No venue stated. Which spec version it modelled is not stated in the abstract; check the PDF.
- [paper] arXiv 2611.18887 v1 (Fri, 13 Nov 2026), "We Have All the Cards: Securing Agent Cards at the Operational Trust Boundary of the Agent2Agent Protocol". Comment: "To be published at the Workshop on Agentic AI in Offensive and Defensive Cyber Operations (AIDC'26) ... co-located with the IEEE Annual Computer Security Applications Conference (ACSAC)" (peer-reviewed workshop). "Agent Cards contain attacker-controllable natural-language fields that may influence agent selection before a provider is invoked, creating a pre-invocation trust problem." It defines "a taxonomy of ten Agent Card manipulation attacks". Ecosystem measurement: "probing 36.1 million Internet domains and collecting 310 deployed Agent Cards". Detection results: "the strongest semantic judge achieves 97.0% security recall at a 1.7% false-positive rate. Across nine LLM judges on the synthetic benchmark, security recall ranges from 25.8% to 92.3%". This is the agent-card spoofing paper the brief asked about.
- [paper] arXiv 2609.27624 v1 (Wed, 23 Sep 2026), "Agent Name Collision Attacks in Multi-Agent Systems". "A2A defines the card's name as human-readable metadata, not as a stable identity, and specifies no collision semantics." Result: "Six client-style integrations selected an attacker-controlled peer's client or loopback endpoint for a request addressed to a trusted peer's name." It tested "seven pinned open-source revisions". Recommendation: "Hosts should route by an origin-bound stable identity, keep names presentational, and reject ambiguous aliases." The authors say it is "a recurring implementation vulnerability class, not a universal A2A protocol exploit". No venue stated.
- [paper] arXiv 2611.07050 v1 (Wed, 4 Nov 2026), "Authorization Propagation in Agent2Agent Systems: An Experimental Security Evaluation of Multi-Hop Delegation". "Of 15 adversarial conditions, 14 are rejected; an isolated delegation-path test exposes the absence of semantic authority attenuation." Cost: "median security-processing latency of 5.11 ms and a 3.87 kB serialized payload". It identifies "origin-verifiable delegation and semantic attenuation as requirements for stronger A2A authorization propagation." No venue stated.
- [paper] arXiv 2609.22949 v1 (Sat, 19 Sep 2026), "Beyond Single-Model Injection: A Threat Model and Defense Architecture for Prompt Injection in Multi-Agent Systems". Comment: "Accepted at the AIWILD Workshop, ICML 2026." It is generic to multi-agent systems, not A2A-specific. It enumerates "14 attack vectors" with "inter-agent injection via message passing (4 vectors)". Results: "67% of agents are vulnerable to at least one scope violation even with system-prompt-level guardrails, and indirect injection via tool outputs succeeds in 43% of attempts. Four architectural defenses reduce overall injection success from 31.2% to 4.2%: message signing with provenance tracking (inter-agent injection down 91%) ..."
- [paper] arXiv 2609.01693 v1 (Tue, 1 Sep 2026), "Public-Sharing Labels and Verbatim Field Egress in an MCP-to-A2A Agent Configuration". It covers one agent using both MCP and A2A: "Safety properties assessed separately for Model Context Protocol (MCP) tool use and Agent2Agent (A2A) delegation need not describe behavior when one agent uses both." 480 trials. Adding the label "PUBLIC - OK TO SHARE" is "descriptively associated with higher verbatim egress", most strongly for one model ("public-minus-unlabeled mean +0.800, all 10 scenarios"). The authors say it is "an association in one configuration, not a causal or general effect." No venue stated.
- [paper] arXiv 2610.19342 v2 (Thu, 15 Oct 2026), "Why Do Agent Teams Fail Across Boundaries? A Failure Taxonomy for Agent-to-Agent Systems with Private States". "more than 2,500 recorded runs ... spanning 488 scenarios"; "a taxonomy of 20 A2A failure modes in four categories". Findings: "(1) discovery and interaction are driven by the phrasing of the task rather than the availability of peer agents; (2) no agent verifies a peer's factual claim on its own initiative, so an A2A system inherits the reliability of its least reliable participant unless the protocol or mechanism performs the check". Here "A2A" means agent-to-agent scenarios in general; whether the experiments used the A2A protocol is not stated in the abstract. No venue stated.
- Other 2026 A2A-security papers seen in arXiv listings but not read beyond titles: 2602.05877 v1 (2026-02-05, "Agent2Agent Threats in Safety-Critical LLM Assistants", automotive threat taxonomy, no numbers in abstract); 2609.33924 (A2A-ForensicTrace); 2608.23858 (security analysis of AP2, which runs over A2A); 2603.23801 (AgentRFC conformance testing); 2511.03841 v1 (2025-11-05, compares CORAL and ACP implementations against a literature-based A2A evaluation).

### Cited findings: multi-agent vs single-agent effectiveness

- [vendor] Anthropic, "How we built our multi-agent research system", published Jun 13, 2025, https://www.anthropic.com/engineering/multi-agent-research-system :
  - "a multi-agent system with Claude Opus 4 as the lead agent and Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval."
  - "three factors explained 95% of the performance variance in the BrowseComp evaluation ... token usage by itself explains 80% of the variance".
  - "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats."
  - "most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time."
  - "multi-agent systems excel at valuable tasks that involve heavy parallelization, information that exceeds single context windows, and interfacing with numerous complex tools."
  - Internal eval, not peer-reviewed. These are in-process subagents, not A2A.
- [vendor] Anthropic (Claude blog), "When to use multi-agent systems (and when not to)", dated January 23, 2026, https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them :
  - "three situations where multiple agents consistently outperform a single agent: when context pollution degrades performance, when tasks can run in parallel, and when specialization improves tool selection or task focus. Outside these situations, the coordination costs typically exceed the benefits."
  - "In our testing, multi-agent implementations typically use 3-10x more tokens than single-agent approaches for equivalent tasks."
  - "Decomposition follows context, not problem type."
  - "The primary benefit of parallelization is thoroughness, not speed."
- [vendor] Cognition (Walden Yan), "Don't Build Multi-Agents", dated 2025.06.12, https://cognition.ai/blog/dont-build-multi-agents :
  - Principle 1: "Share context, and share full agent traces, not just individual messages". Principle 2: "Actions carry implicit decisions, and conflicting decisions carry bad results".
  - "it is evident that in 2025, running multiple agents in collaboration only results in fragile systems. The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough between the agents."
  - On Claude Code subagents: "it never does work in parallel with the subtask agent, and the subtask agent is usually only tasked with answering a question, not writing any code."
  - Opinion with no numbers.
- [paper] arXiv 2503.13657 v3 (Sun, 26 Oct 2025), Cemri, Pan, Yang et al. (UC Berkeley and others), "Why Do Multi-Agent LLM Systems Fail?":
  - "MAST-Data, a comprehensive dataset of 1600+ annotated traces collected across 7 popular MAS frameworks"; "14 unique modes, clustered into 3 categories: (i) system design issues, (ii) inter-agent misalignment, and (iii) task verification"; "kappa = 0.88".
  - The v3 HTML reports "41% to 86.7% failure rate on 7 state-of-the-art (SOTA) open-source MAS".
  - Largest failure modes: step repetitions (FM-1.3, 15.7%), reasoning-action mismatch (FM-2.6, 13.2%), not recognizing task completion (FM-1.5, 12.4%) and disobeying task specification (FM-1.1, 11.8%). Inter-agent information withholding is FM-2.4 at 0.85%.
  - Interventions: "+9.4%" (role specification) and "+15.6%" (high-level verification) on ChatDev.
  - The arXiv comment is just "ArXiv v3", and there is no journal reference. Peer-review status is not confirmed by the sources I read. I believe it appeared at NeurIPS 2025 (Datasets and Benchmarks), but I did not verify this.
- [paper] arXiv 2512.08296 v3 (Wed, 8 Apr 2026), Kim et al. (Google Research and Google DeepMind affiliations in the HTML), "Towards a Science of Scaling Agent Systems":
  - "260 configurations spanning six agentic benchmarks, five canonical architectures ... three LLM families"; "Relative performance change compared to single-agent baseline ranges from +80.8% on decomposable financial reasoning to -70.0% on sequential planning"; "The framework identifies the best-performing architecture for 87% of held-out configurations".
  - From the v3 HTML: "tasks where single-agent performance already exceeds 45% accuracy experience negative returns from additional agents"; "Independent systems amplify trace-level errors 17.2× ... Centralized coordination, however, contains this to 4.4×"; "the overall mean MAS improvement is −0.3% (95% CI: [−58.7%, +77.2%])"; "tool-heavy tasks ... suffer from multi-agent coordination overhead" (β = −0.096).
  - No venue stated.
- [paper] arXiv 2604.02460 v2 (Sat, 11 Apr 2026), "Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets". "SAS consistently match or outperform MAS on multi-hop reasoning tasks when reasoning tokens are held constant". It predicts multi-agent systems "become competitive when a single agent's effective context utilization is degraded, or when more compute is expended." No venue stated.
- [paper] arXiv 2609.04217 v1 (Thu, 25 Jun 2026), "At Equal Inference Cost, Multi-Agent Structure Does Not Beat a Single Frozen Agent". ALFWorld: "0.769 versus 0.754, p = 0.80, despite using 1.8 times more evaluation calls". "Under equal inference cost, multi-agent structure adds cost without clear benefit." It uses a 7B backbone. No venue stated.
- [paper] arXiv 2601.12307 v1 (Sun, 18 Jan 2026), "Rethinking the Value of Multi-Agent Workflow: A Strong Single Agent Baseline". Across seven benchmarks, "a single agent can reach the performance of homogeneous workflows with an efficiency advantage from KV cache reuse"; "single-LLM methods cannot capture heterogeneous workflows". This bears directly on A2A, whose agents are heterogeneous by design. No venue stated.
- [paper] arXiv 2601.04748 v2 (Wed, 14 Jan 2026), "When Single-Agent with Skills Replace Multi-Agent Systems and When They Fail". "a multi-agent system can be compiled into an equivalent single-agent system, trading inter-agent communication for skill selection"; "selection accuracy remains stable up to a critical library size, then drops sharply". "25 pages, technical report". Not peer-reviewed.

## 4. Official guidance: A2A vs MCP vs subagents

### Takeaway

The official guidance converges on three rules. Use MCP for tools and resources: structured, often stateless calls. Use A2A for opaque, autonomous peers that keep state over multi-turn work across a boundary (another team, organisation, language, framework or service). Use in-process subagents (or plain functions) when the work is internal, latency-sensitive, or needs shared memory or context. Several frameworks blur the line by letting you wrap a remote A2A agent as a tool: ADK's `RemoteA2aAgent` "feels just like interacting with a local tool", Microsoft's `get_a2a_tool`, and Azure Foundry's `a2a` tool type. Microsoft warns that remote A2A responses are untrusted input. I found no Anthropic or OpenAI documentation that mentions A2A. Anthropic's own guidance on subagents vs MCP is about in-process context isolation.

### Cited findings

A2A docs, "A2A and MCP" [docs], https://a2a-protocol.org/latest/topics/a2a-and-mcp/ (page footer "Copyright 2026"):

- "MCP is vertical. It deepens a single agent. You can build an agentic system under one roof — one or more agents in a single application. Every MCP connection you add hands an agent another tool, resource, or skill."
- "A2A is horizontal. It connects agents across that boundary. The other agent may belong to another team, another department, or a partner organization."
- "Used together, MCP gives each agent depth, and A2A gives your system reach."
- MCP domain: "These are typically primitives with well-defined, structured inputs and outputs. They perform specific, often stateless, functions." A2A domain: "These are more autonomous systems. They reason, plan, and use multiple tools. They keep state over longer interactions and hold complex, often multi-turn dialogues to handle novel or evolving tasks."
- "A2A connects the agents to each other; MCP connects each agent to its own tools."
- "An A2A Server (a remote agent) can expose some skills as MCP-compatible resources. This works best when the skills are well-defined and can be called in a tool-like, stateless way."
- "A2A is about agents partnering on tasks; MCP is more about agents using capabilities."

Google ADK docs [docs], local mirror `docs/reference/google-adk/source/adk-docs/docs/a2a/intro.md` (google/adk-docs@ff7a5f5):

- intro.md:8 heading: "## When to use A2A vs. local sub-agents".
- intro.md:10-14: "**Local Sub-Agents:** These are agents that run *within the same application process* as your main agent. ... Communication between a main agent and its local sub-agents is very fast because it happens directly in memory, without network overhead."
- intro.md:20-28: "Consider using **A2A** when: The agent you need to talk to is a **separate, standalone service** ... The agent is maintained by a **different team or organization**. You need to connect agents written in **different programming languages or agent frameworks**. You want to enforce a **strong, formal contract** (the A2A protocol) between your system's components."
- intro.md:47 heading: "### When NOT to use A2A: concrete examples (prefer local sub-agents)". intro.md:57-59: "**Shared Memory/Context:** When sub-agents need direct access to the main agent's internal state or shared memory for efficiency, A2A's network overhead and serialization/deserialization would be counterproductive." intro.md:60-62: "**Simple Helper Functions:** ... a simple function or class within the same agent is more appropriate than a separate A2A agent."
- intro.md:84-87: "once you've set up this connection, interacting with the remote agent feels just like interacting with a local tool or function. ADK abstracts away the network layer".
- index.md:9-10: "Experimental in Go and Java ... A2A support is experimental in ADK Go, ADK Java, and ADK Kotlin."

Microsoft Agent Framework [docs], "A2A Agent", https://learn.microsoft.com/en-us/agent-framework/user-guide/agents/agent-types/a2a-agent (ms.date 2026-11-11):

- "The A2AAgent enables your application to connect to remote agents that are exposed via the Agent-to-Agent (A2A) protocol. It wraps any A2A-compliant endpoint as a standard AIAgent".
- Warning: "Before connecting to an A2A agent, verify that you trust both the endpoint URL and the organization or publisher that operates the remote agent. Treat responses from the remote agent as untrusted application input. Validate them before code performs side effects or renders content."
- "A2AAgent is a transport-level wrapper around a remote A2A agent. Whatever tools the remote agent uses live on the remote side and are invisible to your code. Agent Framework tool types (function tools, code interpreter, file search, hosted/local MCP, etc.) are not configured on the A2AAgent itself".
- "If you want a Foundry agent to call an A2A agent as a tool, see the get_a2a_tool factory on FoundryChatClient." The Go section is headed "Use remote A2A agents as tools".
- Overview page (ms.date 2026-10-23), "When to use agents vs workflows": "If you can write a function to handle the task, do that instead of using an AI agent."

LangSmith / LangGraph [docs], "A2A endpoint in Agent Server", https://docs.langchain.com/langsmith/server-a2a.md :

- "The A2A endpoint is available in Agent Server at `/a2a/{assistant_id}`."
- "Agent Server speaks the A2A **v1.0** JSON-RPC binding and also accepts the v0.3 method names, so existing v0.3 clients keep working."
- "Each assistant automatically exposes an A2A Agent Card". The page gives no guidance on when to use A2A versus other options. Not found: a LangGraph page on "A2A vs subagents".

Anthropic:

- No A2A statement found. A `grep -ciE "\bA2A\b|agent2agent"` over https://docs.claude.com/llms-full.txt (55 MB, fetched 2026-11-19) returned 0. The same grep over https://code.claude.com/docs/llms.txt also returned 0. The only "agent-to-agent" hits are Managed Agents thread events: "Delivery event written to the target thread's input stream when an agent-to-agent message arrives." Anthropic is an AAIF Platinum member, and AAIF hosts A2A (section 1), but that is not an Anthropic statement on A2A.
- Claude Code docs, "Extend Claude Code" [docs], https://code.claude.com/docs/en/features-overview.md : "**Subagent** | Isolated execution context that returns summarized results | Context isolation, parallel tasks, specialized workers" vs "**MCP** | Connect to external services | External data or actions".
- Claude Managed Agents docs [docs], https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration.md : "With **subagents**, it delegates tasks itself and reads what each subagent reports. With **dynamic workflows**, it writes a workflow: a program that runs many agents in the background and combines their results." Also: "Delegation is one level deep, and a session can have at most 25 child threads at a time".

OpenAI: no A2A statement found. `grep -iE "\bA2A\b|agent2agent|agent-to-agent"` returned 0 hits over https://developers.openai.com/llms.txt and https://openai.github.io/openai-agents-python/llms-full.txt. The Agents SDK's own delegation primitives are "handoffs" and agents-as-tools. OpenAI's AGENTS.md is an AAIF founding project.

## 5. Adoption signals (as of 2026-11-19)

### Takeaway

The spec repo has about 26.6k stars. The SDK repos range from about 0.3k to 2.2k stars, with Python the largest. @a2a-js/sdk shows about 8.1M npm downloads in the week of 2026-11-12 to 2026-11-18 (27.1M in the 30 days to 2026-11-18). That is high for a 656-star repo and is probably driven by transitive or CI installs; I did not investigate. Primary product docs confirm A2A support in Google Gemini Enterprise ("Preview", "Pre-GA"), Azure AI Foundry Agent Service (an `a2a` tool type that is GA for A2A 1.0, plus a preview type for 0.3), AWS Bedrock AgentCore Runtime (hosting A2A servers) and LangSmith Agent Server (A2A v1.0 plus v0.3). For comparison, the MCP spec repo has about 9.7k stars, but MCP reports "97 million monthly SDK downloads" across all its SDKs (2025-12-09), so the two are not comparable by repo stars.

### Cited findings

GitHub API, fetched 2026-11-19 [repo]:

| Repo | Stars | Forks | Created | Last push |
| --- | --- | --- | --- | --- |
| a2aproject/A2A | 26,593 | 2,707 | 2025-03-25 | 2026-11-18 |
| a2aproject/a2a-python | 2,249 | 554 | 2025-05-09 | 2026-11-19 |
| a2aproject/a2a-samples | 1,839 | | | |
| a2aproject/a2a-js | 656 | 186 | 2025-05-27 | 2026-11-19 |
| a2aproject/a2a-java | 517 | 204 | 2025-05-02 | 2026-11-19 |
| a2aproject/a2a-go | 512 | 124 | 2025-05-30 | 2026-11-18 |
| a2aproject/a2a-inspector | 512 | | | |
| a2aproject/a2a-dotnet | 270 | 74 | 2025-05-29 | 2026-11-17 |
| a2aproject/a2a-cli | 189 | | | |
| a2aproject/a2a-rs | 116 | | | |
| a2aproject/a2a-tck | 60 | | | |
| modelcontextprotocol/modelcontextprotocol (comparison) | 9,722 | | | |

npm [repo]:

- `https://api.npmjs.org/downloads/point/last-week/@a2a-js/sdk` returned `{"downloads":8104700,"start":"2026-11-12","end":"2026-11-18","package":"@a2a-js/sdk"}`.
- The last-month query returned 27,099,434 (2026-10-20 to 2026-11-18).
- Registry `dist-tags`: `latest: 1.3.0`. Publish times: 1.0.0 on 2026-07-22, 1.1.0 on 2026-08-26, 1.2.0 on 2026-09-18, 1.3.0 on 2026-09-29.
- Spec repo also has tag `v1.1.0-rc` (SHA 78e1d6a1).

Hosted products, primary docs:

- Google Gemini Enterprise [docs], "Register and manage A2A agents" ("Last updated 2026-11-13 UTC"), https://cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent : marked "Preview" and "subject to the "Pre-GA Offerings Terms"". "This document explains how Gemini Enterprise administrators can connect agents that are built using A2A and hosted on any platform to Gemini Enterprise". Security note: "To secure A2A agents, developers must configure Model Armor using the REST API within their agent's application code. The Model Armor settings in the Google Cloud console for Gemini Enterprise don't automatically protect A2A agents." The sidebar also lists "Import A2A agents from Agent Registry" and "Add and manage A2A agents from Google Cloud Marketplace". Agentspace is the earlier name used in the 2025-04-09 announcement; I did not check rename docs.
- Microsoft Foundry Agent Service [docs], "Connect to an A2A agent endpoint from Foundry Agent Service" (ms.date 2026-10-28), https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/tools/agent-to-agent : "Use the generally available a2a tool type for new integrations. The earlier a2a_preview tool type remains in preview". Version table: `a2a` is "1.0 | Generally available (GA)" and `a2a_preview` is "0.3 | Preview". "The Connected Agents tool from the classic Agents API isn't available in the new Foundry Agent Service. To connect one agent to another, use one of the following approaches: A2A tool ... Workflows".
- AWS Bedrock AgentCore [docs], "Deploy A2A servers in AgentCore Runtime", https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a.html : "Amazon Bedrock AgentCore acts as a proxy between clients and your A2A server. When configured for A2A, Amazon Bedrock AgentCore expects containers to run stateless, streamable HTTP servers on port 9000 at the root path". The AWS launch blog [vendor] "Introducing agent-to-agent protocol support in Amazon Bedrock AgentCore Runtime" is dated "11 NOV 2025".
- LangSmith Agent Server [docs]: see section 4. It speaks "A2A **v1.0** JSON-RPC" and accepts v0.3.
- Salesforce Agentforce: not found in primary docs. Both https://developer.salesforce.com/docs/einstein/genai/guide/agentforce-a2a.html and https://developer.salesforce.com/blogs/2025/06/agentforce-and-the-a2a-protocol (guessed URLs) returned a Salesforce error page. The only sources are [vendor] AAIF (2026-08-17), "platforms like ServiceNow, Salesforce, Atlassian, and SAP utilizing A2A" (A2A blog, 2026-08-27), and the Salesforce quote in the LF release (2025-06-23): "we're extending our open platform to empower Agentforce to orchestrate solutions from disconnected systems".
- Further claims I did not verify from primary product docs [vendor]. AAIF blog, 2026-08-17: "Huawei has standardized A2A as the protocol between Celia, its OS-level AI assistant, and in-app agents across the HarmonyOS developer platform"; "Tencent's WeChat is among the first major apps integrating with Huawei and other Android OEM assistants over A2A"; "Google Cloud and PayPal are extending A2A into agentic commerce through the Agent Payments Protocol (AP2)". The AAIF proposal #37 also lists Microsoft 365 Copilot's "Work IQ API" with A2A.

## Synthesis for the U19 question (notes, not conclusions)

- Division of labour. Every official A2A and AAIF source dated 2025-04 to 2026-08 says MCP connects an agent to tools and context ("vertical") and A2A connects agents to agents across a boundary ("horizontal"). MCP's own documents do not mention A2A. Yet MCP is adding agent-ish features: tasks as an extension, MRTR for mid-flight input, and agent identity on the roadmap. It is also dropping sampling, the feature that let an MCP server act as an agent on the client's model. So the boundary may blur at the "long-running remote tool" end.
- When to use A2A, from the guidance in section 4: the peer is a separate service; another team or organisation owns it; it is in a different language or framework; it keeps its own state, tools and context, which stay opaque; it needs multi-turn negotiation or long-running tasks; or you need a formal contract. Use MCP or a plain tool when the capability is structured and stateless. Use an in-process subagent when you need context isolation or parallelism inside your own trust boundary, or shared memory, or low latency.
- When to delegate at all, from section 3: delegate when the work is decomposable or parallel, or exceeds one context window. Do not delegate sequential or tightly coupled work. Expect 3 to 15x the tokens. Expect errors to propagate unless something verifies results centrally. Peers do not check each other's claims. Remote cards and names are attacker-controlled input.

## Open questions

- MCP side: is there any MCP maintainer statement (Discord, SEP or blog) on A2A, or on "MCP officially supporting A2A tasks as an extension", as AAIF proposal #37 claims? I found none in the repo or the docs.
- What do the ext-tasks repository (github.com/modelcontextprotocol/ext-tasks) and the MCP Agents WG / Agents Interest Group pages say about agent-to-agent use? Not read.
- Which A2A spec version did A2ABreak (2609.10871) model: v0.3 or v1.0? Do any of its 11 vulnerabilities apply to v1.0.0 as tagged? Check the PDF.
- Peer-review status of 2503.13657 (MAST) and 2512.08296 (scaling agent systems): the arXiv pages show no venue. Check the NeurIPS 2025 and ICLR 2026 proceedings.
- Why does @a2a-js/sdk show 8.1M weekly downloads with 656 GitHub stars? Check npm dependents to see whether it is a transitive dependency of a popular framework.
- Salesforce Agentforce A2A: find the current primary documentation URL.
- Google Agentspace vs Gemini Enterprise: find the primary source for the rename date.
- The AAIF blog is dated 2026-08-17 but the A2A blog is dated 2026-08-27. Was there an earlier formal acceptance date (proposal closed 2026-08-04)? Which date should we cite as "joined AAIF"?
- What does the A2A TSC "steady state" composition look like? Inception plus 18 months would be about December 2026, if inception is 2025-06-23. Not yet documented on `main` as of 2026-10-27.
