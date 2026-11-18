# Beyond the chat transcript: agent UI patterns and the evidence on chat (as of November 2026)

*Research notes, fetched 2026-11-18. Vendor docs are primary sources for what a product does, not for whether it works. Essays are marked as opinion. Internal citations point to this repo's Hacker News synthesis ([practitioner-research.md](../../docs/research/practitioners/practitioner-research.md)) and its notes, which were not redone here.*

## Artifacts and canvases: chat beside a live document or app

### Takeaway
The canvas pattern pairs a chat rail with a persistent, editable object (document, code, app), which fixes chat's lack of a "working buffer". By late 2026 Claude's artifacts have grown from side-panel previews into shareable, stateful mini-apps with storage and connectors, so the object, not the transcript, is the product.

### Cited Findings
- Anthropic's help centre (updated November 2026) defines an artifact as "anything Claude makes for you that you'd put in front of someone: a design, a deck, a document, a dashboard, or a small interactive tool." — [Claude Help Center](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- The same page says artifacts can read from and write to connected apps (Asana, Google Calendar, Slack), store data between sessions (default limit 100 MB and 25,000 documents), accept file uploads, and let viewers interact with Claude through them; it calls artifacts made before 16 September 2026 "legacy artifacts", which indicates a redesign that month. Artifacts are also available in Claude Code. — [Claude Help Center](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- Google's Gemini Canvas is marketed as a space where you "describe your idea and watch Canvas generate the code that brings your idea to life as a working, shareable app or game." — [gemini.google Canvas page](https://gemini.google/overview/canvas/) (marketing page)
- Opinion: Amelia Wattenberger argues chat responses are "isolated": after successive rewrites, "it's laborious to figure out what concretely has changed", and calls the lack of a "working buffer" "a complete non-starter" for editing code or prose. — [Wattenberger, "Why Chatbots Are Not the Future"](https://wattenberger.com/thoughts/boo-chatbots) (essay, 2023)
- Opinion: Wattenberger also frames craft as alternating implementation and evaluation, which a turn-based transcript does not support well. — [Wattenberger](https://wattenberger.com/thoughts/boo-chatbots)
- In the HN corpus, about 7 authors say only the artifact matters, not the stream, while ~45 want to see what the agent does; the notes read the split as tracking the reader (steering mid-task vs reviewing the output). — [docs-and-dx note](../../docs/research/practitioners/notes/docs-and-dx.md#practitioners-want-to-see-what-the-agent-is-doing-and-treat-hiding-it-as-a-regression)

### Inferences
- Canvases solve the "diff between turns" and "where is the current version" problems, and the 2026 artifact design adds state and data access, so artifacts now overlap with generative UI and with embedded apps (MCP Apps, below).
- Once an artifact holds data and is shared, the UI needs its own versioning, permissions and state-sync story separate from the chat log.

### Gaps
- ChatGPT Canvas: help.openai.com returned an empty body (403-style block), so no primary description was fetched; its features are not cited here.
- v0, Bolt and Lovable preview UIs were not fetched; no primary source on their chat-plus-preview layouts or reported limits.
- The original Claude Artifacts launch post (anthropic.com/news/artifacts) rendered without text; launch date and original scope are not cited.
- No controlled study found comparing canvas vs pure chat for editing tasks.

## Background and asynchronous agents: the output is a branch, PR or report

### Takeaway
Every major coding vendor now ships a cloud agent whose unit of work is a task or session that runs in its own VM and ends in a branch or pull request, with the transcript demoted to a log. By November 2026 the convergence is on sessions that move between web, mobile, IDE and CLI, plus "artifacts" (screenshots, videos, logs) as proof of work; the binding constraint practitioners report is human review capacity.

### Cited Findings
- Claude Code cloud sessions run on Anthropic-managed (or self-hosted) infrastructure, "keep running after you close your laptop", can be started from web, mobile, desktop and scheduled tasks, push branches, and offer auto-fix for pull requests; GitHub credentials stay on Anthropic's servers and are attached by a proxy rather than entering the VM. — [Claude Code docs, cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web)
- The same page distinguishes cloud sessions from Remote Control, which lets a phone or browser steer a session still running on the user's machine, and describes "projects" in which Claude starts and tracks many cloud sessions for one body of work. — [Claude Code docs](https://code.claude.com/docs/en/claude-code-on-the-web)
- GitHub's docs (Nov 2026) describe "Copilot in the cloud": sessions that "continue seamlessly" across the Copilot app, IDE, mobile and CLI; Copilot can "research a repository, plan changes, and implement them in the background", and the user reviews changes before a PR is created. Cloud-sandbox sessions can span repositories; Actions-based sessions are single-repo and retain chat data 28 days. — [GitHub Docs, Copilot on GitHub.com and Mobile](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) (the old "about coding agent" URL now redirects here; the sidebar lists "Rationale, confidence, and approvals", "Steer agents" and "Steer a session remotely")
- Cursor's Cloud Agents ("formerly called Background Agents") clone the repo into a VM, work on a separate branch, can run "as many agents as you want in parallel", can be launched from Slack, produce "merge-ready PRs with artifacts" (screenshots, videos, logs), and let the user take over the agent's remote desktop and hand control back. A run's URL can be shared with teammates. — [Cursor Docs, Cloud Agents](https://cursor.com/docs/cloud-agent)
- OpenAI's Codex cloud page says each task "has its own workspace and can keep working while your computer is asleep"; the user inspects changed files, requests follow-ups, and commits or opens a PR. — [OpenAI Developers, Codex cloud](https://developers.openai.com/codex/cloud)
- Google's Jules runs in a VM, generates a plan the user reviews and approves "before any code changes are made", and supports scheduled and suggested tasks and notifications. — [Jules docs](https://jules.google/docs/)
- Devin's docs call it "a conversational user interface" but expose a shell, an embedded IDE the user can take over, progress steps, and Slack/Teams tagging. — [Devin docs](https://docs.devin.ai/get-started/devin-intro)
- Practitioners: ~190 authors across ~115 HN threads describe review burden and "babysitting" as the most shared cost; ~225 authors discuss parallel agents in worktrees, and successful users cap themselves at about two to six sessions. — [what-fails note](../../docs/research/practitioners/notes/what-fails.md#review-burden-and-babysitting-are-the-most-widely-shared-cost-of-using-agents); [what-works note](../../docs/research/practitioners/notes/what-works.md#parallel-agents-in-worktrees-work-up-to-the-humans-review-capacity-about-two-to-six)
- "I run 5-6 parallel sessions at most, otherwise I can't keep track of what's being done anyway." — guhcampos, [HN](https://news.ycombinator.com/item?id=50373357), 2026-11-05 (via [what-works note](../../docs/research/practitioners/notes/what-works.md))

### Inferences
- The async UI is a task list plus a review surface (diff, PR, artifacts), with chat as a follow-up channel. Its design problem shifts from "conversation" to "review throughput": evidence of verification (tests, screenshots, video) and small diffs matter more than transcript fidelity.
- Session portability (start on phone, continue in CLI) requires the session to be a server-side object with an event log, not a client-held transcript.

### Gaps
- No vendor publishes merge rates or review-time data for these UIs that I could fetch; effectiveness claims are vendor or practitioner-reported only.
- Codex cloud page details beyond the marketing steps were not extracted (the page is heavily client-rendered).

## Ambient and embedded agents, agent inboxes and notifications

### Takeaway
"Ambient" agents are triggered by events rather than chat messages and surface to the human only to notify, ask or request review, usually through an inbox. LangChain's Agent Inbox standardises this as a typed interrupt schema with four response types; in-app copilots (CopilotKit, AG-UI) instead share state with the host app.

### Cited Findings
- Harrison Chase (LangChain, 14 Jan 2025): ambient agents "listen to an event stream and act on it accordingly", are not necessarily fully autonomous, and use three human-in-the-loop patterns: notify, question and review. — [LangChain blog, "Introducing ambient agents"](https://blog.langchain.com/introducing-ambient-agents/) (vendor blog)
- LangChain's Agent Inbox connects to a LangGraph deployment, fetches interrupts and sends responses; each interrupt carries an `action_request` and a config with `allow_ignore`, `allow_respond`, `allow_edit` and `allow_accept`, and the human replies with `accept`, `ignore`, `response` or `edit`. — [langchain-ai/agent-inbox README](https://github.com/langchain-ai/agent-inbox)
- GitHub Copilot cloud agent integrates with Slack, Teams, Jira, Linear and Azure Boards (per the docs sidebar), and Cursor and Devin accept tasks from Slack — the agent embeds in existing work tools rather than a dedicated chat. — [GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent); [Cursor Docs](https://cursor.com/docs/cloud-agent); [Devin docs](https://docs.devin.ai/get-started/devin-intro)
- CopilotKit's docs offer "Shared State", "a two-way connection between your UI and agent state", alongside frontend tools, human-in-the-loop and generative UI. — [CopilotKit docs, Shared State](https://docs.copilotkit.ai/langgraph/shared-state)
- Opinion: Austin Henley (Microsoft, 2023) argues that relying on natural language "puts all the burden on the user to articulate good questions" and proposes apps that use context to suggest next steps, adapt toolbars or explain a pointed-at region. — [Henley, "Natural language is the lazy user interface"](https://austinhenley.com/blog/naturallanguageui.html)
- Opinion: Maggie Appleton calls the chatbot "the lazy solution" and sketches "daemons", background characters in a writing tool that highlight a sentence and suggest a revision, which fade if ignored. — [Appleton, "Language Model Sketchbook, or Why I Hate Chatbots"](https://maggieappleton.com/lm-sketchbook) (essay, c. 2023)

### Inferences
- An inbox turns the human into an approver of discrete, typed decisions; this scales across many agents better than reading transcripts, but each interrupt must carry enough context to decide without opening the run.
- The interrupt schema (accept / edit / respond / ignore) maps directly onto the approval policy layer in this repo's reference architecture.

### Gaps
- Notion, Linear and Figma agents were not fetched; no primary description of their embedded-agent UIs is cited.
- No study found measuring notification fatigue or approval accuracy in agent inboxes.

## Generative UI: tool-to-component mapping, declarative specs, model-written UI

### Takeaway
Generative UI spans three levels of model freedom: (1) the app maps a tool result to a pre-built component, (2) the model composes a validated declarative spec from a component catalogue (A2UI), or (3) the model writes HTML/code rendered in a sandbox (MCP Apps, Google's Gemini generative UI). Preference studies favour generative UI over chat for information-dense tasks, but latency, accuracy and injection risks rise with freedom.

### Cited Findings
- Vercel AI SDK defines generative UI as "connecting the results of a tool call to a React component": the model calls a tool, the tool returns data, and the app renders a component. — [AI SDK docs, Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- CopilotKit's docs split generative UI into "Controlled", "Declarative" and "Open-ended" types (navigation labels). — [CopilotKit docs](https://docs.copilotkit.ai/langgraph/shared-state)
- Google's A2UI "expresses UI using data, not code"; a schema "enforces strict capability boundaries", the agent composes from a catalogue of native components, and it targets remote or third-party agents across a trust boundary, rendering natively (Flutter, React, SwiftUI, Compose) without WebViews. — [google/A2UI README](https://github.com/google/A2UI)
- MCP Apps (an MCP extension) lets a tool declare a `ui://` HTML resource that the host renders "in a sandboxed iframe", with bidirectional messaging so the UI can call other tools through the host; it renders inline in Claude, ChatGPT and other compliant clients, and ships a skill to migrate OpenAI Apps SDK apps. — [modelcontextprotocol/ext-apps README](https://github.com/modelcontextprotocol/ext-apps)
- Google Research (18 Nov 2025) describes Gemini 3 Pro generating full web pages, games and tools per prompt; outputs were "strongly preferred" over standard formats in their evaluation, but generation "can sometimes take a minute or more" and has "occasional inaccuracies". — [Google Research blog, Generative UI](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/) (vendor research)
- Chen et al., "Generative Interfaces for Language Models" (ACL 2026 Findings): generated UIs beat chat with "up to a 72% improvement in human preference"; win rate 84.0% vs a Claude 3.7 chat UI; strongest in data analysis (93.8%) and business strategy (87.5%), only 50.0% in advanced AI/ML topics; preferred more for detailed (80%) than concise queries (73%), as simple responses can suffice and GenUI "may introduce unnecessary complexity". Iterative refinement added +14.0% win rate over one-shot. — [arXiv 2508.19227](https://arxiv.org/abs/2508.19227); [HTML v3](https://arxiv.org/html/2508.19227)
- Safety: Simon Willison has 45 posts on exfiltration attacks, including Markdown exfiltration, where injected instructions make the bot render an image whose URL leaks private data. — [simonwillison.net, exfiltration-attacks tag](https://simonwillison.net/tags/markdown-exfiltration/) (secondary, practitioner blog)

### Inferences
- Reliability and safety are inversely related to freedom: tool-to-component mapping cannot render anything unexpected; declarative catalogues constrain layout but allow composition; model-written HTML needs sandboxing, CSP and egress controls because rendering is itself an exfiltration channel.
- The GenUI preference results are pairwise preference ratings, not task-success measurements, and the Google result is a vendor self-evaluation.

### Gaps
- No independent measurement found of malformed-spec or render-failure rates for A2UI or MCP Apps.
- The MCP Apps spec's detailed security requirements (CSP, permission prompts) were not read beyond the README.

## Plans, todos, progress and steering; trace viewers and multi-agent dashboards

### Takeaway
Editable plans before execution and interrupt-and-redirect during execution are the best-evidenced complements to chat: Magentic-UI and Cocoa show measurable gains from co-planning and co-execution, and practitioners converge on plan files reviewed before coding. A CHI 2025 study warns that plausible-looking plans also miscalibrate trust.

### Cited Findings
- Microsoft Research's Magentic-UI (Jul 2025) is an open-source web interface with six mechanisms: co-planning, co-tasking (take over and hand back control), action approval/guards, answer verification, memory and multi-tasking. — [arXiv 2507.22358](https://arxiv.org/abs/2507.22358)
- Magentic-UI rationale: co-planning "front-loads the interaction cost" and resolving misalignment before multi-minute or multi-hour runs is cheaper than correcting it after. — [arXiv 2507.22358 HTML](https://arxiv.org/html/2507.22358)
- On GAIA, a simulated user with side information raised Magentic-UI's task completion from 30.3% to 51.9% (+71%) while being asked for help in only 10% of tasks; a smarter-model simulated user raised it to 42.6%. Caveat: simulated users, GPT-4o agents. — [arXiv 2507.22358 HTML](https://arxiv.org/html/2507.22358)
- Cocoa (CHI 2026) uses a notebook-like collaborative plan where each step can be assigned to user or agent and plans adjust after partial execution; a lab study (n=16) found it "enabled steerability without sacrificing ease-of-use", plus a week-long field deployment (n=7). — [arXiv 2412.10999](https://arxiv.org/abs/2412.10999)
- He et al. (CHI 2025, N=248) studied plan-then-execute agents for daily tasks: they work "when a high-quality plan and necessary user involvement in execution are available", but "users can easily mistrust the LLM agents with plans that seem plausible". — [arXiv 2502.01390](https://arxiv.org/abs/2502.01390)
- Claude Code plan mode is toggled with Shift+Tab, shows "⏸ plan mode on", and offers an approval flow with editing the plan in a text editor. — [Claude Code docs, common workflows](https://code.claude.com/docs/en/common-workflows)
- Jules requires plan approval before code changes. — [Jules docs](https://jules.google/docs/)
- Practitioners: ~400 HN authors across 159 threads mention plan mode or plan files; the recurring pattern is a plan written to a repo file, annotated by the human, and reused as a progress log. — [what-works note](../../docs/research/practitioners/notes/what-works.md#writing-the-plan-to-a-file-before-coding-is-the-most-widely-shared-practice)
- Observability as UI: ~45 authors object to hidden reads, summarised reasoning and opaque subagents; "I do hate how there's no observability into subagents and you just get a summary." — gck1, [HN](https://news.ycombinator.com/item?id=47133556), 2026-02-24 (via [docs-and-dx note](../../docs/research/practitioners/notes/docs-and-dx.md)). The same note reports debugging by reading local transcripts and OTel data rather than LLM-ops products.
- Cursor lets the user take over an agent's remote desktop mid-run; Magentic-UI lets the user manipulate the agent's browser. — [Cursor Docs](https://cursor.com/docs/cloud-agent); [arXiv 2507.22358](https://arxiv.org/abs/2507.22358)

### Inferences
- A plan is a structured, editable artifact that sits between chat and autonomy; making it a file (not a message) makes it survive compaction and serve as the multi-session progress view.
- Plan review should show risk and assumptions, not just steps, given the CHI 2025 trust-miscalibration finding.
- Multi-agent dashboards appear in product docs (Claude Code "projects", Cursor parallel agents, GitHub session management) but I found no study of their usability.

### Gaps
- No primary source fetched for trace viewers marketed as end-user UIs (e.g. LangSmith, Langfuse) in this pass.
- Claude Code's dedicated plan-mode page was client-rendered and yielded no extractable text beyond the workflow page.

## Voice and realtime agent UIs (contrast only)

### Takeaway
Realtime voice agents invert the transcript: turn-taking, barge-in and latency dominate, and the "UI" is audio. They show what chat sacrifices (interruptibility) and what voice sacrifices (reviewability).

### Cited Findings
- OpenAI's Realtime API guide recommends it for voice agents "that need barge-in, low first-audio latency, natural turn taking, and realtime tool use", with WebRTC, WebSocket and SIP connections. — [OpenAI Developers, Realtime](https://developers.openai.com/api/docs/guides/realtime)

### Inferences
- Voice agents need the same plan, approval and transcript-as-record mechanisms out of band (a screen or log), because spoken output cannot be skimmed or diffed.

### Gaps
- Gemini Live API docs page returned no extractable text; not cited.

## Critiques and evidence on when chat works and when it fails

### Takeaway
The critique is consistent from 2023 to 2026: chat has no affordances, puts the articulation burden on the user, isolates responses, and hides system state. The evidence supports a hybrid: chat for underspecified intent and quick follow-ups; structured surfaces (plans, canvases, generated UIs, diffs, inboxes) for information-dense, iterative, high-stakes or parallel work.

### Cited Findings
- Jakob Nielsen (NN/g, 18 Jun 2023) calls generative AI a third UI paradigm, "intent-based outcome specification", that "completely reverses the locus of control"; he says chat UIs "have deep-rooted usability problems", estimates half of rich-country adults are "not articulate enough" to get good results, and predicts hybrid UIs that keep GUI elements. — [NN/g, "AI: First New UI Paradigm in 60 Years"](https://www.nngroup.com/articles/ai-paradigm/) (opinion from a usability authority)
- Microsoft's Guidelines for Human-AI Interaction (Amershi et al., CHI 2019) propose 18 guidelines synthesising more than 20 years of guidance. — [Microsoft Research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
- Opinion: Wattenberger argues a chat box gives "the only clue" that one should type, looks like a search box or login form, and leaves every user to learn prompts; she proposes baking context into controls (sliders, use-case fields). — [Wattenberger](https://wattenberger.com/thoughts/boo-chatbots)
- Opinion: Henley: natural language as the only interface is "lazy"; LLMs should power suggestions and adaptive UI, "not as the only option. Probably not even the main interface." — [Henley](https://austinhenley.com/blog/naturallanguageui.html)
- Opinion: Appleton concedes chat is "flexible, familiar, and easy to implement" but "the lazy solution". — [Appleton](https://maggieappleton.com/lm-sketchbook)
- Evidence that structure beats chat on dense tasks, and chat suffices on simple ones: GenUI preference was lower for concise queries and only 50% in one domain. — [arXiv 2508.19227](https://arxiv.org/html/2508.19227)
- Evidence that human involvement via structured mechanisms helps agents: Magentic-UI +71% completion with a simulated user. — [arXiv 2507.22358](https://arxiv.org/html/2507.22358)
- Practitioner counter-view: some users want only summaries and plans, not the stream ("There is almost no value in watching the stream of intermediate tokens." — perrygeo, [HN](https://news.ycombinator.com/item?id=46983251), 2026-02-12), while others want "all the logs"; a screen-reader user notes collapsed output means no information at all. — [docs-and-dx note](../../docs/research/practitioners/notes/docs-and-dx.md#practitioners-want-to-see-what-the-agent-is-doing-and-treat-hiding-it-as-a-regression)

### Inferences
- Chat works for: ambiguous intent, clarifying questions, one-off Q&A, steering messages to a running agent. Chat fails for: comparing versions, information-dense output, parallel tasks, approvals at scale and long-run status.
- Accessibility cuts against hiding the transcript: any summary-first UI needs a full, linear, screen-reader-friendly log behind it.

### Gaps
- Google PAIR Guidebook pages are client-rendered and returned no text; not cited.
- Linus Lee's essays ("Imagining better interfaces to language models" and others listed at [thesephist.com/posts](https://thesephist.com/posts/)) returned 404 at the guessed URL; titles only confirmed, content not cited.
- NN/g has later AI-agent articles, but the guessed URL 404'd; nothing after 2023 from NN/g is cited.
- No large-scale A/B data from vendors on chat vs non-chat agent UIs was found.

## State sync patterns behind these UIs

### Takeaway
Non-chat agent UIs need the agent's state outside the message list. The patterns seen are: snapshot-plus-JSON-Patch event streams (AG-UI), server-authoritative state broadcast over WebSockets (Cloudflare Agents), resumable streams keyed by ID (Vercel), and server-side sessions resumable across clients (Claude Code, GitHub Copilot).

### Cited Findings
- AG-UI defines state events where a delta "provides a partial update to an agent's state using JSON Patch" (RFC 6902), alongside snapshots and reasoning/thinking message events. — [AG-UI docs, Events](https://docs.ag-ui.com/concepts/events)
- CopilotKit's shared state is a two-way connection between UI and agent state. — [CopilotKit docs](https://docs.copilotkit.ai/langgraph/shared-state)
- Cloudflare Agents' `setState()` saves to SQLite, broadcasts to connected clients and fires `onStateChanged()`; a WebSocket client first receives current state then every update (verified in this repo against 0.33.0). — [repo guide, cloudflare-agents](../../docs/reference/cloudflare-agents/guide.md)
- Vercel's `resumable-stream` wraps SSE streams so a client can resume after losing a connection "or to allow a second client to follow along", using Redis pub/sub, designed for serverless without sticky load balancing. — [vercel/resumable-stream README](https://github.com/vercel/resumable-stream)
- Claude Code cloud sessions and GitHub Copilot cloud sessions are server-side objects that can be resumed and steered from other devices and clients. — [Claude Code docs](https://code.claude.com/docs/en/claude-code-on-the-web); [GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
- Cursor shares a run by URL showing conversation, code changes and artifacts. — [Cursor Docs](https://cursor.com/docs/cloud-agent)
- MCP Apps passes tool data into the iframe UI via host notifications and lets the UI call tools back through the host. — [ext-apps README](https://github.com/modelcontextprotocol/ext-apps)

### Inferences
- An append-only event log (this repo's layer 3) is the common substrate: transcripts, plans, state snapshots and approvals are all projections of it, and resumable streams are replays from an offset.
- Multi-client steering requires a single writer (server) with ordered events; CRDT-style merge is only needed when humans co-edit the artifact itself.

### Gaps
- No primary source fetched on CRDT/multiplayer agent editing (e.g. Liveblocks, Yjs-based AI cursors); that pattern is unconfirmed in these notes.
- The full AG-UI event list did not extract cleanly from the client-rendered docs; only state-delta and reasoning events are confirmed here.
