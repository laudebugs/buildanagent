# Open-Source Agent Harnesses, Harness SDKs, and Harness-Design Research (as of Nov 2026)

> Method note: GitHub repo pages (github.com) were fetched directly and are treated as primary. arxiv.org, alphaxiv.org, huggingface.co, agentpatterns.ai and forums.basehub.com could not be reached from this session (DNS blocked by the session's network allowlist), so paper content comes from search-engine snippets of arXiv/aggregator pages. Treat paper numbers marked "(secondary)" as unverified until checked against the PDF. The `gh` API was also unavailable (repo access not enabled), so stars come from the rendered GitHub pages fetched on 2026-11-18.
>
> Re-verification (R1, November 2026): the marks below that the main report relies on were re-checked against the arXiv PDFs and repos. Confirmed items now cite the primary source; corrections are marked "R1 correction". The full log is in [fact-check-2026-11-18.md](../fact-check-2026-11-18.md#re-verification-against-primary-sources-r1).

## Per-harness architecture: what real open-source harnesses look like

### Takeaway
All requested repos exist. One correction: Goose's canonical repo is now `aaif-goose/goose`, under the Linux Foundation's Agentic AI Foundation. The field has split into a few shapes:
- **SDK/server harnesses:** OpenHands SDK, OpenCode, Cline SDK and DeepSeek Harness each have a headless core with REST/WebSocket or SSE clients.
- **Sandbox-first CLIs:** Codex.
- **MCP-extension hubs:** Goose.
- **Edit-format/repo-map pair programmers:** Aider.
- **Minimal research harnesses:** mini-swe-agent.
- **Gateway-style personal-assistant harnesses:** OpenClaw.

### Cited Findings

**Repo existence check (all verified on github.com, 2026-11-18)**
- OpenHands/software-agent-sdk: exists, MIT, ~1.4k stars, 788 forks — [GitHub](https://github.com/OpenHands/software-agent-sdk)
- anomalyco/opencode: exists, MIT, ~227.6k stars, ~30.9k forks, "The open source coding agent" — [GitHub](https://github.com/anomalyco/opencode)
- deepseek-ai/deepseek-harness: exists, MIT, ~283.1k stars, ~35.1k forks — [GitHub](https://github.com/deepseek-ai/deepseek-harness)
- openai/codex: exists, Apache-2.0, ~135.7k stars, 21.5k forks — [GitHub](https://github.com/openai/codex)
- Goose: the page is at github.com/aaif-goose/goose (fetching block/goose landed there). Apache-2.0, 56.7k stars, 6.6k forks — [GitHub](https://github.com/block/goose)
- Aider-AI/aider: exists, Apache-2.0, 50.2k stars — [GitHub](https://github.com/Aider-AI/aider)
- SWE-agent/SWE-agent: exists, MIT, ~20.8k stars, **maintenance mode** — [GitHub](https://github.com/SWE-agent/SWE-agent)
- SWE-agent/mini-swe-agent: exists, MIT, ~9.7k stars, 1.3k forks — [GitHub](https://github.com/SWE-agent/mini-swe-agent)
- cline/cline: exists, Apache-2.0, ~71.7k stars, 7.9k forks — [GitHub](https://github.com/cline/cline)
- openclaw/openclaw: exists, MIT, ~394.7k stars, ~82.9k forks — [GitHub](https://github.com/openclaw/openclaw)

**OpenHands Software Agent SDK (Python, MIT)**
- Description: "A clean, modular SDK for building AI agents with OpenHands V1."
- Packages: `openhands-sdk`, `openhands-tools`, `openhands-workspace` and `openhands-agent-server`, plus a typed TypeScript client generated from the agent server's OpenAPI contract.
- The agent server exposes REST/WebSocket. Agents run locally or in ephemeral Docker/Kubernetes workspaces.
- Quick-start tools are TerminalTool, FileEditorTool and TaskTrackerTool.
- Source: [GitHub](https://github.com/OpenHands/software-agent-sdk)
- Paper: arXiv 2511.03690, "The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents" (Nov 2025, v2 Apr 2026). It is listed in MLSys 2026 proceedings. — [arXiv](https://arxiv.org/pdf/2511.03690); [MLSys 2026](https://proceedings.mlsys.org/paper_files/paper/2026/hash/8ae9cf363ea625161f885b798c1f1f78-Abstract-Conference.html)
- Event-sourced state (R1: confirmed in the paper, §4.2):
  - It uses an immutable, append-only event log with deterministic replay and recovery to the last processed event.
  - `ConversationState` is the sole mutable component.
  - The paper presents this as a reaction to the monolithic, tightly coupled V0 design.
  - Source: [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §3.2 and §4.2; earlier via [emergentmind summary](https://www.emergentmind.com/papers/2511.03690)
- Condenser: the default `LLMSummarizingCondenser` "has been shown to reduce API costs by up to 2× with no degradation in agent performance". The paper's own source for this is a 2025 All Hands AI blog post by a co-author (Smith, 2025), so the figure is self-reported. — [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §4.6
- Workspace abstraction (secondary): the same agent runs locally or in a remote container "with minimal code changes." — [emergentmind topic](https://www.emergentmind.com/topics/openhands-software-agent-sdk)
- The paper compares 31 features against the OpenAI Agents SDK, Claude Agent SDK and Google ADK (secondary). — [emergentmind topic](https://www.emergentmind.com/topics/openhands-software-agent-sdk)

**OpenCode (anomalyco/opencode; TypeScript on Bun, MIT)**
- Two built-in primary agents, switched with Tab:
  - `build` has full access.
  - `plan` is read-only: it denies file edits and asks before running bash.
- A `general` subagent is invoked with `@general`.
- The repo layout includes `packages/`, `sdks/vscode` and `specs/v2`.
- Source: [GitHub](https://github.com/anomalyco/opencode)
- Architecture (third-party write-ups; R1 checked the repo at commit `723e0a9`, Nov 18 2026):
  - It is client/server. The server holds all state and logic, and the TUI, desktop and web clients are views over HTTP + SSE.
  - The server is Hono on Bun, with SQLite via Drizzle for sessions and the Vercel AI SDK as the provider layer. **R1 correction:** at `723e0a9` the `@opencode/server` package is built on Effect's `HttpApi` (Hono appears only in the root dependency catalog), and SQLite via Drizzle is confirmed in `packages/core/src/database`.
  - LSP diagnostics are fed back into the LLM after edits.
  - It has a plugin hook system and MCP support.
  - Compaction is a built-in hidden agent, with auto-compact and pruning. (R1: confirmed; `packages/core/src/session/compaction.ts` resolves a `compaction` agent and defaults to `auto: true`.)
  - Older versions used a Go TUI; newer ones reportedly use @opentui with Solid.
  - Sources: [search summary of basehub forum / cefboud deep-dive](https://hn.jakechampion.name/reader/https://cefboud.com/posts/coding-agents-internals-opencode-deepdive); [architecture map](https://ggprompts.github.io/htmlstyleguides/architecture/opencode/index.html)

**DeepSeek Harness (deepseek-ai/deepseek-harness; TypeScript monorepo, MIT)**
- Tagline: "Everything is a Plugin."
- It is built on the Cordis meta-framework, which the README ties to a paper on spatiotemporal composability.
- It is a pnpm monorepo with `apps`, `packages`, `native`, `python`, `docs` and `benchmarks`.
- The entry point is a Web UI: `npx @deepseek-ai/dsh web`, which serves on 127.0.0.1:3080.
- It is a developer preview with breaking changes expected.
- Source: [GitHub](https://github.com/deepseek-ai/deepseek-harness)
- It launched Aug 13, 2026 as v0.1, alongside DeepSeek-V4-Pro. — [OODA Loop](https://oodaloop.com/briefs/technology/deepseek-harness-launches-as-open-source-rival-to-claude-code-alongside-v4-pro-on-api-with-higher-prices/); [RuntimeWire](https://runtimewire.com/article/deepseek-open-sources-agent-harness-v4-pro-api-price-hike)
- Swappable plugins cover models, tools, skills, sessions, sandboxes, storage, the loop itself, scheduling and UI. — [i-SCOOP](https://www.i-scoop.eu/deepseek-harness-turns-every-part-of-an-agent-runtime-into-a-swappable-plugin/)
- It is model-open: Anthropic, OpenAI, Codex, Bedrock, Vertex, Azure and custom endpoints are supported alongside DeepSeek. — [i-SCOOP](https://www.i-scoop.eu/deepseek-harness-turns-every-part-of-an-agent-runtime-into-a-swappable-plugin/)
- Missing pieces, per one analysis: no eval tooling, artifacts surface, session sharing or metering. — [developersdigest](https://www.developersdigest.tech/blog/deepseek-harness-dsh-first-look)
- Adoption: a tracker reported ~197k stars within 8 days ([amplifying.ai](https://amplifying.ai/coding-agents/deepseek-harness)); the repo page showed ~283k on 2026-11-18 ([GitHub](https://github.com/deepseek-ai/deepseek-harness)).

**OpenAI Codex CLI (openai/codex; Rust core in `codex-rs`, Apache-2.0)**
- Description: "Lightweight coding agent that runs in your terminal."
- Top-level directories: `codex-cli`, `codex-rs`, `sdk`, `docs` and `bazel`.
- It installs via npm, Homebrew or release binaries, and authenticates with a ChatGPT plan or an API key.
- Source: [GitHub](https://github.com/openai/codex)
- Sandboxing (secondary/mirrors):
  - macOS uses Seatbelt (`sandbox-exec`).
  - Linux uses Landlock + seccomp, with a newer Bubblewrap path.
  - Windows uses a restricted token plus ACLs.
  - A single `SandboxPolicy` (network access + filesystem read/write roots) maps to each OS's primitives.
  - In workspace-write mode, `.git` and `.codex` stay read-only.
  - Source: [mintlify docs mirror](https://www.mintlify.com/openai/codex/architecture/sandboxing); [Daniel Vaughan blog, May 2026](https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/)
- Approval policy is separate from the sandbox. Decisions are run once, trust for the session, or amend the allow-list. Common pairings are `on-request` + `workspace-write` and `untrusted` + `read-only`. — [mintlify concepts](https://www.mintlify.com/openai/codex/concepts/sandboxing)
- An app-server handles Windows sandbox setup. Permission fields are unified under `Config::permissions` across core, app-server, CLI and TUI. — [forge mirror docs](https://forge.lthn.ai/core/core-agent-ide/src/commit/4ae6b9787a0e6f39bb7b0b01828947db8835daec/docs/sandbox.md)

**Goose (aaif-goose/goose; Rust, Apache-2.0)**
- "Built in Rust for performance and portability."
- It ships as a desktop app (macOS/Linux/Windows), a CLI and an embeddable API.
- Extensions use MCP, with "70+ extensions."
- It supports 15+ providers (Anthropic, OpenAI, Google, Ollama, Azure) plus ACP-based subscriptions.
- It has a `workflow_recipes` directory.
- It is governed under the Agentic AI Foundation (AAIF) at the Linux Foundation and has a GOVERNANCE.md.
- Source: [GitHub](https://github.com/block/goose)

**Aider (Python, Apache-2.0)**
- It builds a map of the entire codebase.
- It auto-commits to git with sensible messages.
- It auto-lints and tests after each change.
- It connects to "almost any LLM, including local models."
- The fetched page did not mention tree-sitter/PageRank, edit formats or architect mode; those are known from Aider docs but were not verified here.
- Source: [GitHub](https://github.com/Aider-AI/aider)

**SWE-agent (Python, MIT)**
- It is in maintenance mode: "Most of our current development effort is on mini-swe-agent, which has superseded SWE-agent."
- The whole agent is governed by a single YAML file.
- It is the origin of the "Agent-Computer Interface" (ACI) concept, from the NeurIPS 2024 paper arXiv 2405.15793.
- Source: [GitHub](https://github.com/SWE-agent/SWE-agent)

**mini-swe-agent (Python, MIT)**
- The core agent is "some 100 lines of python," with extra code for environment, model and run script.
- Bash is the only tool, and it does not use the LM's tool-calling API.
- Every action is an independent `subprocess.run`, so there is no persistent shell.
- History is linear: each step is appended to the messages.
- It claims >74% on SWE-bench Verified (self-reported).
- Environments: local, Docker/Podman, Singularity/Apptainer, bubblewrap and Contree.
- Listed users (self-reported) include Meta, NVIDIA, IBM, Nebius, Anyscale, Princeton and Stanford.
- Source: [GitHub](https://github.com/SWE-agent/mini-swe-agent)

**Cline (TypeScript, Apache-2.0)**
- The monorepo has an `sdk/` (a Node.js agent API that powers the other products), `apps/cli` (TUI + headless for CI), `apps/vscode` and a desktop app. The JetBrains plugin is closed source.
- Plan/Act modes.
- Every file edit and command needs approval by default, with optional auto-approve.
- Checkpoints allow undo.
- MCP tools, many providers (Anthropic, OpenAI, Google, OpenRouter, Bedrock, Ollama, LM Studio), `.clinerules` and skills, and browser use in VS Code.
- Source: [GitHub](https://github.com/cline/cline)

**OpenClaw (openclaw/openclaw; TypeScript/Node, MIT)**
- It is a personal AI assistant on your own machine, built around a local **Gateway** control plane for sessions, tools, events and channels. The Control UI, CLI and TUI connect to it.
- Channels: WhatsApp, Telegram, Slack, Discord, Signal, iMessage and Google Chat.
- Skills and plugins are shared via ClawHub.
- Tools run on the host for the main session unless sandboxing is configured.
- Agent harnesses (Claude, Codex, local models) are swappable plugins.
- It acknowledges Mario Zechner's "pi"; whether pi is the runtime was not confirmed.
- Source: [GitHub](https://github.com/openclaw/openclaw)

### Inferences
- Several projects now ship a headless core plus multiple clients, so the agent loop is decoupled from the UI:
  - OpenHands agent-server with REST/WS and generated TS client.
  - OpenCode server with HTTP/SSE.
  - Cline `sdk/` powering CLI, VS Code and desktop.
  - Codex app-server.
  - DeepSeek Harness web UI over plugins.
  - OpenClaw Gateway.

  For a team forking a harness, this is the dominant 2026 template.
- For a team building a product SDK, the OpenHands SDK is the most "forkable":
  - It has an academic paper and an MIT license.
  - It is event-sourced.
  - It has explicit workspace and condenser abstractions.
- For maximal extensibility, DeepSeek Harness (everything-a-plugin) and Goose (MCP-only extensions, foundation governance) take opposite routes:
  - DeepSeek uses in-process plugins, with even the loop swappable.
  - Goose uses out-of-process MCP servers.
- Codex is the reference for OS-native sandboxing; most other harnesses rely on Docker or on approvals.

### Gaps
- Primary-language percentages could not be read: the GitHub language bars rendered empty and the gh API was blocked.
- OpenCode internals (server stack, storage, compaction) and Codex internals are from third-party write-ups and mirrors, not official docs. opencode.ai/docs and developers.openai.com were not fetched.
- Aider's internals (tree-sitter repo map, edit formats, architect/editor mode) were not confirmed from a fetched page in this session.
- Goose subagents/recipes details and DeepSeek Harness's loop/condensation design were not documented in fetched sources.
- Whether OpenClaw embeds the pi agent runtime is unconfirmed.

## Recurring architectural design decisions (research and cross-harness patterns)

### Takeaway
A 70-project empirical study (arXiv 2604.18071) finds that harness decisions come in bundles that form five typical architectural patterns, and that programming language does not predict the pattern. Across the harnesses above, the same choices recur:
- **Tool interface:** a small set of coarse tools (bash plus a file editor), or a single bash tool.
- **Permission model:** approval gates separate from the sandbox.
- **Execution substrate:** a workspace/sandbox abstraction.
- **Context:** summarizing condensers or compaction.
- **Persistence:** event-log or SQLite sessions.
- **Extension:** MCP as the default extension bus.

### Cited Findings
- arXiv 2604.18071, "Architectural Design Decisions in AI Agent Harnesses," by Hu Wei, submitted Apr 20, 2026 (cs.AI):
  - It analyzes 70 public agent-system projects through source code and docs, focusing on the non-LLM infrastructure for tool access, context, delegation and safety.
  - It identifies recurring design dimensions, subagent architecture among them, and finds that decisions co-occur in bundles forming five typical patterns.
  - Source: [arXiv](https://arxiv.org/pdf/2604.18071); [alphaXiv](https://www.alphaxiv.org/abs/2604.18071)
- Per an aggregator summary, programming language does not determine architectural pattern. — [Moonlight review](https://www.themoonlight.io/review/architectural-design-decisions-in-ai-agent-harnesses)
- arXiv 2605.13850, "A Two-Dimensional Framework for AI Agent Design Patterns: Cognitive Function and Execution Topology," by Jia Huang and Joey Tianyi Zhou (A*STAR):
  - It classifies patterns on two independent axes: cognitive function (7 categories, e.g. Perception, Governance) and execution topology (6 archetypes).
  - Source: [arXiv](https://arxiv.org/abs/2605.13850); [alphaXiv](https://www.alphaxiv.org/abs/2605.13850)
  - Pattern count conflicts: 28 per the arXiv listing vs 27 per a third-party summary. — [arXiv](https://arxiv.org/abs/2605.13850); contradicted by [bittide](https://bittide.aicompass.dev/article/5f4b31c9-7247-4e71-b1ec-36acef2433ad)
- Survey arXiv 2606.20683, "From Question Answering to Task Completion: A Survey on Agent System and Harness Design," includes a section on harness effects on SWE-bench Verified. — [arXiv](https://arxiv.org/pdf/2606.20683)
- **ACI and tool interface:**
  - SWE-agent introduced the ACI concept (NeurIPS 2024) with a YAML-configured tool set. — [GitHub](https://github.com/SWE-agent/SWE-agent)
  - mini-swe-agent shows that bash-only, no-tool-calling designs reach >74% Verified (self-reported). — [GitHub](https://github.com/SWE-agent/mini-swe-agent)
  - OpenHands defaults to Terminal, FileEditor and TaskTracker tools. — [GitHub](https://github.com/OpenHands/software-agent-sdk)
- **Permission models:**
  - Codex keeps approval policy and sandbox policy separate. — [mintlify](https://www.mintlify.com/openai/codex/concepts/sandboxing)
  - Cline requires per-action approval by default, with checkpoints for undo. — [GitHub](https://github.com/cline/cline)
  - OpenCode's plan agent denies edits and asks before bash. — [GitHub](https://github.com/anomalyco/opencode)
  - OpenClaw runs tools on the host unless sandboxing is configured. — [GitHub](https://github.com/openclaw/openclaw)
- **Workspace/sandbox:**
  - OpenHands has Local, Docker/Kubernetes and remote workspaces. — [GitHub](https://github.com/OpenHands/software-agent-sdk)
  - mini-swe-agent has pluggable environments. — [GitHub](https://github.com/SWE-agent/mini-swe-agent)
  - Codex uses OS-native Seatbelt, Landlock/bwrap and Windows ACLs. — [Vaughan blog](https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/)
- **Condensers:**
  - OpenHands uses LLMSummarizingCondenser, stored as events. — [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §4.6
  - OpenCode has a compaction agent with auto-compact. — [OpenCode](https://github.com/anomalyco/opencode) `packages/core/src/session/compaction.ts` at `723e0a9`
  - mini-swe-agent deliberately has no context management. — [GitHub](https://github.com/SWE-agent/mini-swe-agent)
- **Session persistence:**
  - OpenHands uses an append-only event log with replay/recovery. — [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §4.2, §5.2
  - OpenCode uses SQLite via Drizzle. — [OpenCode](https://github.com/anomalyco/opencode) `packages/core/src/database` at `723e0a9`
  - DeepSeek Harness makes sessions and storage plugins. — [i-SCOOP](https://www.i-scoop.eu/deepseek-harness-turns-every-part-of-an-agent-runtime-into-a-swappable-plugin/)
- **Extensions:**
  - MCP: Goose (70+ extensions), Cline and OpenCode. — [Goose](https://github.com/block/goose); [Cline](https://github.com/cline/cline)
  - Skills/rules files: Cline `.clinerules` and skills, OpenClaw ClawHub. — [Cline](https://github.com/cline/cline); [OpenClaw](https://github.com/openclaw/openclaw)

### Inferences
- The consensus "default stack" a new harness should start from:
  - a minimal coarse tool set;
  - a separate approval policy layered over a sandbox policy;
  - a workspace abstraction so local and remote runs are the same code;
  - an append-only event/session log;
  - a summarizing condenser;
  - MCP for third-party tools and skills/rules files for project instructions.
- Plan/read-only vs build/act modes (OpenCode, Cline) are a common, cheap permission UX.

### Gaps
- The names and definitions of 2604.18071's five patterns and its full dimension list could not be read, because arxiv/alphaxiv were blocked.
- No source quantified prevalence, e.g. what percent of the 70 projects use MCP, subagents or sandboxes.

## How much does the harness (vs. the model) affect benchmark results?

### Takeaway
Substantially. Reported swings from changing only the harness range from ~10–24 points in controlled studies, and from ~19% to ~73% in an extreme minimal-vs-full adapter case. The effect appears to shrink as models get stronger on fixed-workflow SWE tasks but may grow on open-ended tasks. Run-to-run noise of 2–6 points means small gaps are not meaningful.

### Cited Findings
- **Claw-SWE-Bench** (arXiv 2606.12344, ~Jun 10 2026):
  - It has 350 issue-fix tasks across 8 languages and 43 repos, plus an 80-instance Lite version.
  - An adapter protocol fixes the prompt, runtime budget, workspace contract, patch extraction and evaluator, so OpenClaw-style general harnesses can be compared.
  - Its headline is that harness design matters as much as the model.
  - Code is at opensquilla/claw-swe-bench.
  - Source: [arXiv](https://arxiv.org/pdf/2606.12344); [opentrain summary](https://www.opentrain.ai/papers/claw-swe-bench-a-benchmark-for-evaluating-openclaw-style-agent-harnesses-on-codi--arxiv-2606.12344/)
- Claw-SWE-Bench: OpenClaw scored ~19.1% Pass@1 with a minimal adapter vs ~73.4% with a full adapter, on the same GLM 5.1 backbone. **R1 correction:** v1 figures; [v2](https://arxiv.org/abs/2606.12344) reports 19.3% vs 71.2% (Table 1). — [besthub article](https://www.besthub.dev/articles/how-harness-design-alters-coding-agent-scores-insights-from-the-first-independent-claw-swe-bench-8db2751ea3e2)
  - **R1 correction:** those are the v1 abstract figures (June 2026). v2 (Sept 28, 2026) reports 19.3% (bare adapter) vs 71.2% (full adapter), averaged over three runs; a harness gap of up to 24.3 pts across seven harnesses with the model fixed; and a 29.4-pt spread for OpenClaw across eleven models. — [arXiv 2606.12344v2](https://arxiv.org/abs/2606.12344), Table 1, §6.2, Appendix F.1
- **"Beyond the Model: Harness Effects in SWE agents"** (user-supplied arXiv 2609.32459):
  - The primary paper did not surface in search; only a secondary write-up attributed to Hu et al. (R1: the paper exists and was read; see below.)
  - It reports two harnesses across ten open-weight models and three benchmarks.
  - On fixed-workflow issue repair, a heavier harness compensates for weaker models and its gain shrinks as models improve. OpenHands' gain fell from ~+13.6 points (Claude 3.7 Sonnet) to ~+5.5 (Claude 4 Sonnet); SWE-agent's fell from ~+9.6 to ~+4.1. These come from matched leaderboard rows.
  - On open-ended repository generation, the trend reverses: only the newest models benefit. Task-specific subagents gave +5.91 (Qwen3.7-Max) and +4.46 (DeepSeek-V4-Pro) over the mini-swe-agent baseline.
  - Source: [agentpatterns.ai, via search snippet](https://agentpatterns.ai/patterns/agent-design/task-shape-harness-payoff/). arXiv 2609.20804 (Sept 17, 2026) appeared in the same results and may be the actual paper. — [hyper.ai](https://hyper.ai/en/papers/2609.20804)
  - ~~Existence of 2609.32459 is unverified.~~ **R1:** confirmed. [arXiv 2609.32459](https://arxiv.org/abs/2609.32459) (Hu et al., Sept 26 2026) evaluates mini-SWE-agent and OpenCode with ten Qwen/DeepSeek models on SWE-bench Pro, ProgramBench and GitTaskBench. The OpenHands (+13.60 → +5.47) and SWE-agent (+9.60 → +4.07) gains are in its Table 3 (matched SWE-bench Verified leaderboard rows); the +5.91 / +4.46 task-specific-subagent gains are in its Figure 11. 2609.20804 is a different paper.
- **"Stop Comparing LLM Agents Without Disclosing the Harness"** (arXiv 2605.23950):
  - Claude Opus 4.5 scored 45.9% under the standardized SEAL scaffold vs 55.4% under Claude Code.
  - The authors propose a locked-harness protocol or a factorial design.
  - Source: [arXiv](https://arxiv.org/html/2605.23950)
- **Harness-Bench** (arXiv 2605.27922, Qihoo 360):
  - 106 sandboxed offline tasks with a fixed environment, budget, timeout and evaluator, and 5,194 trajectories. **R1 correction:** those are v1 (May 2026) figures. v2 (Oct 15, 2026) has 300 tasks, seven harnesses and ten backends; no harness is best on all ten, and GLM-5.3's full-credit rate varies by 13.5 pts across harnesses. — [arXiv 2605.27922v2](https://arxiv.org/abs/2605.27922)
  - Completion, process quality, efficiency and failures vary substantially across model–harness pairs.
  - It recommends reporting per model–harness configuration and names "execution-alignment" failures.
  - Source: [arXiv](https://arxiv.org/html/2605.27922)
  - A commentary (unverified against the paper) claims 8 models x 6 harnesses, a 23.8-point swing from swapping harnesses, and variance that shrinks with stronger models. — [Cobus Greyling Substack](https://cobusgreyling.substack.com/p/agent-model-harness)
- **"What Does a Harness Buy? Tokens, Mostly"** (arXiv 2610.04433):
  - It holds the model fixed and varies scaffolds, including bash-only mini-swe-agent.
  - It cites that 10 reruns of one model–scaffold pair spread by 2.2–6.0 points, so 2–3 point gaps may be noise. (R1: the paper attributes this spread to Bjarnason et al., 2026, not to its own reruns; its own findings are in the main report.)
  - Source: [arXiv 2610.04433](https://arxiv.org/abs/2610.04433), §1–2
- Third-party benchmark monitoring reports up to 15 points of scaffold-only variation on SWE-bench Verified (secondary). — [nextgenoperator](https://nextgenoperator.beehiiv.com/p/scaffold-parity)

### Inferences
- When comparing models, lock the harness (mini-swe-agent is the de facto neutral baseline). When comparing harnesses, lock the model and report variance across reruns.
- On frontier models the marginal gain of a heavy harness on SWE-bench-style repair seems small (single digits), with gains reflected more in token cost. That is consistent with the title "Tokens, Mostly".
- Large swings appear when the harness is badly matched to the task, as in Claw-SWE-Bench's minimal adapter.

### Gaps
- None of the numeric results were verified against the PDFs (arxiv blocked).
- 2609.32459 in particular may not exist as cited; the closest verified-existing candidate is 2609.20804.

## What is a "minimal viable harness"?

### Takeaway
mini-swe-agent is the reference minimal harness:
- ~100 lines of Python for the agent class;
- one tool (bash), with no function-calling API;
- stateless `subprocess.run` per action;
- a linear message history with no context management;
- swappable environments.

It still self-reports >74% on SWE-bench Verified, and its own authors now prefer it over the full SWE-agent.

### Cited Findings
- ~100-line core, bash-only, no tool-calling interface, independent `subprocess.run` per action, linear history, >74% SWE-bench Verified (self-reported), and many environment backends. — [GitHub](https://github.com/SWE-agent/mini-swe-agent)
- SWE-agent maintainers say mini-swe-agent "has superseded SWE-agent" and recommend using it going forward. — [GitHub](https://github.com/SWE-agent/SWE-agent)
- Research uses mini-swe-agent as the baseline harness: "a single bash tool and no context management" ([arXiv 2610.04433](https://arxiv.org/pdf/2610.04433)); subagent gains are measured against it ([agentpatterns.ai snippet](https://agentpatterns.ai/patterns/agent-design/task-shape-harness-payoff/)).

### Inferences
- A minimal viable harness needs:
  - a loop of model call → parse one shell command → execute in a sandboxed environment → append the observation;
  - a termination signal;
  - step and cost limits.
- Everything else is an optimization whose value depends on the model and the task: condensers, rich editors, LSP feedback, subagents, permissions, persistence. Newer models reduce the gain on repair tasks; open-ended tasks benefit more from subagents.

### Gaps
- The exact mini-swe-agent loop source and the step/cost-limit details were not read in this session.
