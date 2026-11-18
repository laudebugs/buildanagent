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

## 5. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| G1a | Deep research: building an agent SDK (done) | K2 |
| G1b | Guide: building an agent SDK | G1a |
| G2a | Deep research: building an agent harness | G1a |
| G2b | Guide: building an agent harness | G2a, G1b |
| G3a | Deep research: building an agent | G2a |
| G3b | Guide: building an agent | G3a, G2b |

## 6. Risks

- **Network limits.** The earlier research lost primary sources to this environment's network policy. Mitigation: prefer cloned source code and mirrored docs, and ask the owner to allow specific hosts when a key source is blocked.
- **Overlap between layers.** Compaction or tools could appear in all three guides. Mitigation: §2's definitions decide which guide owns each topic; the others link to it.

## 7. Open questions

- Should the guides target TypeScript only, like the references? Current answer: yes, unless the research shows a strong reason for another language in one layer.
