# Fact-check log: agent SDKs and harness design report

Date: 2026-11-18. Scope: [agent-sdks-and-harness-design.md](agent-sdks-and-harness-design.md), its references and its reference architecture. Each claim was checked against the primary source where reachable (anthropic.com, code.claude.com, PyPI JSON API, GitHub pages and shallow repo clones). Otherwise search-indexed abstracts were used, as noted.

Legend: ✅ confirmed · ✏️ corrected in the report · ⚠️ still secondary / unverified

## Corrections made

| # | Claim in first draft | Finding | Action |
|---|---|---|---|
| 1 | arXiv 2609.32459 ("Beyond the Model") "could not be verified to exist"; 2609.20804 "may be the real paper" | **Exists**: Hu et al., *Beyond the Model: Demystifying Harness Effects in Software Engineering Agents* (cs.SE). It builds NanoHarness on mini-SWE-agent and ablates tool registry, context compression, planning, subagents and lazy skills. 2609.20804 is a *different* paper (*An Empirical Study of Harness Design for Coding Agents*) | ✏️ Re-attributed; both papers now cited separately |
| 2 | 2610.04433: "ten reruns spread 2.2–6.0 points" | Not in the abstract. The abstract finds that harness swaps change outcomes about as often as reruns (~13%). The only effect clearing noise is negative (OpenCode up to −9 pts). The harness mainly decides cost, and ~447 tasks are needed to resolve 5 pts | ✏️ Replaced with abstract findings |
| 3 | Lead: harness swaps move scores "10–24 points in controlled studies" | The 24-point figure traced to a commentary only. The defensible numbers are Claw-SWE-Bench's 19.1→73.4 (adapter) and 27.4-pt harness spread, against 2610.04433's null-ish result for mature harnesses | ✏️ Lead rewritten to present both sides |
| 4 | Section header "moves scores by up to 54 points" | Arithmetic is right (73.4 − 19.1) but it overstated the general case | ✏️ Retitled |
| 5 | Claude Agent SDK license: "Anthropic Commercial Terms" | Repo and PyPI package are **MIT**. The README says *use* is governed by Anthropic's Commercial Terms, and the SDK bundles the proprietary Claude Code binary | ✏️ Clarified |
| 6 | Goose link `block/goose` | Repo is served from `aaif-goose/goose` (AAIF / Linux Foundation) | ✏️ Link fixed |
| 7 | Codex Linux sandbox: "Landlock + seccomp / bubblewrap" | Source: bubblewrap + seccomp + managed TCP/DNS proxy. Landlock only behind hidden `--use-legacy-landlock` | ✏️ Corrected |
| 8 | OpenAI sandbox providers "reportedly Modal, Daytona, Docker and E2B" | Repo docs: UnixLocal and Docker built in; Blaxel, Cloudflare, Daytona, E2B, Modal, Vercel as extensions | ✏️ Corrected, no longer "reportedly" |
| 9 | Claw-SWE-Bench 19.1% / 73.4% | Abstract figures confirmed. The body reports a related 19.3% / 71.2% comparison | ✏️ Noted |
| 10 | 2605.23950: 45.9% vs 55.4% "under a standardized scaffold" | Confirmed; it is SWE-bench **Pro**, under the SEAL scaffold | ✏️ Benchmark named |

## Confirmed against primary sources ✅

**Anthropic engineering posts (anthropic.com):**
- Managed Agents (Apr 8 2026): session / harness / sandbox; `execute(name, input) → string`, `provision`, `wake(sessionId)`, `getSession`, `emitEvent`, `getEvents`; p50 TTFT −~60%, p95 −>90%.
- Harness design for long-running apps (Mar 24 2026): solo 20 min / $9 vs harness 6 h / $200. With Opus 4.6, sprints removed and planner kept; the evaluator went to a single end-of-run pass.
- Effective harnesses for long-running agents (Nov 26 2025): `init.sh`, `claude-progress.txt`, JSON feature list with 200+ features; JSON chosen because the model is less likely to overwrite it; one feature per session.
- Infrastructure noise (Feb 5 2026): 6-pt Terminal-Bench 2.0 swing; infra errors 5.8% → 2.1% at a 3× ceiling.
- Advanced tool use (Nov 24 2025): ~77K → ~8.7K tokens (85%); programmatic tool calling 43,588 → 27,297 (37%).
- Code execution with MCP (Nov 4 2025): 150,000 → 2,000 tokens (98.7%), Drive → Salesforce. The canonical URL is `/engineering/…`; the user-supplied `/research/…` URL may redirect.
- Multi-agent research system: +90.2% vs single-agent Opus 4; ~4× tokens for agents, ~15× for multi-agent; tool-description rewrite cut task time 40%.
- Writing tools for agents: 25,000-token default cap in Claude Code; concise format ~⅓ tokens (72 vs 206).
- Claude Code sandboxing: −84% permission prompts; bubblewrap and seatbelt; both FS and network isolation needed.
- Building effective agents (Dec 19 2024): more time on tools than the prompt; absolute filepaths; framework abstraction warning.
- Demystifying evals for AI agents (Jan 9 2026): 20–50 tasks from real failures; pass@k vs pass^k; 0.75³ ≈ 0.42; grade outcomes, not paths.

**Claude Agent SDK hosting docs (code.claude.com):** one session = one `claude` subprocess over stdio. 1 GiB RAM / 5 GiB disk / 1 CPU is a floor. Transcripts, CLAUDE.md and the working directory are lost on restart. `SessionStore` mirrors transcripts only, best-effort with `mirror_error`. No session timeout, no per-subagent wall-clock deadline. Multi-tenant isolation via `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, per-tenant `CLAUDE_CONFIG_DIR`. Managed Agents is the hosted alternative.

**Package versions and dates (PyPI JSON API):**

| Package | Latest | Notable release |
|---|---|---|
| claude-agent-sdk | 0.2.184 (still 0.x) | MIT |
| openai-agents | 0.25.0 | MIT |
| google-adk | 2.14.1 | 2.0.0 on 2026-05-19 |
| agent-framework | 1.26.0 | 1.0.0 on 2026-04-02 (GA announced Apr 3) |
| langgraph | 1.2.22 | 1.0.0 on 2025-10-17 |
| pydantic-ai | 2.70.0 | |
| strands-agents | 1.65.0 | Apache-2.0 |
| smolagents | 1.26.0 | last release 2026-05-29 ("no release since May" confirmed) |
| mini-swe-agent | 2.4.6 | MIT |
| inspect-ai | 0.3.291 | MIT |

Note: the vendor-SDK notes cite ADK "2.6.x" on PyPI, which is now stale (2.14.1).

**GitHub repos (pages / clones):**
- OpenHands SDK: MIT, ~1.4k★; packages sdk / tools / workspace / agent-server plus a TS client; arXiv 2511.03690.
- OpenCode: MIT, ~228k★; build / plan / @general agents.
- DeepSeek Harness: MIT, ~283k★; "Everything is a Plugin", Cordis, developer preview with breaking changes.
- Goose: Apache-2.0, ~57k★, AAIF.
- Codex: Apache-2.0, ~136k★.
- mini-swe-agent: ~100 lines, bash only, >74% SWE-bench Verified (self-reported), MIT, ~9.7k★.
- Cloudflare Agents: MIT, ~6.0k★; Durable Objects, hibernation; deprecated packages confirmed.
- claude-agent-sdk-python: ~8.6k★.

**Standards and eval tooling:**
- OTel GenAI agent spans (raw GitHub): `create_agent` (CLIENT), `invoke_agent` (INTERNAL; CLIENT variant in a separate doc), `plan` (INTERNAL), `execute_tool` (separate doc). All at Development status.
- Inspect `agent-bridge.qmd`: `agent_bridge()` and `sandbox_agent_bridge()`; proxy on localhost:13131; generation params not forwarded unless `forward_generation_config=True`.

## Confirmed via abstracts / search index only ⚠️

*Superseded by the [R1 re-verification](#re-verification-against-primary-sources-r1) below, which re-checked each item against the primary source. The list is kept as the state before R1.*

- Claw-SWE-Bench (2606.12344): 350 tasks, 8 languages, 43 repos, Lite 80; model spread 29.4 pts vs harness spread 27.4 pts.
- Harness-Bench (2605.27922): 106 tasks, 5,194 trajectories; per model–harness reporting.
- Architectural Design Decisions (2604.18071): Hu Wei, Apr 20 2026, 70 projects, five patterns. Only "Lightweight Tool Pattern" confirmed by name.
- 2609.32459 per-harness numbers (OpenHands +13.60 → +5.47): from a secondary write-up attributing them to this paper.
- 2609.20804 context-management payoff 35.7 → 15.9 → 5.5 → 2.7 pts (32K → 128K windows): secondary.
- MCP 2026-07-28: removal of `initialize`/`initialized` (SEP-2575) and `Mcp-Session-Id` (SEP-2567); `server/discover`; `Mcp-Method`/`Mcp-Name` headers. Many consistent third-party sources, but the spec site was unreachable.
- OpenAI "Why we no longer evaluate SWE-bench Verified" (59.4% of 138 audited tasks flawed): openai.com unreachable.
- Terminal-Bench 2.0 Claude Code 58.0% vs Terminus-KIRA 74.7%: single secondary source.

## Corrections from the verified SDK references (Round C, 2026-11-18)

The four SDK references in [`docs/reference/`](../reference/) checked the report's SDK claims against pinned packages. These rows log what changed in the report.

| # | Claim in the report | Finding | Action |
|---|---|---|---|
| 11 | Borrowable primitive: "per-tool `needsApproval(args)` predicates, cryptographically bound to the call" (Vercel AI SDK) | In `ai@7.0.162`, per-tool `needsApproval` is `@deprecated`; approval is a call-level `toolApproval` policy, and approval requests are HMAC-signed only when `experimental_toolApprovalSecret` is set ([Vercel guide §7](../reference/vercel-ai-sdk/guide.md#7-approval-is-a-call-level-policy-not-a-flag-on-the-tool)) | ✏️ Row rewritten |
| 12 | "Composable stop conditions with a default step cap (20)" (Vercel AI SDK) | The 20-step default belongs to `ToolLoopAgent`; `generateText` and `streamText` default to one step. Both verified by examples 02 and 07 ([Vercel guide §4–5](../reference/vercel-ai-sdk/guide.md#4-tools-run-in-a-loop-only-as-long-as-stopwhen-allows)) | ✏️ Row clarified |
| 13 | OpenAI Agents SDK: "tracing tied to OpenAI" | Sharper: tracing is on by default in Node.js, Deno and Bun and exports each run to OpenAI unless disabled ([OpenAI guide §2](../reference/openai-agents-sdk/guide.md#2-install-then-decide-where-traces-go)) | ✏️ Table cell expanded |
| 14 | MCP 2026-07-28 removed the `initialize` handshake (search summary only) | Partly corroborated by a primary source: `@ai-sdk/mcp@2.0.90` names 2026-07-28 its latest, "stateless" protocol and probes with `server/discover` before falling back to `initialize`. The spec text remains unverified | ✏️ Corroboration added; still ⚠️ for the remaining details |
| 15 | (new) Default behaviors that reach outside the process | Each of the four SDKs has one: Claude's inherited CLI environment (Claude fact-check F5), Pi's ambient-credential model choice, OpenAI's tracing export, Vercel's AI Gateway routing | ✏️ Added to the library-SDK section, linked to the deep comparison |

| 16 | Row 15: "each of the four SDKs" has an outward-reaching default | The fifth reference, LangChain.js (added 2026-11-18), has none by default: LangSmith tracing needs `LANGSMITH_TRACING=true` ([LangChain guide §2](../reference/langchain/guide.md#2-install-then-give-every-model-id-a-provider-prefix)) | ✏️ Report now says four of five, with LangChain as the exception |
| 17 | [harness-architectures.md](harness-architectures.md) (table row "Approvals" and the Codex section): Codex `AskForApproval` = `untrusted` / `on-request` / `granular` / `never`, all selectable | At Codex commit `4389a52` (18 Nov 2026), config loading rejects `approval_policy = "untrusted"` with `UnsupportedUntrustedApprovalPolicyError` ("no longer supported; remove this setting") and derives `UnlessTrusted` only when the active project is marked untrusted (`codex-rs/core/src/config/mod.rs:249-252, 4085-4101`); the enum doc calls it an "internal policy for projects marked untrusted" (`protocol/src/protocol.rs:1199-1204`), and `core/config.schema.json:316-345` offers only `on-request`, `granular` and `never`. The variant survives in the app-server v2 protocol, whose tests still pass it as a per-turn override (`app-server/tests/suite/v2/thread_resume.rs:6063`) | ✏️ Corrected in place in harness-architectures.md, with a marker |

Claims the references confirmed without change: the Claude Agent SDK's subprocess-per-session design, Claude-only models, local JSONL transcripts and non-replaceable compaction; the MIT label with Commercial Terms; Pi's four default tools, tree-shaped sessions and lack of a permission system; OpenAI's in-process runner, handoffs, guardrails and JS `SandboxAgent`; and the Vercel `ToolLoopAgent` as a developer-bounded loop.

## Reference architecture review

The eight-layer architecture holds up against the source-level reading of Pi, Codex, the OpenAI sandbox harness and Cloudflare Think (see [harness-architectures.md](harness-architectures.md)). Refinements suggested by that reading:

1. **Session store (layer 3):** model the log as a **tree** (parent ids), not a list, as Pi does. Compaction and forking then become non-destructive.
2. **Sandbox (layer 7):** split into a *sandbox policy* and a separate *approval policy* (Codex), and make "sandbox denied → escalate → re-approve" an explicit flow.
3. **Context policy (layer 5):** compact at three points: a between-turn threshold, mid-turn proactive compaction and one reactive retry on provider overflow (Cloudflare Think, Pi).
4. **Prompt caching (layer 1):** persist the exact frozen system prompt so a resumed session keeps cache hits (Cloudflare Think).
5. **Interfaces:** add a JSONL-over-stdio RPC mode early. It is how every SDK in this space (Codex SDK, Claude Agent SDK, Pi RPC) embeds the harness.
6. **Evidence weighting:** 2610.04433 suggests differences among *mature* harnesses are mostly cost, not pass rate. Prioritize token efficiency (preamble size, tool-definition size) as a primary metric, not just success rate.

## Re-verification against primary sources (R1)

Date: 2026-11-18. Most hosts blocked in the first pass (arxiv.org, modelcontextprotocol.io, huggingface.co, temporal.io, dev.to, developers.openai.com) are now reachable, so every claim the report or its working notes marked "(secondary)" or "search summary" was re-read at the primary source. openai.com still returns 403, and the GitHub API is not enabled for some repositories. Two papers changed between arXiv versions after the first pass (Claw-SWE-Bench v2, Harness-Bench v2), which explains most of the corrections.

| Claim (short) | File | Was | Now | Primary source |
|---|---|---|---|---|
| Lead: harness swap moved Pass@1 19% → 73%; 27.4-pt harness spread | [report](agent-sdks-and-harness-design.md) | v1 abstract figures, via opentrain summary | ✏️ 19% → 71% and a gap of up to 24.3 pts. v2 of the paper (Sept 28, 2026) replaced the v1 figures | [arXiv 2606.12344v2](https://arxiv.org/abs/2606.12344), Table 1, §6.2; [v1 abstract](https://arxiv.org/abs/2606.12344v1) |
| Claw-SWE-Bench: 19.1% vs 73.4% (bare vs full adapter); model spread 29.4, harness spread 27.4 | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md), [observability-evals](notes/observability-evals.md) | Abstract figures (search index); body 19.3/71.2 noted | ✏️ v2: 19.3% vs 71.2% (mean of 3 runs); harness gap up to 24.3 pts across 7 harnesses on Qwen 3.6-flash; 29.4-pt spread for OpenClaw across 11 models. 350 tasks / 8 languages / 43 repos ✅ | [arXiv 2606.12344v2](https://arxiv.org/abs/2606.12344), Table 1, §6.2, Appendix F.1 |
| Harness-Bench: 106 tasks, 5,194 trajectories | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md) | Abstract (search index) | ✏️ Those are v1 (May 2026). v2 (Oct 15, 2026): 300 tasks, 7 harnesses, 10 backends; no harness best on all backends; GLM-5.3 full-credit rate varies 13.5 pts; Nanobot costs 2.97× OpenClaw with a lower full-credit rate | [arXiv 2605.27922v2](https://arxiv.org/abs/2605.27922), abstract; [v1](https://arxiv.org/abs/2605.27922v1) |
| 2605.23950: Opus 4.5 45.9% (SEAL) vs 55.4% (Claude Code) on SWE-bench Pro | [report](agent-sdks-and-harness-design.md) | Confirmed from HTML in the first pass | ✅ Reconfirmed in the PDF (only v1 exists) | [arXiv 2605.23950](https://arxiv.org/abs/2605.23950), §1 and harness table |
| Terminal-Bench 2.0: Opus 4.6 58.0% in Claude Code vs 74.7% in Terminus-KIRA | [report](agent-sdks-and-harness-design.md), [observability-evals](notes/observability-evals.md) | Single secondary source (Vaughan) | ⚠️ Partly corroborated: the official Terminus-KIRA submission's `result.json` records a 74.4% mean over 442 trials. Claude Code's 58.0% is still unverified: the current leaderboard lists no Opus 4.6 entry and the submissions dataset has no Claude Code + Opus 4.6 folder | [TB 2.0 submissions](https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard/tree/main/submissions/terminal-bench/2.0/Terminus-KIRA__Claude-Opus-4.6); [leaderboard](https://www.tbench.ai/leaderboard/terminal-bench/2.0) |
| 2609.32459: OpenHands gain +13.60 → +5.47 (Claude 3.7 → 4 Sonnet); trend reverses on repo generation | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md) | Secondary write-up (agentpatterns.ai) | ✅ Confirmed. Clarified: the gains are over mini-SWE-agent on matched SWE-bench Verified leaderboard rows. Added from the abstract: context compression and general subagents can hurt repository generation | [arXiv 2609.32459](https://arxiv.org/abs/2609.32459), abstract, Table 3 |
| 2609.20804: context-management payoff 35.7 → 2.7 pts (32K → 128K) | [report](agent-sdks-and-harness-design.md) | Secondary summary (hyper.ai) | ✅ Confirmed (35.7 → 15.9 → 5.5 → 2.7, averaged over four models on SWE-bench Verified; driven by overflow failures). Citation moved to arXiv | [arXiv 2609.20804](https://arxiv.org/abs/2609.20804), §3.2 |
| 2610.04433: 45-task hard subset, 5 models, ~13% flips, OpenCode up to −9, 447 tasks for 5 pts | [report](agent-sdks-and-harness-design.md) | Abstract via search index | ✅ Confirmed in the abstract. Note on row 2: the 2.2–6.0-pt rerun spread does appear in the body, but the paper attributes it to Bjarnason et al. (2026), not to its own reruns | [arXiv 2610.04433](https://arxiv.org/abs/2610.04433), abstract, §1–2 |
| 2604.18071: 70 projects, five patterns, language does not predict pattern | [report](agent-sdks-and-harness-design.md) | Abstract; only one pattern confirmed by name | ✅ All five patterns named (lightweight tool, balanced CLI framework, multi-agent orchestrator, enterprise full-featured, scenario-verticalized); language finding is its "Non-co-occurrence 1". Moonlight citation dropped | [arXiv 2604.18071](https://arxiv.org/abs/2604.18071), abstract, Table 14 |
| OpenHands SDK: `LLMSummarizingCondenser` cuts cost up to 2x | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md) | Secondary (emergentmind) | ✅ Stated in the paper, which cites its own team's 2025 blog post (Smith, 2025), so the figure is self-reported. Report now says so | [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §4.6 |
| OpenHands SDK: append-only event log, deterministic replay, `ConversationState` the only mutable part | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md) | Secondary (emergentmind) | ✅ Confirmed | [arXiv 2511.03690](https://arxiv.org/abs/2511.03690), §3.2, §4.2 |
| MAF: checkpointing, pause/resume | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary | ✅ Confirmed; built-in in-memory and file checkpoint storage; all orchestration patterns support checkpointing, HITL approvals and pause/resume | [MAF 1.0 post](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/); [checkpoints](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) |
| MAF license MIT | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary (issoh.co.jp) | ✅ Confirmed via the PyPI license classifier. The GitHub repo was not reachable from the session | [PyPI agent-framework](https://pypi.org/project/agent-framework/) |
| MAF 1.0 GA on April 3, 2026 | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary | ✅ Confirmed (post dated 2026-04-03) | [MAF 1.0 post](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) |
| Semantic Kernel and AutoGen "in maintenance mode" | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary | ✏️ As of November 2026, AutoGen is archived and "no longer maintained"; Semantic Kernel 1.x still gets critical bug and security fixes, with new features going to MAF | [AutoGen README](https://github.com/microsoft/autogen); [SK and MAF](https://devblogs.microsoft.com/agent-framework/semantic-kernel-and-microsoft-agent-framework/) |
| ADK 2.0: "from a hierarchical agent executor to a graph-based execution engine"; breaking changes | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary, cited to the Google blog | ✅ Quote confirmed, but it is from the ADK 2.0 docs, not the blog. Breaking changes named precisely: event schema, session storage, `BaseAgent` → `BaseNode`; `SequentialAgent`/`ParallelAgent`/`LoopAgent` deprecated in TypeScript. GA dates (Python May 19, Go June 30, TS Aug 21, 2026) confirmed | [adk.dev/2.0](https://adk.dev/2.0/) |
| Temporal integration for the OpenAI Agents SDK GA in March 2026 | [report](agent-sdks-and-harness-design.md), [vendor-sdks](notes/vendor-sdks.md) | Search summary | ⚠️ GA date still unverified. ✏️ Report now states what is verifiable: standalone `temporalio-openai-agents` package, Production/Stable since 1.0.0 (2026-09-16); sandbox support still pre-release | [PyPI](https://pypi.org/project/temporalio-openai-agents/); [Temporal docs](https://docs.temporal.io/develop/python/integrations/openai-agents) |
| OpenAI Agents SDK sandbox support launched April 15, 2026 | [vendor-sdks](notes/vendor-sdks.md) | Search summary | ✅ Confirmed (Temporal's April 16 post: "Yesterday, OpenAI shipped sandbox support") | [Temporal blog](https://temporal.io/blog/introducing-temporal-and-agentic-sandboxes-openai-agents-sdk) |
| MCP 2026-07-28: no `initialize` handshake or sessions, routing headers, Tasks as an extension | [report](agent-sdks-and-harness-design.md), [custom-harness](notes/custom-harness-architecture.md) | Search summary; row 14 added a partial primary corroboration | ✅ Confirmed against the spec changelog (SEP-2567, SEP-2575, SEP-2243, SEP-2663); `server/discover` is mandatory for servers; 2026-07-28 is listed as latest. "Reportedly" removed | [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |
| Planning: reflection about 2–4x a ReAct run; tree-of-thought rarely in production | [report](agent-sdks-and-harness-design.md), [custom-harness](notes/custom-harness-architecture.md) | Search summaries | ✏️ About 3x: dev.to says "3x the tokens"; generalcompute counts ~17 calls for a three-attempt Reflexion run vs 5 for its ReAct chain. Neither page gives 2x or 4x. The tree-of-thought sentence now quotes what mlflow says (most such tasks are solved by ReAct). Flagged as illustrative, not measured | [dev.to](https://dev.to/gabrielanhaia/react-plan-and-execute-or-reflection-the-three-agent-patterns-every-engineer-needs-in-2026-355p); [generalcompute](https://www.generalcompute.com/blog/react-reflexion-and-chain-of-thought-the-inference-cost-of-reasoning-patterns?agent=true); [mlflow](https://mlflow.org/articles/types-of-ai-agent-architectures-2026-developer-guide/) |
| OpenCode server "reportedly Hono on Bun, with SQLite sessions" | [report](agent-sdks-and-harness-design.md), [oss-harnesses](notes/oss-harnesses.md) | Third-party write-ups | ✏️ At commit `723e0a9` (Nov 18, 2026) `@opencode/server` is built on Effect's `HttpApi`; Hono appears only in the root dependency catalog. SQLite via Drizzle ✅ | [OpenCode](https://github.com/anomalyco/opencode) `packages/server/package.json`, `packages/core/src/database/` |
| OpenCode compaction is a hidden agent with auto-compact | [oss-harnesses](notes/oss-harnesses.md) | Secondary (cefboud) | ✅ Confirmed: `session/compaction.ts` resolves a `compaction` agent, `auto: true` by default | [OpenCode](https://github.com/anomalyco/opencode) `packages/core/src/session/compaction.ts` at `723e0a9` |
| DeepSeek Harness "reportedly lacks evals and metering" | [report](agent-sdks-and-harness-design.md) | One review (developersdigest) | ✅ Eval gap confirmed in the repo: `BENCHMARK.md` only points to the SDK guide, no scores. "No metering" stays attributed to the review (the repo has a token/context meter, but no billing layer was checked) | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `BENCHMARK.md` at `2e39e70` |
| CodeAct: up to 20% higher success for code actions | [report](agent-sdks-and-harness-design.md), [oss-frameworks](notes/oss-frameworks.md) | Secondary blog (themenonlab) | ✅ Confirmed in the abstract (17 LLMs); CodeAct paper added to the report's sources | [arXiv 2402.01030](https://arxiv.org/abs/2402.01030) |
| Zep disputed Mem0's LOCOMO comparison | [report](agent-sdks-and-harness-design.md), [custom-harness](notes/custom-harness-architecture.md) | Cited only to the Mem0 paper; numbers via search summary | ✅ Confirmed; Zep's post added as the citation. Clarified: 75.14% is Zep's corrected score, 65.99% is what the Mem0 paper reported for Zep | [Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) |
| Sandbox vendors: E2B and Vercel Firecracker, Modal gVisor, Daytona containers | [report](agent-sdks-and-harness-design.md), [custom-harness](notes/custom-harness-architecture.md) | Comparison blogs (secondary) | ✏️ E2B and Vercel Firecracker ✅. Modal says "gVisor or microVMs"; Daytona offers containers and VMs. Cold-start, session-limit and pricing figures still unverified | [e2b-dev/infra](https://github.com/e2b-dev/infra); [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox); [Modal security](https://modal.com/docs/guide/security); [Daytona](https://www.daytona.io/docs/en/) |
| OpenAI: 59.4% of 138 audited SWE-bench Verified tasks flawed | [report](agent-sdks-and-harness-design.md), [observability-evals](notes/observability-evals.md) | openai.com unreachable | ⚠️ Still unverified: openai.com returns 403 and no OpenAI-hosted copy was found on developers.openai.com; third-party GitHub mirrors exist but are not primary. Report now flags it inline | — |
| OpenAI retracted SWE-bench Pro recommendation (July 2026) | [report](agent-sdks-and-harness-design.md) (limits), [observability-evals](notes/observability-evals.md) | Secondary only | ⚠️ Still unverified: primary is on openai.com (403) | — |
| GitHub star counts for the Claude Agent SDK and MAF | [report](agent-sdks-and-harness-design.md) (limits), [vendor-sdks](notes/vendor-sdks.md) | API blocked | ⚠️ Still unverified: the GitHub API was not enabled for those repositories in the R1 session | — |
| Report caveats: lead paragraph and "What this report could not verify" | [report](agent-sdks-and-harness-design.md) | Listed blocked hosts and secondary figures | ✏️ Rewritten to say R1 re-checked the figures, which were confirmed or corrected, and which remain unverified | This table |

Effect on the report's conclusions: none of the corrections reverses a conclusion. The headline adapter effect shrinks slightly (19% → 71% instead of 73%) and the harness spread narrows (24.3 instead of 27.4 points). Harness-Bench v2 strengthens the claim that harness effects depend on the model. 2610.04433's finding that mature harnesses differ mainly in cost is confirmed unchanged.

## Updates after the eighth reference (2026-11-18)

| Claim | Was | Now | Source |
| --- | --- | --- | --- |
| SDKs with a default that reaches outside the process | Four of five (LangChain the exception) | Six of eight: adds Copilot (inherited environment, GitHub login, telemetry) and Cloudflare (`sendIdentityOnConnect`); LangChain and Google ADK are the exceptions | [deep comparison](../comparison/deep-comparison.md#six-of-eight-sdks-have-a-default-that-reaches-outside-your-process) |

## Later closures

Gaps that the research notes recorded and later work closed. Each note stays as written, and the row here records the closure.

| Gap | Recorded in | Closure | Source |
| --- | --- | --- | --- |
| HumanLayer's "12-factor agents" could not be retrieved | [oss-frameworks](notes/oss-frameworks.md) (Gaps, line 162) | ✅ Closed by U9 (2026-11-18): read in a full clone of `humanlayer/12-factor-agents` at commit `d20c728` (2025-09-21, the tip of `main`) and mapped onto our plans in [the 12-factor agents report](external-designs/twelve-factor-agents.md), with its own [fact-check log](external-designs/fact-check-twelve-factor-agents.md). The essay supports the no-framework argument with practitioner experience but no measurements | [12-factor-agents at `d20c728`](https://github.com/humanlayer/12-factor-agents/tree/d20c728368bf9c189d6d7aab704744decb6ec0cc) |
