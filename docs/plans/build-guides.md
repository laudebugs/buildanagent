# Plan: research and write three guides, to building an agent SDK, a harness and an agent (Round G)

- **Status:** In progress
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): very deep research into creating an SDK, a harness and an agent, then documentation for each
- **Builds on:** the [research report](../research/agent-sdks-and-harness-design.md), the [harness teardown](../research/harness-architectures.md), the four [SDK references](sdk-references.md) and the [deep comparison](sdk-comparison.md)
- **Todos:** Round G on the [todo board](../todos/README.md); §5 lists them.

## 1. Goal

Before we build our own stack, we write down how to build each layer well, from evidence. Each layer gets a research round and then a guide:
- **G1 An agent SDK:** the library layer: the model gateway and provider abstraction, the agent loop, tool definitions and schemas, streaming events, hooks, the test model, and the public API's shape and versioning.
- **G2 An agent harness:** the runtime around the loop: sessions and their storage, compaction and context policy, the tool registry and MCP, permissions and approvals, sandboxing, extensions, interfaces (SDK, CLI, RPC), observability and evals.
- **G3 An agent:** one product built on the harness: choosing the task, the tools and their contracts, the system prompt and skills, the safety gates, the eval suite, and shipping and operating it.

## 2. The three layers, defined

The guides share one vocabulary, set here so G1–G3 never blur it:
- **An agent SDK** is a library a developer imports to run a model-and-tools loop: pi-ai plus pi-agent-core, or the OpenAI Agents SDK.
- **An agent harness** is the runtime that hosts that loop for real work: sessions, tools, safety, interfaces. Pi's coding agent and Claude Code are harnesses.
- **An agent** is a product with one job, built on a harness: the support-triage agent in every capstone.

## 3. How each research round works

Each research todo (G1a, G2a, G3a) runs the deep-research process, the same one behind the [research report](../research/agent-sdks-and-harness-design.md):
1. **Split the question** into 4–6 independent subtopics, and research each in parallel.
2. **Prefer primary sources:** the source code of the four SDKs we already verified (cloned at their pinned tags), plus Codex, OpenHands and mini-swe-agent; papers; and vendor engineering posts. Read code where the docs are thin.
3. **Record every claim with its source** in `docs/research/<layer>/notes/`, and mark secondary sources as such.
4. **Synthesize** into `docs/research/<layer>/<layer>-research.md`, then fact-check it the way the research report was checked, logging corrections.

Each guide todo (G1b, G2b, G3b) then writes `docs/guides/<layer>.md` from that research. Drafting uses `/anthropic-skills:writing`, review uses `/anthropic-skills:writing-review`, and every changed claim is re-checked before the push. Each guide ends with a reference architecture and the decisions it leaves open for Round P.

## 4. Research questions

**G1a, agent SDK:**
- How do the four verified SDKs and pi-ai structure provider abstraction, streaming and cross-provider message conversion?
- What loop shapes exist (in-process, subprocess, durable), and what does each cost in control, testability and safety?
- How should tools be defined (Zod, TypeBox, JSON Schema), validated and executed in parallel?
- Which hook points and event streams do callers need, and how do the SDKs version them?
- What makes an SDK testable offline (faux providers, mock models, recorded fixtures)?

**G2a, agent harness:**
- How do session formats compare (JSONL trees, event logs, SQLite, durable objects), and which support branching and replay?
- Which compaction strategies work, and how do the harnesses decide when to compact?
- How do permission models compare (Claude's six steps, Codex's sandbox and approval policies, Pi's extension gate), and what do sandboxes cost?
- How should a harness expose itself: SDK, CLI, JSONL RPC, server?
- What observability and eval design does a harness need (OpenTelemetry GenAI spans, Inspect, pass^k)?

**G3a, agent:**
- How do teams pick an agent's scope, and when is a workflow better than an agent?
- How should tool contracts, system prompts and skills be written and tested?
- Which evals catch regressions before release, and which signals matter in production?
- What safety gates does a deployed agent need, and how are they reviewed?

## 4b. Practitioner research from Hacker News (Round H, added 2026-11-18)

The owner asked to add what developers themselves report about building agents. Round H covers the 18 months from 2025-05-18 to 2026-11-18: what works for them, what fails, what they think agents should do, how documentation helps or hurts, and how they build. The vendor docs and papers behind G1a–G3a show how agents are meant to work; Hacker News threads show how they work for the people who build with them. The round runs before the guides, so G1b–G3b can weigh both.

- **H1 Corpus.** A script, `scripts/hn-corpus.mjs`, queries the public HN Algolia API (`hn.algolia.com/api/v1`) with fixed search terms, such as agent, agentic, coding agent, MCP, Claude Code, Codex, Cursor, LangChain, AI SDK, "agent harness" and evals. It keeps stories above a points threshold and fetches their comment trees, writing the raw corpus to a gitignored folder. The committed output is `docs/research/practitioners/corpus.md`: each thread's id, link, title, date, points and comment count, plus the query that found it, so the corpus can be regenerated and audited. Comments are third-party writing, so the repo stores links and short quoted excerpts with attribution, never full dumps.
- **H2 Themes.** Six themes are analysed in parallel, each into `docs/research/practitioners/notes/<theme>.md`:
  1. what works in practice;
  2. what fails, and the failure modes developers name;
  3. opinions on specific harnesses and SDKs (Claude Code, Codex, Cursor, Pi, OpenAI and Vercel SDKs, LangChain and others);
  4. documentation and developer experience;
  5. reliability, evals, cost and context management;
  6. security incidents and safety practice, and building your own versus adopting a framework.

  Each claim cites a thread or comment link and a date. Each note separates widely shared views (many independent commenters) from single anecdotes, and records disagreement.
- **H3 Synthesis.** `docs/research/practitioners/practitioner-research.md` sets practitioner experience against the vendor and paper evidence in G1a–G3a, and states where they agree and where they conflict. It also records how the views shifted over the 18 months. A fact-check log re-checks the quoted claims against the threads.

Risks: HN skews toward coding agents and toward strong opinions. The synthesis must name that sampling bias, weigh views by how many independent commenters hold them, and never present one comment as a consensus.

## 5. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| G1a | Deep research: building an agent SDK (done) | K2 |
| H1 | Practitioner research: collect the Hacker News corpus (2025-05-18 to 2026-11-18) | None |
| H2 | Practitioner research: analyse six themes in parallel | H1 |
| H3 | Practitioner research: synthesis and fact-check, set against G1a–G3a | H2, G3a |
| G1b | Guide: building an agent SDK | G1a, H3 |
| G2a | Deep research: building an agent harness (done) | G1a |
| G2b | Guide: building an agent harness | G2a, G1b, H3 |
| G3a | Deep research: building an agent | G2a |
| G3b | Guide: building an agent | G3a, G2b, H3 |

## 6. Risks

- **Network limits.** The earlier research lost primary sources to this environment's network policy. Mitigation: prefer cloned source code and mirrored docs, and ask the owner to allow specific hosts when a key source is blocked.
- **Overlap between layers.** Compaction or tools could appear in all three guides. Mitigation: §2's definitions decide which guide owns each topic; the others link to it.

## 7. Open questions

- Should the guides target TypeScript only, like the references? Current answer: yes, unless the research shows a strong reason for another language in one layer.
