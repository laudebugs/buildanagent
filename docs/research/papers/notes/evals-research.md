# Raw research notes: general-purpose agent evaluation and benchmarks

Working material for the evals section of the agent-research survey (todo U22). Treat this as a scratchpad; the drafted section and its fact-check table supersede it where they disagree.

## GAIA (arXiv:2311.12983)

- Authors: Grégoire Mialon, Clémentine Fourrier, Craig Swift, Thomas Wolf, Yann LeCun, Thomas Scialom.
- Submitted 21 Nov 2023, v1 only, cs.CL / cs.AI.
- 466 questions requiring reasoning, multi-modality handling, web browsing and tool use; "conceptually simple for humans yet challenging for most advanced AIs."
- Humans scored 92%; GPT-4 with plugins scored 15%.
- 300 of the 466 have withheld answers, feeding a public leaderboard.
- Source: https://arxiv.org/abs/2311.12983

## SWE-bench and SWE-bench Verified

- Original SWE-bench: Jimenez, Yang, Wettig, Yao, Pei, Press, Narasimhan. Submitted 10 Oct 2023 (v1); v3 revised 11 Nov 2024. 2,294 real GitHub issue/PR pairs from 12 popular Python repos. Best 2023 result (Claude 2) resolved 1.96%. Source: https://arxiv.org/abs/2310.06770
- Grading: apply the model's patch to the repo, run the repo's real test suite in a Docker container; FAIL_TO_PASS tests must flip from failing (pre-fix) to passing (post-fix), PASS_TO_PASS tests must keep passing. "Resolved" = all FAIL_TO_PASS and PASS_TO_PASS tests pass. Source: https://www.swebench.com/SWE-bench/guides/evaluation/
- SWE-bench Verified: OpenAI + SWE-bench team, announced 13 Aug 2024. 500-task human-filtered subset of the original 2,294. 93 Python-experienced developers screened 1,699 sampled tasks; each was triple-labeled and the most severe flag kept (conservative filtering) to confirm problem clarity, correct test patches and solvability. GPT-4o resolved 33.2% on launch; Agentless roughly doubled its prior 16% score. Source (via search, OpenAI blog is 403 to our fetcher): https://openai.com/index/introducing-swe-bench-verified/, corroborated by https://swebench.com/verified
- swebench.com/verified also documents a "Bash Only" comparison mode that runs models through **mini-SWE-agent**, described there as a minimal bash-only ReAct loop with no tool-calling interface, used for apples-to-apples baseline comparison. Source: https://www.swebench.com/verified and https://github.com/SWE-agent/mini-swe-agent (repo: "~100 lines of Python," no tools besides bash, "consider mini-swe-agent your default choice," repo claims >74% on SWE-bench Verified as of its current version).
- Contamination/gaming critiques as of November 2026 (secondary sources throughout, since none of OpenAI's "why we no longer evaluate" post was fetchable — it returned 403):
  - OpenAI said in Feb 2026 it would stop reporting SWE-bench Verified scores, citing rising contamination risk because the underlying GitHub repos are used in training data, and initially pointed to SWE-bench Pro instead. [secondary, via web search] Source title: "why we no longer evaluate swe bench verified" (openai.com, 403 to fetch tool).
  - Epoch AI rates SWE-bench Verified "Flawed" in its benchmark review; flags high contamination risk (first flagged ~June 2025) because the benchmark is static and widely used in training corpora, and finds results are scaffold-dependent. [secondary] https://epoch.ai/benchmarks/swe-bench-verified/review
  - "The SWE-Bench Illusion" (arXiv:2506.12286) argues reported gains partly reflect memorization: performance drops to as low as 53% on tasks from repos *not* in SWE-bench's training distribution, and one model variant reportedly solved ~76% of a repo-identification/context-free probe, read as a contamination signal. [secondary summary; should fetch primary abstract to confirm numbers before citing in final doc]
  - A Dec 2025 arXiv paper on SWE-rebench reports lower resolution rates on fresher splits than on the original SWE-bench, read as evidence of leakage in popular LLMs trained on the original. [secondary]
  - The Agentic Benchmark Checklist paper (arXiv:2507.02825, Zhu et al., 24 co-authors incl. Percy Liang, Daniel Kang, Jacob Steinhardt; submitted 3 Jul 2025, v5 7 Aug 2025) says SWE-bench Verified "uses insufficient test cases," so a passing patch may not be a correct one — an outcome-validity failure distinct from training contamination. Applying their checklist to CVE-Bench cut performance overestimation by 33% (relative). [primary, fetched directly]
  - Per search summary only: OpenAI reportedly retracted its SWE-bench Pro recommendation around July 2026 after an audit found ~30% of its tasks broken. [secondary, unverified against a primary source — flagged, not to be stated as fact without confirmation]

## AgentBench (arXiv:2308.03688)

- 22 authors incl. Xiao Liu, Hao Yu, ... Jie Tang (Tsinghua/THUDM-affiliated group).
- v1 submitted 7 Aug 2023; v2 25 Oct 2023; v3 4 Oct 2025 (later typo/metadata revision). Published at ICLR 2024.
- 8 distinct interactive environments (OS, database, knowledge graph, digital card game, lateral thinking puzzles, house-holding, web shopping, web browsing) testing LLMs as agents.
- Finding: commercial models (GPT-4 era) far ahead of open-source models up to 70B; failures attributed mainly to weak long-term reasoning, poor decision-making, weak instruction-following; code training has mixed effects.
- Source: https://arxiv.org/abs/2308.03688

## tau-bench / τ-bench (arXiv:2406.12045) and τ²-bench successor (arXiv:2506.07982)

- τ-bench: Yao, Shinn, Razavi, Narasimhan. Submitted 17 Jun 2024, v1 only.
- Simulates a dynamic conversation between an LM-simulated user and an agent with domain-specific API tools + written policy ("guidelines"); success = final database state matches an annotated goal state. Introduces pass^k reliability metric across repeated trials. gpt-4o-era agents resolve <50% of tasks; pass^8 <25% in the retail domain — i.e., reliability collapses even where single-shot success looks decent.
- Source: https://arxiv.org/abs/2406.12045
- τ²-bench successor: Barres, Dong, Ray, Si, Narasimhan. Submitted 9 Jun 2025.
- Adds a dual-control domain (Telecom, modeled as a Dec-POMDP) where the user, not just the agent, must act on shared state through tools — closer to real tech-support interactions than τ-bench's agent-only-acts setup. Adds a compositional task generator and a user simulator "tightly coupled with the environment." Reports large score drops moving from no-user to dual-control conditions.
- Source: https://arxiv.org/abs/2506.07982
- Gaming critique: Agentic Benchmark Checklist paper (above) reports a trivial/null agent passes 38% of τ-bench tasks because the grader counts empty responses as successful — an outcome-validity bug, not a model capability result.

## Two November 2026 papers (read primary abstracts directly, not the triage paraphrase)

### "Reducing Inference Cost of Coding Agents with Timeout Cascades" — arXiv:2611.24324

- Authors: Boxi Zhou, German Sviridov, Dmitrii Ustiugov, Haris Javaid. Submitted 18 Nov 2026. cs.AI (primary), cs.SE.
- Evaluates 36 open-weight models released since 2024 on SWE-bench Verified; finds small models have closed much of the accuracy gap with large ones on easy/medium tasks, with the remaining gap concentrated in hard tasks.
- Proposes a timeout cascade: try a small/cheap model first, escalate to a larger model only on timeout/failure.
- Reports up to 33% reduction in total GPU-hour cost in the regime they test, 16.4% reduction across all tasks, "without sacrificing accuracy" (their framing); nearly matches an oracle task router with no learned router needed.
- Note: this is a cost-engineering paper layered on SWE-bench Verified, which inherits that benchmark's contamination caveats above — the accuracy claims should be read with that in mind.

### "EnvAgent: Multi-Agent Approach to Building Science Environments in the Clouds" — arXiv:2611.23258

- Authors: Yiming Cheng, Chris Low, Binrui Huang, Mengshi Zhang, Zihao Chen, Kate Keahey, Paul Marshall, Kexin Pei. Submitted 1 Oct 2026. cs.SE (primary), cs.AI; accepted at AI4S@SC26 workshop; CC BY 4.0.
- Problem: repositories describe OS/toolchain/dependency/build requirements inconsistently; hand-written Dockerfiles don't scale and can bias evaluations that depend on them.
- EnvAgent: an agentic framework (deterministic Docker-execution/state tools + coordinated agents for repo analysis, planning, Dockerfile synthesis, iterative failure diagnosis/repair) that builds and verifies repo-level Docker environments automatically.
- Introduces **ENVBENCH**: 54 scientific/open-source repos across 7 languages, sourced from Chameleon Trovi and Multi-SWE-bench, each with a declarative rubric of required structure/config/functionality; a shared evaluator applies 2,108 weighted checks.
- Results: EnvAgent builds 43.5/54 executable environments on average vs. 23.5/54 for Codex and Claude Code baselines (matched LM settings); composite executability+rubric score of 62.02 vs. 24.19 for baselines.
- Relevance: this is directly about the problem our verification harnesses and sandbox conformance suite also face — building a correct, repeatable execution environment per repo — and ENVBENCH is itself a candidate benchmark/methodology to watch for our own environment-build todos (N15-N19, W1).

## Benchmark-validity critiques, general (as of November 2026)

- Best primary source found: Agentic Benchmark Checklist (arXiv:2507.02825) — systematic audit-derived checklist, concrete named failures in SWE-bench Verified and τ-bench (above), reduces overestimation 33% on CVE-Bench when applied.
- Secondary/weaker sources (not relied on for factual claims in the drafted section beyond flagging their existence): a DEV Community post on "AI agent benchmarks are broken" (low rigor, unsourced R² claim — excluded from the draft); Epoch AI's "Flawed" rating of SWE-bench Verified (an evaluator's own characterization, treated as secondary judgment, not raw data); OpenAI's own post explaining why it stopped using SWE-bench Verified (could not fetch primary; relying on search-result paraphrase, flagged as secondary in the draft).
- No credible primary source found specifically critiquing GAIA's or AgentBench's validity (as opposed to SWE-bench/τ-bench) — said so plainly in the draft rather than inventing a critique.

## Current status of our own eval todos (checked docs/todos/ready/ and done/ on 2026-11-19)

All still open, under their original IDs, none done yet:
- A17-eval-tasks-graders.md — deferred per owner note until Round A triage resumes; depends on A15, N36.
- N36-eval-reports-replay.md — report format, mini-swe-agent trajectory converter, offline replay suite; depends on N35.
- N37-inspect-bridge.md, N38-seed-suite-baseline.md (20 HD8 seed tasks + W12's 10 coding-agent tasks + N38b's 10 shared-triage tasks = 30 before baseline), N39-ablation-runs.md.
- W12-coding-agent-eval-tasks.md — on hold per owner note (2026-11-19) until the owner says go; depends on N38, W2.
- No todos found literally titled "N36-N39" that have changed ID or moved to done/ — confirmed via `ls docs/todos/ready/` and `ls docs/todos/done/`.
