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

### U5: Server-side rollback for agent tool calls (added 2026-11-18)

The owner asked how an API backend should make each agent tool call safe to fail, retry or reverse, with a short .NET section. U5 researched it in three parts: one transaction per tool call and idempotency keys, temporal tables and event sourcing, and what a tool returns to the model after a rollback. [`server-rollback.md`](../research/reversible-actions/server-rollback.md) recommends one transaction per tool call with an idempotency row keyed on tenant, session, branch and tool call id, side effects after commit or through an outbox, and reversal as a compensating write. Its fact-check is [`fact-check-server-rollback.md`](../research/reversible-actions/fact-check-server-rollback.md).

### U6: Sagas for multistep agent actions (added 2026-11-18)

The owner asked how sagas and compensation work for agent actions that span several systems, such as updating an order, refunding and emailing. U6 compared Temporal (.NET and TypeScript), MassTransit, NServiceBus, Azure Durable Functions, Dapr Workflow and AWS Step Functions in three parts, plus approval placement and outcome reporting. [`sagas.md`](../research/reversible-actions/sagas.md) finds that only MassTransit's routing slips run compensation for you, puts compensable steps before the refund as the pivot and retryable steps after it, recommends one approval before the first step, and proposes a typed outcome. Its fact-check is [`fact-check-sagas.md`](../research/reversible-actions/fact-check-sagas.md).

### U7: Agent rewind versus data rollback (added 2026-11-18)

The owner asked how LangGraph checkpoints and time travel, Pi session forks, Claude Code checkpoints and rewind, and ADK session rewind work, why they don't undo external writes, and what our SDKs and plans expose, ending with a recommendation for the triage agent. U7 researched it in two parts and built on U4–U6. [`rewind-vs-rollback.md`](../research/reversible-actions/rewind-vs-rollback.md) finds that every rewind restores only state its framework owns and that neither the SDKs nor our plans roll back external data. It recommends undo windows for triage writes and internal notes, approval first for escalations, replies and refunds, a saga only once refunds open, and rollbacks logged as new linked entries with an outcome on every write. Its fact-check is [`fact-check-rewind.md`](../research/reversible-actions/fact-check-rewind.md); the plan changes it implies are open for the next phase.

### U8: Copilot diff review and confirm (added 2026-11-18)

The owner asked whether GitHub Copilot keeps a copy of the change it is about to commit, edits that copy, and lets the user confirm or reject the diff. U8 checked the VS Code source and docs and the Copilot CLI, SDK runtime, Visual Studio, JetBrains and cloud agent. [`copilot-diff-review.md`](../research/agent-ui/copilot-diff-review.md) finds that every local Copilot surface writes first and keeps the pre-edit text for review; only the runtime's per-call `write` permission request and the cloud agent's draft pull request hold a change back.

### U9: 12-factor agents (added 2026-11-18)

The owner asked what in humanlayer's [12-factor agents](https://github.com/humanlayer/12-factor-agents) is relevant for us. U9 read the essay at commit `d20c728` and mapped each factor onto our guides, plans and ADRs. [`twelve-factor-agents.md`](../research/external-designs/twelve-factor-agents.md) finds that the essay, which offers no measured evidence, confirms our core design (we align with 8 factors and partly with 4) and exposes one gap: how ticket and approval events reach the agent. Its five proposed plan changes are open for the next phase. Its fact-check is [`fact-check-twelve-factor-agents.md`](../research/external-designs/fact-check-twelve-factor-agents.md).

### U10: Strands harness SDK (added 2026-11-18)

The owner asked whether we had looked at [strands-agents/harness-sdk](https://github.com/strands-agents/harness-sdk); we had seen Strands only through unverified summary notes. U10 read the source at commit `84d814b` and the 0.4.0 release, and compared it with our harness plan and our eight verified SDKs. [`strands-harness-sdk.md`](../research/external-designs/strands-harness-sdk.md) finds that the repo is the whole Strands monorepo and that `createHarness()` is a thin factory over the SDK's `Agent`, with good interfaces and permissive defaults. It lists what our harness should copy and avoid, and recommends Strands as a ninth verified reference pinned from 2026-11-20. Its fact-check is [`fact-check-strands-harness-sdk.md`](../research/external-designs/fact-check-strands-harness-sdk.md); the earlier Strands claims are re-checked in the main report's fact-check log.

### U11: Portable agents and cloud coding (added 2026-11-18)

The owner wants the SDK and harness to deploy anywhere (Cloudflare, AWS, GCP, Azure, Vercel) with a bring-your-own model key, asked about a cloud coding agent like Claude Code on the web, and asked whether WebContainers could host agents. U11 found that the SDK already travels and the harness is tied to one host in six places. Two of the seven seams it needs already exist as interfaces in the harness plan; the others, led by `Scheduler.wake`, are new. It ranks hosted sandboxes (E2B, then Cloudflare Sandbox, then Vercel Sandbox) against our three hard rules, describes a cloud coding agent as a control plane around a disposable VM, keeps WebContainers to a relayed interactive backend, and proposes fifteen plan changes for the owner. A companion note, [storage-and-wake.md](../research/deployment/storage-and-wake.md), defines the storage-and-wake problem behind the seams. The round also corrected R1's Daytona isolation claim in the [harness fact-check](../research/agent-harness/fact-check.md).

### U12: Agent-building platforms (added 2026-11-18)

The owner proposed an agent that builds agents: a platform that turns a description into an agent, tests it, and deploys it to the user's own cloud with the user's own model key. U12 mapped what vendor platforms, low-code builders, developer hosting platforms and agent-generation research offer as of November 2026. Every builder now generates agents from a description, but almost all of them emit vendor configuration for their own runtime. Code the user owns is rare, no builder deploys to Cloudflare Workers or Vercel, and no product tests a generated agent before showing it. Approvals are unsigned everywhere, and no product undoes side effects. The report recommends a first slice: one agent type with approval-gated writes, generated against the verified Cloudflare `agents` 0.33.0, checked by our verification corpus before the first deploy, and deployed into the user's Cloudflare account under their own key. Opening a plan for that slice is an owner decision.

### U13: Job search agent (added 2026-11-18)

The owner asked how to automate a whole job search, from a friend who uses Muse to connect her email, draft replies and keep a job-search tracker, and who wanted recruiter emails from Apollo and help on LinkedIn. U13 found that an agent can automate almost every step, but sending a message and submitting an application each need the person's approval: LinkedIn's User Agreement, Indeed's terms, Google's restricted Gmail scopes, email law and seekers' own trust all draw the line there. No API lets a seeker's agent submit an application, so the agent prepares application packets that the person submits on the employer's application page. The recommended first slice discovers roles from public Greenhouse, Lever and Ashby boards, reads mail through Outlook or forwarded mail, keeps an approval outbox, and tests against injected postings and emails; it leaves out LinkedIn automation, cold outreach to looked-up addresses, auto-submission and Gmail reading.

### U14: Agent connectors (added 2026-11-18)

The owner asked how other agent platforms offer connectors (integrations a user adds so the agent can read and act in other apps) and whether we already have them. U14 surveyed ten platforms, the MCP 2026-07-28 authorization and security model, and the infrastructure we could buy or build on, and mapped our own plans. Our harness plans an MCP client but no connector: no catalog, no per-user OAuth, no token vault, no pinning of tool definitions. The report recommends a connector that is a catalog record for a remote MCP server with pinned tool definitions, per-user OAuth following the 2026-07-28 revision with a legacy fallback, tokens in a host-side vault that feeds the HD15 credential proxy, and write tools that ask before they act, built on open-source kits with self-hosted Nango and Arcade as fallbacks. It lists fifteen plan changes and todos for the owner to decide.

### U15: Browser use (added 2026-11-18)

The owner asked how our agents will handle tasks that need a web browser. U15 found that they can do so without changing the architecture we accepted: the loop and every credential stay outside the sandbox, and the browser's traffic leaves through the same egress allowlist as `bash`. [`browser-use.md`](../research/browser-use/browser-use.md) recommends a logged-out headless Chromium inside the coding agent's existing sandbox, used to check its own UI work, and a hosted browser over a CDP WebSocket for open-web browsing and the platform's agents, behind one `BrowserProvider` seam. As of November 2026 that means Cloudflare Browser Run on Cloudflare, AgentCore Browser on AWS, and Browser Run over CDP from Vercel. The model should see accessibility snapshots, with screenshots only on request. Prompt injection from web content is unsolved, so the allowlist and the absence of credentials are the boundary, not the model, and only self-hosted, deterministically graded suites such as WebArena-Verified can gate a release. The report proposes seventeen changes for the owner (U16 later added an eighteenth), led by ADR 0045 and a fix to the Cloudflare sandbox backend (N46b), without which no HTTPS request leaves the sandbox. Its fact-check is [`fact-check-browser-use.md`](../research/browser-use/fact-check-browser-use.md).

### U16: Watch and take over the browser (added 2026-11-19)

The owner asked whether "a user can stream the agent's browser, watch it and take over". Hosted browsers already ship live view and handoff, but the in-sandbox browser that U15 recommends for the coding agent has neither. U16 adds a section to [`browser-use.md`](../research/browser-use/browser-use.md#the-owner-can-watch-and-take-over-the-in-sandbox-browser-through-the-tasks-durable-object-which-on-cloudflare-opens-no-sandbox-port): the task's Durable Object would hold the CDP connection, relay screencast frames to each viewer and send input from the person in control back, so on Cloudflare the sandbox would open no port. On E2B the viewer relay would need a token-guarded URL, and on Vercel an outbound connection or an authenticating proxy. Takeover would be a tool call that pauses the turn and returns a fresh accessibility snapshot. The model would never see what the person in control typed, and nobody would sign in during an in-sandbox takeover. Viewers would join with short-lived, single-use tickets enforced in the Durable Object, and each ticket mint, join and leave would go into the session log. Open problem 8 keeps four questions open, led by one risk: on the report's reading Chromium's debugging port has no authentication, so another sandbox process could open its own CDP session during a takeover. The report proposes the viewer relay as change 18; its claims are logged in [`fact-check-browser-use.md`](../research/browser-use/fact-check-browser-use.md).

### U17: Source update for the main report (added 2026-11-19)

The first research round could not fetch many of its seed sources, and the main report leaned on search summaries for what they covered. Building on R1's re-verification, U17 read fourteen URLs the owner chose against [the main report](../research/agent-sdks-and-harness-design.md): ten seeds the custom-harness notes list as unfetched, Anthropic's MCP launch post, pages from Mastra and Langfuse on two blocked frameworks seed hosts, and the SWE-bench docs. Other seeds stay unread, among them aiagent.org, six planning blogs and gotburnout.io, so the first round's gap is narrower but still open. None of the fourteen reverses a conclusion: eight of the seeds are vendor pages or explainers, and three of them describe MCP transports and sessions that the 2026-07-28 revision removed or deprecated. The useful findings came from the primary sources those pages pointed to. The MCP 2026-07-28 changelog deprecates Roots, Sampling and Logging and replaces server-initiated requests with `input_required` results, which the MCP client todos N24 and N25 do not yet handle. Two studies found through a vendor page, MAP (ICML 2026) and CLEAR, back the step caps, human gates and pass^k-plus-cost evals we already plan. [`source-update-2026-11-19.md`](../research/source-update-2026-11-19.md) ends with a table of seven proposed plan changes, four of which need the owner's decision. Its claims are logged in [`fact-check-source-update-2026-11-19.md`](../research/fact-check-source-update-2026-11-19.md), and its per-source evidence is in [the notes](../research/notes/source-update-2026-11-19.md).

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
| U5 | Research server-side rollback for agent tool calls (done: [server-rollback.md](../research/reversible-actions/server-rollback.md)) | None |
| U6 | Research sagas and compensation for multistep agent actions (done: [sagas.md](../research/reversible-actions/sagas.md)) | None |
| U7 | Research agent rewind versus data rollback, and recommend rollback for the triage agent (done: [rewind-vs-rollback.md](../research/reversible-actions/rewind-vs-rollback.md)) | U6 |
| U8 | Research whether Copilot holds a copy of a change for confirm or reject (done: [copilot-diff-review.md](../research/agent-ui/copilot-diff-review.md)) | U4 |
| U9 | Research 12-factor agents and what is relevant for our stack (done: [twelve-factor-agents.md](../research/external-designs/twelve-factor-agents.md)) | None |
| U10 | Research the Strands harness SDK against our design (done: [strands-harness-sdk.md](../research/external-designs/strands-harness-sdk.md)) | U9 |
| U11 | Research portable deployment and cloud coding agents (done: [portable-agents.md](../research/deployment/portable-agents.md)) | U10 |
| U12 | Map the agent-building platform market (done: [agent-building-platforms.md](../research/deployment/agent-building-platforms.md)) | U11 |
| U13 | Research a job search automation agent (done: [job-search-agent.md](../research/agents/job-search-agent.md)) | U12 |
| U14 | Research connectors for our agents and platform (done: [agent-connectors.md](../research/connectors/agent-connectors.md)) | U12 |
| U15 | Research browser use for our agents (done: [browser-use.md](../research/browser-use/browser-use.md)) | U12 |
| U16 | Research watching and taking over the agent's browser (done: [browser-use.md](../research/browser-use/browser-use.md#the-owner-can-watch-and-take-over-the-in-sandbox-browser-through-the-tasks-durable-object-which-on-cloudflare-opens-no-sandbox-port)) | U15 |
| U17 | Read fourteen owner-chosen sources, most of them unfetched seeds, against the main report (done: [source-update-2026-11-19.md](../research/source-update-2026-11-19.md)) | R1 |
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
