# Raw notes: tool-use/skill security, capability modeling, authority boundaries

Working material behind `section-tool-security-draft.md`. The draft and its fact-check supersede these notes where they disagree.

## Source triage

Started from `docs/research/papers/notes/arxiv-2026-11-18-snapshot.md` rows #13, #24, #33 (the [R]-tagged tool/skill-security and authority cluster). Read `AGENTS.md` first (architecture point 7: pluggable sandbox interface, separate sandbox/approval policies, no credentials in the sandbox; the multi-user tenant-isolation paragraph citing ADR 0037/0039/0042). Then read `docs/research/browser-use/browser-use.md`'s security section (lines ~146-176) to avoid repeating its lethal-trifecta/Rule-of-Two/CaMeL/WASP coverage.

Checked `docs/todos/ready/` and `docs/todos/done/` listings directly rather than trusting the snapshot notes' old id guesses: A3, N12, N22, N23, N20, N43, F11, F15 all still exist as current ready-todo filenames. No stale ids found for this section's needs.

## Paper notes (from direct arXiv abstract-page fetches, 2026-11-19)

### #13 SkillCFI — arXiv:2611.24185
- Full title: "Guarding the Kingdom of Skill-Based Agents in the AI Dynasty of Computation: Control-Flow Integrity for Agent Skills." Authors: Bonan Ruan, Yuhao Sun, Jiahao Liu, Qixiao Lin, Jian Mao, Zhenkai Liang. Submitted 18 Nov 2026 (v1). cs.CR.
- Core move: classical control-flow integrity (CFI) confines a program to a control-flow graph fixed ahead of time; agent skills put that control flow into prompt text instead, so the LLM decides the next step at runtime. SkillCFI compiles a skill into (a) agent instructions and (b) an executable contract, then a deterministic runtime enforcer admits a tool request only on trusted evidence, refusing unmediated channels (e.g., a skill's inline script).
- Numbers: blocked all 240 tested violations that a plain permission allowlist would admit; legitimate tasks completed almost as often as with no enforcement; refusal messages that list the next legal step raised model recovery from 21% to 65%; checking overhead ~2% of task time; 0 of 53 public skills tested passed as written (all needed rewriting to fit a fixed control-flow graph).
- Relevance: our N22 (in-process extensions: trust tiers, project trust gate, content-hash pin) and N23 (skills: advertise by name/description/path, record loads, read AGENTS.md, plan/progress file convention) check *what loads* and *whether it's pinned*, not *what the loaded skill can cause the agent to do at runtime*. SkillCFI's result (0/53 skills pass unmodified) suggests a real gap between a skill's advertised steps and its possible steps that a hash pin does not close.

### #24 ACaM — arXiv:2611.23507
- Full title: "ACaM: Automated Capability Modeling for Agentic AI Security." Authors: Monika Santra, Dhilung Kirat, Qiushi Wu, Kevin Eykholt, Xiaokui Shu, Ian Molloy. Submitted 17 Nov 2026 (v1). cs.CR.
- Problem framed: agents get tool access to credentials/data/services based on trusting a natural-language tool description; nothing checks the description against the implementing code. Gap name: "Description-Code Inconsistency." Resulting attack: "capability laundering" — dangerous code behavior omitted from the description.
- Method: neurosymbolic — static analysis derives actual tool capabilities from code; an LLM supplies only behavioral/semantic labeling, not the capability extraction itself. Builds an "Agent Capability Property Graph" to trace threat chains across multiple tool calls (not just one tool in isolation).
- Numbers: evaluated on 43 real-world agents; 98.3% macro-F1 for capability-property recovery against 24 hand-annotated agents; found hundreds of structural vulnerabilities; 10 confirmed with proof-of-concept exploits.
- Relevance: our A3 (tool-contract lint: `AgentTool`, `toolError()`, `lintTools()` fails build on a "weak contract") and N12 (permission pipeline: ordered, deny-first, decides each call) both operate on the *declared* contract/tier. ACaM is a sibling check at a different layer: verify the implementation's actual reachable capability against what the contract declares, which A3's lint (schema/shape) and N12's pipeline (declared risk tier) do not do today.

### #33 Staron CI/CD authority-escalation study — arXiv:2611.23251
- Full title: "Who Changed the AI Agent's Rules? Measuring How AI Coding Agents Escalate Authority in CI/CD Pipelines." Author: Miroslaw Staron. Submitted 24 Sep 2026 (v1). cs.SE; ACM classes D.2.6, D.2.8.
- Method: joint penalty model P(M) = execution cost + governance risk, applied to 932,791 agent-authored pull requests from the AIDev dataset across five agent implementations. Classifies PR changes as control-plane (CI/CD workflows, permission settings) vs. data-plane (ordinary code).
- Findings: control-plane changes carry a much higher mean joint penalty than data-plane changes; governance-risk differences between agent implementations persist after controlling for execution cost and merge rate (i.e., not just "riskier agents are also slower/less-merged"); manual check of 34 PRs gave the authority-scope classifier Cohen's kappa 0.72.
- Relevance: directly empirical support for treating a change to CI/CD config/permissions as a different risk class than an ordinary code change. Our ADR 0036 (loop outside sandbox, PR merge is the commit point) and ADR 0039 (signed gate report per commit, no deploy without one) don't currently distinguish control-plane diffs from data-plane diffs for approval strictness. F15 (security review) and F11 (generated-code isolation) are the todos where that distinction would most naturally land.

## Broader tool-use-security literature check

Checked `browser-use.md`'s security section before deciding whether a fourth, more foundational paper was needed. It already cites, as primary or named sources: Willison's "lethal trifecta" post, Meta's Rule of Two blog, Google's Chrome-agent blog (User Alignment Critic, Origin Sets), OpenAI/Atlas commentary, CaMeL (arXiv:2503.18813), AgentDojo-based benchmarks, WASP (arXiv:2504.18575), VPI-Bench (arXiv:2506.02456), BrowseSafe/BrowseSafe++ (arXiv:2511.20597, arXiv:2610.17457), NIST CAISI red-teaming work, and a Gray Swan/CAISI paper (arXiv:2603.15714). That is the standard prompt-injection-via-tools canon as of November 2026. None of it addresses control-flow confinement of a skill's execution, static capability extraction from tool code, or empirical authority-escalation measurement in CI/CD — the three gaps the November papers fill. Decision: no additional foundational paper added; cross-referenced `browser-use.md` instead of repeating it, per the task instructions.

## Open follow-ups not resolved in the drafted section

- Whether a code-level capability check (ACaM-style) belongs inside A3's lint (build-time) or as a separate, slower static-analysis pass gating a different point (e.g., tool registration or CI) is a design question for whoever picks up A3, not something this research note should decide.
- Whether N43 (remote `SandboxClient` egress policy compiled per backend) should also carry a control-plane/data-plane distinction for which diffs can touch it was considered but left out of the drafted section, since N43 is about sandbox egress mechanics, not PR/commit review — Staron's finding bears on F15/ADR 0039 more directly.
