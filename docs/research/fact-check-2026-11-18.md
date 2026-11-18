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

Claims the references confirmed without change: the Claude Agent SDK's subprocess-per-session design, Claude-only models, local JSONL transcripts and non-replaceable compaction; the MIT label with Commercial Terms; Pi's four default tools, tree-shaped sessions and lack of a permission system; OpenAI's in-process runner, handoffs, guardrails and JS `SandboxAgent`; and the Vercel `ToolLoopAgent` as a developer-bounded loop.

## Reference architecture review

The eight-layer architecture holds up against the source-level reading of Pi, Codex, the OpenAI sandbox harness and Cloudflare Think (see [harness-architectures.md](harness-architectures.md)). Refinements suggested by that reading:

1. **Session store (layer 3):** model the log as a **tree** (parent ids), not a list, as Pi does. Compaction and forking then become non-destructive.
2. **Sandbox (layer 7):** split into a *sandbox policy* and a separate *approval policy* (Codex), and make "sandbox denied → escalate → re-approve" an explicit flow.
3. **Context policy (layer 5):** compact at three points: a between-turn threshold, mid-turn proactive compaction and one reactive retry on provider overflow (Cloudflare Think, Pi).
4. **Prompt caching (layer 1):** persist the exact frozen system prompt so a resumed session keeps cache hits (Cloudflare Think).
5. **Interfaces:** add a JSONL-over-stdio RPC mode early. It is how every SDK in this space (Codex SDK, Claude Agent SDK, Pi RPC) embeds the harness.
6. **Evidence weighting:** 2610.04433 suggests differences among *mature* harnesses are mostly cost, not pass rate. Prioritize token efficiency (preamble size, tool-definition size) as a primary metric, not just success rate.
