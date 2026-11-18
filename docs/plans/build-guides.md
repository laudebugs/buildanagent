# Plan: research and write three guides, to building an agent SDK, a harness and an agent (Round G)

- **Status:** Done (2026-11-18): research rounds G1a–G3a, H and R1, and the three guides in `docs/guides/`
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

## 4c. Re-verify secondary claims against primary sources (R1, added 2026-11-18)

The early research ran when this environment's network policy blocked many primary hosts. Those included arxiv.org, openai.github.io, developers.cloudflare.com, modelcontextprotocol.io, opentelemetry.io and OWASP, so about 127 claims across 22 files are marked "(secondary)" or "search summary". On 2026-11-18 a curl check from this session reached almost all of these hosts; openai.com and platform.openai.com still return 403. The owner asked to re-check the marked claims before the guides cite them. R1 fetches each primary source with curl, which returns the raw page rather than a summary. For each claim it confirms it, corrects it, or records that it is still unreachable. Confirmed claims lose the secondary mark and gain a primary citation. Every change gets a row in the matching fact-check log, under a section headed "Re-verification against primary sources (R1)". Superseded working notes in `docs/research/notes/` are checked only where the main report relies on them.

## 4d. Research how agent UIs are built (U1, added 2026-11-18)

The owner observed that most agents present their UI state as a chat transcript that renders the UI, and asked for deep research into the approaches taken so far and how the libraries we verified implement their UIs. U1 ran the deep-research process in five parallel parts: UI protocols (AG-UI, A2UI, MCP Apps, the Apps SDK and ChatKit, A2A), web frameworks (AI SDK UI, CopilotKit, assistant-ui, LangGraph `useStream`, Cloudflare `useAgentChat`, `adk web`), the UI contracts of our eight SDKs read from their pinned `.d.ts` files, terminal and editor UIs (Claude Code, Codex, Pi, OpenCode, Gemini CLI, ACP, VS Code's Agent Host Protocol), and patterns beyond chat. The notes, the synthesis and its fact-check are in [`docs/research/agent-ui/`](../research/agent-ui/). Its conclusion for our harness (treat the session event log as the UI contract, translate it to existing UI streams, keep approvals durable) feeds the build phase; the harness and agent plans can adopt it as a follow-up.

### U2: Vercel Labs' UI SDK (added 2026-11-18)

The owner next asked about Vercel Labs' UI SDK ([ui-sdk.dev](https://ui-sdk.dev/), [vercel-labs/ui](https://github.com/vercel-labs/ui)), a headless library of UI behaviors meant for agents. U2 researched it in two parts: the library itself, and the headless libraries and agent-facing UI tooling around it. [`vercel-ui-sdk.md`](../research/agent-ui/vercel-ui-sdk.md) builds on U1, and its fact-check shares U1's log.

### U4: Undo for agent edits in UIs (added 2026-11-18)

The owner asked how a UI can make an agent's edits undoable. U4 researched it in three parts: UI SDK's change callbacks and history, undo in client state libraries (Yjs, Immer, TanStack Query, NgRx and signal stores), and the Keep/Undo and undo-toast patterns agent products ship. [`undo-agent-edits.md`](../research/agent-ui/undo-agent-edits.md) recommends tagging every write with its actor and turn, keeping agent writes as a real draft until a person keeps them, and reverting by inverse operations that preserve later human edits.

### U3: hashbrown (added 2026-11-18)

The owner asked how hashbrown ([hashbrown.dev](https://hashbrown.dev/), [liveloveapp/hashbrown](https://github.com/liveloveapp/hashbrown)) implements its work. U3 researched it in two parts, its source-level implementation at v0.8.3 and its usage, adapters and position among agent UI approaches. [`hashbrown.md`](../research/agent-ui/hashbrown.md) finds that it uses strict structured output over AG-UI as the generative-UI boundary: the model picks registered components and fills their props, and the browser renders only what was registered.

## 5. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| G1a | Deep research: building an agent SDK (done) | K2 |
| H1 | Practitioner research: collect the Hacker News corpus (2025-05-18 to 2026-11-18) (done) | None |
| H2 | Practitioner research: analyse six themes in parallel (done) | H1 |
| H3 | Practitioner research: synthesis and fact-check, set against G1a–G3a (done) | H2, G3a |
| R1 | Re-verify the "(secondary)" claims against primary sources (done) | H3 |
| U1 | Research how agent UIs are built, and how our eight SDKs expose UI contracts (done: [agent-ui/](../research/agent-ui/)) | None |
| U2 | Research Vercel Labs' UI SDK and the agent-facing UI tooling around it (done: [vercel-ui-sdk.md](../research/agent-ui/vercel-ui-sdk.md)) | U1 |
| U4 | Research how a UI makes an agent's edits undoable (done: [undo-agent-edits.md](../research/agent-ui/undo-agent-edits.md)) | U2 |
| U3 | Research how hashbrown implements generative UI (done: [hashbrown.md](../research/agent-ui/hashbrown.md)) | U2 |
| G1b | Guide: building an agent SDK (done: [docs/guides/agent-sdk.md](../guides/agent-sdk.md)) | G1a, H3, R1 |
| G2a | Deep research: building an agent harness (done) | G1a |
| G2b | Guide: building an agent harness (done: [docs/guides/agent-harness.md](../guides/agent-harness.md)) | G2a, G1b, H3 |
| G3a | Deep research: building an agent (done) | G2a |
| G3b | Guide: building an agent (done: [docs/guides/agent.md](../guides/agent.md)) | G3a, G2b, H3 |

## 6. Risks

- **Network limits.** The earlier research lost primary sources to this environment's network policy. Mitigation: prefer cloned source code and mirrored docs, and ask the owner to allow specific hosts when a key source is blocked.
- **Overlap between layers.** Compaction or tools could appear in all three guides. Mitigation: §2's definitions decide which guide owns each topic; the others link to it.

## 7. Open questions

- Should the guides target TypeScript only, like the references? Current answer: yes, unless the research shows a strong reason for another language in one layer.
