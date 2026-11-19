# Browser-use evals and how cloud coding agents use browsers (as of November 2026)

Research notes, gathered 2026-11-18. Primary sources (papers, benchmark repos, vendor docs) are cited directly. Numbers taken from search-engine summaries or third-party aggregators are marked **[secondary]**; numbers from vendor posts about their own agents are marked **[self-reported]**. Treat these notes as working material: the fetches were done with a summarizing fetch tool, so re-check any number against the linked page before it goes into a reviewed document.

## A1. What each browser and computer-use benchmark measures, and its best published scores

### Takeaway
The field has split into (1) self-hosted, programmatically graded suites (WebArena-Verified, VisualWebArena, WorkArena, REAL, OSWorld/OSWorld 2.0), which are reproducible but saturating, and (2) live-web suites graded by an LLM or agent judge (WebVoyager, Online-Mind2Web, Mind2Web 2, BrowseComp, CAP), which are realistic but drift, depend on the judge, and are dominated by self-reported 90%+ scores. As of November 2026 the leaderboards that matter for a coding agent are WebArena-Verified (deterministic, offline-replayable) and OSWorld-Verified / OSWorld 2.0 (the only long-horizon suite where frontier models still score low).

### Cited Findings

**WebArena (original)**
- 812 tasks on self-hosted sites; the best GPT-4 agent in the original paper reached 14.41% against 78.24% for humans **[secondary]** — [aiwiki WebArena](https://aiwiki.ai/wiki/webarena); [Codesota WebArena](https://www.codesota.com/benchmark/webarena)
- Aggregated 2026 scores are in the low-to-mid 70s: Steel.dev (updated 29 June 2026) lists WebTactix on DeepSeek v3.2 at 74.3% and OpAgent at 71.6%; Steel describes its page as an aggregation of self-reported runs **[secondary, self-reported]** — [Steel WebArena leaderboard](https://leaderboard.steel.dev/leaderboards/webarena/)
- Codesota lists OpenAI Operator (CUA) at 58.1% and Agent-E (GPT-4o) at 73.0% **[secondary]** — [Codesota WebArena](https://www.codesota.com/benchmark/webarena)
- OpAgent paper (Feb 2026) reports 71.6% as its headline WebArena number and a separate 38.1% pass@5 figure for its RL model; the two are different setups — [OpAgent, arXiv 2602.13559](https://arxiv.org/html/2602.13559)
- Scores across WebArena variants and aggregators are not directly comparable **[secondary]** — [Codesota WebArena](https://www.codesota.com/benchmark/webarena)

**WebArena-Verified (ServiceNow)**
- Re-release of the same 812 tasks with every task, reference answer and evaluator manually audited; a 258-task "Hard" subset exists for cheaper runs — [ServiceNow/webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- Replaces LLM-as-judge and substring matching with type-aware normalization and structural comparison; scoring is deterministic — [ServiceNow/webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- Sites (shopping, shopping_admin, reddit, gitlab, wikipedia, map) start via `webarena-verified env start --site <site>` or Docker; Wikipedia and Map need data setup; an env-ctrl service on port 8877 reports status and resets — [ServiceNow/webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- Timeline: initial release 12 Nov 2024; NeurIPS 2025 SEA workshop 2 Dec 2025; PyPI 7 Jan 2026; Docker/uvx and optimized Docker Hub images 2 Feb 2026; latest docs version v1.2.3 — [README](https://github.com/ServiceNow/webarena-verified); [docs v1.2.3](https://servicenow.github.io/webarena-verified/v1.2.3/)
- Paper: Hattami et al., "WebArena Verified: Reliable Evaluation for Web Agents" (2025) — [OpenReview](https://openreview.net/forum?id=94tlGxmqkN)
- No official leaderboard found. LLM Stats lists Qwen3.8-27B at 64.8% (Oct 2026, one model tracked); a catalog lists Qwen3.7-Plus 55.3% and Qwen3.6-27B 48.8%, from Alibaba model cards **[secondary, self-reported]** — [LLM Stats WebArena-Verified](https://llm-stats.com/benchmarks/webarena-verified); [personalagentbench WebArena](https://personalagentbench.com/benchmarks/webarena/)
- Scoring pitfall: a BrowserGym issue reports that BrowserGym's WebArena-Verified reward averages per-evaluator scores (partial credit), while the official harness gives 1.0 only when every evaluator passes **[secondary: from search summary of the issue]** — [BrowserGym issue #412](https://github.com/ServiceNow/BrowserGym/issues/412)

**VisualWebArena**
- Multimodal companion to WebArena (ACL 2024; submitted 24 Jan 2024); code, baselines and data are public — [arXiv 2401.13649](https://arxiv.org/abs/2401.13649)
- Runs on self-hosted domains inside BrowserGym — [BrowserGym README](https://github.com/ServiceNow/BrowserGym)

**OSWorld and OSWorld-Verified (XLANG)**
- 369 tasks on real Ubuntu/Windows/macOS VMs (plus 43 Windows tasks for analysis; 8 Google Drive tasks can be excluded, leaving 361); 134 execution-based evaluation functions with per-task scripts; humans complete 72.36%, best model in the original study 12.24% — [OSWorld v1 site](http://osworld-v1.xlang.ai/)
- OSWorld-Verified (28 Jul 2025): ~300 community feedback items fixed (mostly evaluators: web drift, anti-crawling, time-sensitive bookings, ambiguous instructions, over-strict checkers); moved to AWS with up to 50 parallel environments, cutting runs from 10+ hours to minutes; files moved from Google Drive to Hugging Face — [XLANG OSWorld-Verified blog](https://xlang.ai/blog/osworld-verified)
- The leaderboard separates "verified" results (run by the team under unified settings) from self-reported ones — [OSWorld v1 site](http://osworld-v1.xlang.ai/)
- Top verified results at launch (Jul 2025): CoACT-1 60.76%, Agent S2.5 w/ o3 56.0%, GTA1 w/ o3 53.1%, Claude 4 Sonnet 43.9%, UI-TARS 40.0% — [XLANG OSWorld-Verified blog](https://xlang.ai/blog/osworld-verified)
- Late-2026 leaderboard numbers now exceed the human baseline: Presenc reports Intelligence-Indeed Agent at 90.19% on the official board (also listed by Awesomepapers, dated 2026-09-11), Claude Fable 5 at 85.96%, Claude Opus 5 at 83.39%; BenchLM lists Qwen3.8 Max 86.1% **[secondary; the official board loads dynamically and could not be read]** — [Presenc OSWorld 2026](https://presenc.ai/research/osworld-computer-use-leaderboard-2026); [Awesomepapers](https://awesomepapers.io/ai-agents/leaderboards/OSWorld%20(Verified)/osworld); [BenchLM](https://benchlm.ai/benchmarks/osworld-verified)

**OSWorld 2.0 (2026)**
- 108 long-horizon tasks across 7 professional domains / 21 sub-categories; median human time ~1.6 h, 69.6% of tasks take skilled users over an hour; 31 self-hosted websites plus apps (email, chat, spreadsheets, bank portals, FreeCAD); dynamic tasks change requirements mid-run — [OSWorld 2.0 site](https://osworld-v2.xlang.ai/)
- Grading: binary completion at 500 steps plus a partial score (avg 27.25 checkpoints per task) and separate safety reports; paper arXiv 2606.29537; the v1 site dates it 2026-06-26 — [OSWorld 2.0 site](https://osworld-v2.xlang.ai/); [OSWorld v1 site](http://osworld-v1.xlang.ai/)
- Best reported in the site text: Claude Opus 4.8 (max thinking, batched tool calls) 20.6% binary / 54.8% partial; Claude Opus 4.7 18.2%; GPT-5.5 ~14% with ~39K output tokens (most token-efficient) — [OSWorld 2.0 site](https://osworld-v2.xlang.ai/)
- BenchLeader lists Claude Opus 5 leading "OSWorld-Verified 2.0" at 31.4% as of 7 Oct 2026 **[secondary]** — [BenchLeader](https://www.benchleader.com/benchmarks/osworld_2)

**WebVoyager**
- Live-web benchmark built from 15 popular websites; graded automatically by GPT-4V with 85.3% agreement with humans; the WebVoyager agent scored 59.1% (Jan 2024, revised Jun 2024) — [arXiv 2401.13919](https://arxiv.org/abs/2401.13919)
- Critique (Online-Mind2Web authors): tasks skew easy and shortcut-friendly; a search-only agent that never navigates the sites reached 51% on a 100-task sample; its judge produced false positives from hallucinated answers — [Online-Mind2Web paper, arXiv 2504.01382v4](https://arxiv.org/html/2504.01382v4)

**Online-Mind2Web**
- 300 tasks on 136 live websites (83 easy / 143 medium / 74 hard); COLM 2025; the same search-only agent scores only 22% — [arXiv 2504.01382](https://arxiv.org/abs/2504.01382); [HTML v4](https://arxiv.org/html/2504.01382v4)
- WebJudge (o4-mini) agrees with human labels 85.7% of the time (success-rate gap 3.8%); a 7B judge reaches 87.0% — [HTML v4](https://arxiv.org/html/2504.01382v4)
- Human-evaluated results in the paper (2025): Operator 61.3%, Claude Computer Use 3.7 56.3%, SeeAct 30.7%, Browser Use 30.0%, Claude Computer Use 3.5 29.0%, Agent-E 28.0% — [HTML v4](https://arxiv.org/html/2504.01382v4)
- Independent HAL leaderboard (Princeton): SeeAct + GPT-5 Medium 42.33% ($171), Browser-Use + Claude Sonnet 4 40.00% ($1,577); HAL flags (5 Oct 2026) that nested trace spans double-counted some costs by up to 2× — [HAL Online Mind2Web](https://hal.cs.princeton.edu/online_mind2web)
- Vendor boards report ~97%: Yutori lists Hark Handoff 97.7% and Yutori Navigator n1.5 97.3% (5 Aug 2026); Browser Use Cloud (bu-max) claims 97% (Mar 2026) graded by its own agentic judge **[self-reported]** — [Yutori leaderboard](https://yutori.com/leaderboards/online-mind2web); [Browser Use post](https://browser-use.com/posts/online-mind2web-benchmark); [Steel leaderboard](https://leaderboard.steel.dev/leaderboards/online-mind2web/)
- The gap between HAL (~42%) and vendor boards (~97%) comes from different judges and scaffolds; they are not comparable **[inference supported by HAL and Browser Use pages above]**

**Mind2Web 2**
- 130 long-horizon live-web agentic-search tasks (1,000+ hours of human construction); Agent-as-a-Judge with task-specific tree-structured rubrics scoring correctness and source attribution; OpenAI Deep Research was best of ten systems, at 50–70% of human performance in about half the time (Jun 2025) — [arXiv 2506.21506](https://arxiv.org/abs/2506.21506)

**BrowseComp (OpenAI)**
- 1,266 questions needing persistent search for hard-to-find, entangled facts; short answers checked against references; released 16 Apr 2025 with code in openai/simple-evals — [arXiv 2504.12516](https://arxiv.org/abs/2504.12516)
- Late-2026 aggregator numbers sit around 90%: BenchLM (15 Oct 2026) Atria Dawn Preview 92.5%, GPT-5.6 Sol 92.2%; Datalearner Claude Opus 5 (max thinking, tools) 90.8%; multi-agent configurations up to 93.6% **[secondary]** — [BenchLM BrowseComp](https://www.benchlm.ai/benchmarks/browseComp); [Datalearner](https://global.datalearner.com/benchmarks/browsecomp)
- BrowseComp measures search and synthesis, not page interaction; search-API comparisons (e.g. Parallel, Nov 2026) report it too **[secondary]** — [Parallel BrowseComp report](https://parallel.ai/articles/most-powerful-search-api-for-ai)

**WorkArena / WorkArena++ (ServiceNow)**
- L1: 33 atomic tasks, 19,912 instances (ICML 2024); L2 WorkArena++: 682 compositional tasks (NeurIPS 2024); runs on a ServiceNow instance obtained via the gated Hugging Face dataset "WorkArena-Instances"; each task has a programmatic `validate` function; the README says "this benchmark is not solved" — [ServiceNow/WorkArena](https://github.com/ServiceNow/WorkArena)

**REAL (AGI Inc.)**
- 112 tasks on 11 deterministic, high-fidelity replicas of popular sites (e-commerce, travel, communication, professional networking); action tasks graded programmatically against site state, retrieval tasks by an LLM rubric judge; frontier models reached at most 41% (Apr 2025); harness is framework-agnostic and can test black-box agents — [arXiv 2504.11543](https://arxiv.org/abs/2504.11543)

**2025–2026 newcomers**
- CAP (COLM 2026): 420 tasks on 108 real sites, cross-site workflows, complex UI actions and perception; agent-as-judge; finds perception a worse bottleneck than execution **[from search summary]** — [arXiv 2608.08392](https://arxiv.org/abs/2608.08392)
- WebRetriever: 1,550 tasks over 800 sites with an LLM-judge method (NavEval) **[from search summary]** — [arXiv 2607.06118](https://arxiv.org/abs/2607.06118)
- BrowserBench (from Wuying-Browser-Agent): 350-task bilingual real-web long-horizon benchmark **[from search summary]** — [arXiv 2608.17319](https://arxiv.org/abs/2608.17319)
- cua-speedrun: standardized benchmark of computer-use agent speed **[title only]** — [arXiv 2609.40284](https://arxiv.org/pdf/2609.40284)
- "How Benchmarks Mis-Score Computer-Use Agents" (30 Jul 2026): audit of 150 failure-scored trajectories across five benchmarks found 15.3% of FAIL verdicts wrong (10.7% evaluator false negatives, 4.7% broken tasks); causes: stale tasks, trajectories missing decisive visual evidence, evaluators rejecting valid alternatives — [arXiv 2607.28367](https://arxiv.org/abs/2607.28367)
- The Agentic Benchmark Checklist paper (Jul 2025) shows benchmark flaws can mis-estimate performance by up to 100% relative; its examples are SWE-bench Verified, TAU-bench and CVE-Bench, not web benchmarks — [arXiv 2507.02825](https://arxiv.org/abs/2507.02825)

### Inferences
- Live-web numbers above ~90% (Online-Mind2Web, BrowseComp) mostly measure the vendor's judge and scaffold; they do not discriminate between harnesses we would build.
- OSWorld-Verified is near or above the human baseline on the official board, so OSWorld 2.0 (≈20–31% best) is now the discriminating desktop benchmark, but it is too long and expensive for CI.
- WebArena-Verified is the strongest fit for us: deterministic graders, self-hosted Docker sites including GitLab (close to a coding agent's world), and a Hard subset for budgeted runs.

### Gaps
- Could not read the official OSWorld-Verified leaderboard table (loads dynamically); late-2026 OSWorld numbers are from aggregators only.
- WebVoyager task count (commonly cited as 643) and VisualWebArena task count/sites/scores were not confirmed from the fetched abstracts.
- No official WebArena-Verified leaderboard found; no confirmed scores for Claude or GPT agents on it.
- BrowseComp official provider numbers (e.g. Deep Research, ChatGPT agent) were not confirmed from primary sources in this round.
- CAP, WebRetriever, BrowserBench details come from search snippets, not full papers.

## A2. Which benchmarks are practical to run offline or in CI, and how harnesses record trajectories

### Takeaway
Only self-hosted, programmatically graded suites can run in CI: WebArena-Verified (best: deterministic, offline re-grading from HAR traces), REAL (deterministic replicas), MiniWoB (via BrowserGym, tiny and fast), and WorkArena (needs a ServiceNow instance, so not offline). Trajectories are recorded as per-step observations/actions (BrowserGym/AgentLab), network HAR files plus a structured final answer (WebArena-Verified), or Playwright traces and videos (Playwright MCP). Live-web suites cannot be made hermetic.

### Cited Findings
- WebArena-Verified evaluation can run offline by replaying captured network traces; each task yields an agent-response JSON (`task_type`, `status`, `retrieved_data`) plus a HAR network trace (e.g. `network_44.har`); `evaluate_task` returns score and status — [ServiceNow/webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- WebArena-Verified ships optimized site images on Docker Hub and a `uvx` CLI (Feb 2026), plus an env-ctrl reset service — [README](https://github.com/ServiceNow/webarena-verified)
- BrowserGym wraps MiniWoB, WebArena, WebArenaVerified, VisualWebArena, WorkArena, AssistantBench, WebLINX (static), OpenApps, TimeWarp and Knows behind one gym interface; installed per benchmark (`pip install browsergym-webarena`) plus `playwright install chromium`; AssistantBench uses the open web, WorkArena a ServiceNow instance — [BrowserGym README](https://github.com/ServiceNow/BrowserGym)
- AgentLab (companion) runs agents across BrowserGym benchmarks and collects and analyzes traces; BrowserGym Ecosystem trace datasets are on Hugging Face — [BrowserGym README](https://github.com/ServiceNow/BrowserGym); [arXiv 2412.05467](https://arxiv.org/abs/2412.05467)
- REAL's replicas are deterministic and its harness can test black-box agent commands without modification — [arXiv 2504.11543](https://arxiv.org/abs/2504.11543)
- OSWorld supports headless, parallel environments on one host and AWS (up to 50 environments) — [OSWorld v1 site](http://osworld-v1.xlang.ai/); [XLANG blog](https://xlang.ai/blog/osworld-verified)
- OSWorld 2.0 uses 31 self-hosted websites but long (~1.6 h human) tasks with a 500-step budget — [OSWorld 2.0 site](https://osworld-v2.xlang.ai/)
- Playwright MCP exposes `browser_start_tracing`/`browser_stop_tracing` and `browser_start_video`/`browser_stop_video` (default `video-{timestamp}.webm` under `--output-dir`), `browser_console_messages`, `browser_network_requests`; actions default to accessibility snapshots (`browser_snapshot`), with coordinate tools opt-in via `--caps=vision` — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Playwright MCP `--allowed-origins`/`--blocked-origins` are explicitly not a security boundary and do not affect redirects; `--isolated` keeps the profile in memory; `--headless` opt-in; `--cdp-endpoint` attaches to an existing Chromium — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Mis-scoring audit: trajectories that omit decisive visual evidence are one cause of wrong FAIL verdicts — [arXiv 2607.28367](https://arxiv.org/abs/2607.28367)
- HAL found its own cost accounting double-counted nested trace spans by up to 2× — [HAL Online Mind2Web](https://hal.cs.princeton.edu/online_mind2web)

### Inferences
- CI tier plan for our harness: (1) a tiny self-hosted fixture app (or MiniWoB tasks) driven against a mock model for plumbing tests; (2) WebArena-Verified Hard subset (258 tasks) with the GitLab and shopping sites, nightly, graded deterministically; (3) occasional OSWorld-Verified or Online-Mind2Web runs only as external comparison, never gating.
- Record each step's action, accessibility snapshot, screenshot, console and network log in the session event log, and keep a HAR so WebArena-Verified can re-grade offline; the mis-scoring paper argues screenshots must be kept, not just text.
- Cost accounting must not count nested spans twice (HAL's bug), which matters for our OTel `gen_ai.*` spans.

### Gaps
- BrowserGym's exact trajectory file format (pickled step info vs JSON) was not confirmed from the README.
- No primary source found on how OSWorld records trajectories (screenshots + actions per step is likely but unconfirmed here).

## B1. How cloud coding agents use a browser in practice

### Takeaway
By late 2026 every major cloud coding agent ships a browser inside its own sandbox to check its own UI work, and most attach screenshots or videos as evidence: Copilot (Playwright MCP by default, screenshots in PRs, firewall applies to the browser), Cursor cloud agents (full VM desktop, videos/screenshots on PRs), Devin (recorded, annotated test videos), Jules (Playwright in base image, screenshot with changes), Codex Cloud (browser inside the cloud task), Replit and Lovable (hosted browser testing the preview). Claude Code's Chrome integration drives the user's own local Chrome, while Claude Code cloud sessions only preinstall Chrome for Testing in the VM.

### Cited Findings

**Claude Code (Anthropic)**
- `claude --chrome` connects to the Claude in Chrome extension (v1.0.36+) in the user's own Chrome/Edge (other Chromium browsers detected); shares the user's login state, runs in a visible window, pauses for logins/CAPTCHAs; needs a direct Anthropic plan and `/login` (not API key); not on Bedrock/Vertex/Foundry; not in WSL — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Capabilities: console/DOM reading for debugging, design verification against Figma, form/flow testing, authenticated apps, data extraction, file uploads (≤10 MB, refuses credential-named files from v2.1.293), GIF recording, screenshots saved to disk — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Connection goes through `bridge.claudeusercontent.com` via a native messaging host; a project's settings cannot turn Chrome on (`CLAUDE_CODE_ENABLE_CFC` in repo settings is ignored), so a checked-out repo cannot connect Claude to your browser — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Site permissions come from the extension; JavaScript dialogs block the browser; the service worker can idle and drop long sessions — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Cloud sessions run in isolated Anthropic-managed VMs with Limited network by default (package registries, GitHub, cloud SDKs plus listed domains); credentials stay outside the VM behind a proxy — [Claude Code cloud docs](https://code.claude.com/docs/en/claude-code-on-the-web); [cloud environments](https://code.claude.com/docs/en/cloud-environments)
- Cloud VMs preinstall "Chrome for Testing at `/usr/bin/google-chrome`, with the `CHROME_PATH` environment variable set," plus chromedriver with Node — [cloud environments: installed tools](https://code.claude.com/docs/en/cloud-environments)
- Interactive SSO that needs a browser login is not supported in cloud sessions — [cloud environments](https://code.claude.com/docs/en/cloud-environments)

**GitHub Copilot coding agent**
- Got a built-in browser powered by the Playwright MCP server on 2 Jul 2025 (public preview); can reproduce bugs, validate its work and "share screenshots of what it has done in its pull request" — [GitHub changelog 2025-07-02](https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/)
- GitHub and Playwright MCP servers are enabled by default — [Extend coding agent with MCP](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp)
- Firewall on by default with a recommended allowlist that includes hosts for downloading Playwright browsers; in cloud sandboxes the firewall applies to the built-in Playwright server and its browser processes, but not to repo-configured replacement MCP servers or setup steps; blocked requests are reported in the PR body or a comment — [Customize the agent firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall)
- Environments: cloud sandbox, GitHub Actions runner (59-minute max session) or remote custom environment — [About coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)

**OpenAI Codex**
- "When a Codex Cloud task has browser access, Codex can use a browser inside the cloud task" to inspect a web app, reproduce a bug or verify a fix; the user gives the start command, port and expected behavior; Codex may include a screenshot in its report — [Codex Browser doc](https://learn.chatgpt.com/docs/browser)
- The built-in browser (separate profile) is in ChatGPT web and the desktop app, not in Codex CLI or the IDE extension; desktop Computer Use operates it; a Chrome extension (`@Chrome`) drives existing tabs — [Codex Browser doc](https://learn.chatgpt.com/docs/browser)
- Cloud environment network: toggles for all public internet, package-manager domains and additional allowed domains; network secrets for allowed HTTPS services — [Codex Cloud doc](https://learn.chatgpt.com/docs/cloud)
- The in-app browser reportedly does not inherit login cookies **[secondary]** — [Medium](https://chierhu.medium.com/openai-codexs-browser-use-feature-b7dffa761d45)

**Google Jules**
- 7 Aug 2025: "Ask Jules to complete a web development task and to verify the front end… Jules will send you a screenshot of the front end along with any code changes"; "The default Jules base image now includes Playwright for front end testing" — [Jules changelog 2025-08-07](https://jules.google/docs/changelog/2025-08-07)

**Cursor cloud agents**
- 24 Feb 2026: each cloud agent runs in its own isolated VM with a full desktop, can use the software it builds (browse pages, spreadsheets), and delivers PRs with videos, screenshots and logs; users can take over the remote desktop; over 30% of PRs merged at Cursor come from autonomous cloud agents — [Cursor blog: agent computer use](https://cursor.com/blog/agent-computer-use)
- Forum reports that artifacts were not always posted to the PR and that some models skipped the demo **[secondary]** — [Cursor forum](https://forum.cursor.com/t/cursor-cloud-agents-do-not-post-their-screenshots-or-videos-to-pr/152974); [Latent Space](https://latent.space/reading/cursor-third-era-cloud-agents/)

**Devin (Cognition)**
- Tests end to end "through the browser" and "in the desktop": reads PR and repo, checks `.agents/skills/`, logs into services (asks for secrets, saves them), writes a plan for "the single most important end-to-end flow," records the full screen with annotations after CI is green, and sends the processed video; "Test the app" button and "Pre-approve testing" setting; afterwards proposes a skill PR capturing setup steps — [Devin testing and recordings](https://docs.devin.ai/work-with-devin/testing-and-recordings.md)
- Interactive Browser in the session UI lets the user complete auth steps — [Devin session tools](https://docs.devin.ai/work-with-devin/devin-session-tools)
- Screenshots in PR description appear only in a sample user skill, not as built-in behavior — [Devin testing and recordings](https://docs.devin.ai/work-with-devin/testing-and-recordings.md)

**Cline / Roo / Kilo**
- Browser tool (`browser_action`) uses a Puppeteer-driven Chrome with a fixed 900×600 viewport, sharing a screenshot after each action **[from search snippets]** — [Cline browser automation](https://docs.cline.bot/tools-reference/browser-automation.md); [Roo browser use](https://docs.roocode.com/features/browser-use)
- Remote mode attaches to an existing Chrome with remote debugging (port 9222), useful for auth cookies — [Cline remote browser support](https://docs.cline.bot/exploring-clines-tools/remote-browser-support); [Kilo browser action](https://kilo.ai/docs/automate/tools/browser-action)

**Replit Agent**
- App Testing drives a real browser, navigating like a user with mock data; covers UI, functionality, integrations, performance, accessibility; replayable video; agent decides when to test; Power/Max modes only; web apps only (Full Stack JS, Streamlit); user can take over at login/CAPTCHA, auto-skip after 10 minutes; billed by effort — [Replit App Testing](https://docs.replit.com/references/agent/app-testing.md)

**Lovable / v0 / Bolt**
- Lovable browser testing runs in a remote virtual browser against the current preview; captures screenshots, console logs, network requests and runtime errors; used selectively after lighter checks; mobile/tablet/desktop sizes; can sign in as an app user with the built-in backend; struggles with canvas, drag-and-drop, clipboard, subtle visual details, icon-only buttons — [Lovable browser testing](https://docs.lovable.dev/features/browser-testing)

### Inferences
- The common pattern is: agent starts the dev server inside its own sandbox, drives a headless or VM-hosted Chromium against localhost, and returns visual evidence (screenshot or video) attached to the PR or message. Only Claude Code's Chrome integration and Cline's remote mode drive the user's own browser.
- Accessibility-snapshot control (Playwright MCP) is the default for coding agents; full-desktop pixel control (Cursor, Devin) is used where recordings and takeover matter.
- Network policy must cover the browser process itself: Copilot is the only vendor that documents the firewall applying to browser traffic.

### Gaps
- No official v0 or Bolt documentation on built-in browser testing found.
- Codex Cloud docs do not say how browser access is enabled per task or whether screenshots are attached to PRs.
- Whether Copilot's Playwright server is restricted to localhost was not stated in the fetched pages.
- Cline's browser docs page fetched did not contain the browser tool description; details rely on snippets and forks.

## B2. What browser features a personal cloud coding agent actually needs

### Takeaway
A minimal browser for our Cloudflare-first coding agent needs: a headless Chromium in the sandbox (not the loop), accessibility-snapshot actions with screenshots, console and network capture, a localhost dev-server workflow, per-step evidence in the event log and on the PR, and egress rules that also bind the browser. Logged-in browsing of the owner's own sites is a separate, opt-in mode (like Claude in Chrome) and should not be in the cloud sandbox.

### Cited Findings
- Vendors converge on four tasks: reproduce a bug, verify a UI change, run an e2e flow, and attach evidence (screenshot/video) — [Copilot changelog](https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/); [Jules changelog](https://jules.google/docs/changelog/2025-08-07); [Codex Browser](https://learn.chatgpt.com/docs/browser); [Devin testing](https://docs.devin.ai/work-with-devin/testing-and-recordings.md); [Cursor blog](https://cursor.com/blog/agent-computer-use)
- Console and DOM reading for debugging is a headline capability — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome); [Lovable browser testing](https://docs.lovable.dev/features/browser-testing)
- Auth and CAPTCHA walls are handled by handing control to the user — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome); [Replit App Testing](https://docs.replit.com/references/agent/app-testing.md); [Devin session tools](https://docs.devin.ai/work-with-devin/devin-session-tools)
- Testing selectively after cheaper checks is documented by Lovable and Replit, and Claude Code warns that always-on browser tools raise context usage — [Lovable](https://docs.lovable.dev/features/browser-testing); [Replit](https://docs.replit.com/references/agent/app-testing.md); [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Repo config must not be able to connect the agent to a personal browser — [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome)
- Playwright MCP origin filters are not a security boundary — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)

### Inferences
- Must-have: sandbox-local headless Chromium; snapshot + screenshot + console + network tools; video or trace on demand; artifacts uploaded to the PR; network egress enforced at the sandbox proxy, not via browser flags.
- Should-have: viewport presets (mobile/desktop), selective triggering (only when a UI file changed or the user asks), user takeover for auth.
- Defer: driving the owner's own logged-in browser; full-desktop computer use.
- Eval: a fixture web app with seeded UI bugs, graded programmatically, in `pnpm test` against a mock model; WebArena-Verified Hard (GitLab + shopping) nightly.

### Gaps
- No vendor publishes how often browser verification changes PR outcomes, except Cursor's 30%-of-merged-PRs figure for cloud agents overall.
- Whether Cloudflare's sandbox or Browser Rendering fits this browser role was out of scope here.
