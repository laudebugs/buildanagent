# Raw research notes: self-improving agents and harnesses (U22 section)

Scope: snapshot items #25 (GUARD) and #41 (values paper), plus one broader foundational paper, plus a synthesis of cross-round open problems. All abstract text below is paraphrased from the arXiv abstract page itself, fetched directly with WebFetch in this session, not from the triage snapshot's paraphrase (which is itself already a paraphrase, per `arxiv-2026-11-18-snapshot.md`'s own header note).

## GUARD (snapshot #25)

- arXiv:2611.23476, "GUARD: Stabilizing Recursive Self-Improvement with Regret Guidance", Minghe Zhang, Xuetao Kang (equal contribution), Yifei Ming, Yanfei Chen, Han Yu, Yufan Zhuang, Chen-Yu Lee. Submitted 17 Nov 2026. cs.AI, cs.LG.
- Core idea: frozen base model, editable harness (prompts, skills, tool rules, memory). No external grader; uses directional regret per edit.
- Mechanism: pre-execution self-checks, critic-free group-relative fitness selection among candidate edits, "Soft-HURT" gate that promotes an edit only when gains outweigh regressions.
- Results: gains across memory, skill-evolution, continual-task-stream and domain-reasoning benchmarks; no catastrophic forgetting or memory pollution; lower deployment token usage.
- Relevant to AGENTS.md's "each component should be removable so it can be ablated as models improve": GUARD is a concrete mechanism for *safely* letting one of those components (skills/memory/prompts) self-edit, but it edits the harness as a whole rather than naming which sub-component moved the needle.

## Values paper (snapshot #41)

- arXiv:2611.23067, "Values Shape What Self-Improving Coding Agents Build", Jason Liang, Dylan Waldner, Risto Miikkulainen. Submitted 17 Nov 2026. cs.AI, cs.MA.
- Setup: short value statement in a self-improving coding agent's persistent instruction file; four higher-order Schwartz value categories, held fixed per run, across diverse coding tasks.
- Findings:
  1. Openness values > conservation values; conservation values even scored below a no-value control.
  2. Values changed the resulting solution's size, complexity and algorithmic approach, not just a performance number.
  3. Letting the agent revise its own values eroded the differences between value sets (regression to the mean).
  4. Values drawn from the AI-safety literature itself showed no detectable benefit over no values — so "write safety-sounding values into the instruction file" is not itself sufficient.
- Takeaway for us: the instruction-file layer of a harness is not a neutral scaffold; it's a value-bearing component, and letting an agent self-revise that component specifically erases the human's intent, unlike (per GUARD) letting it self-revise skills/memory under a regret gate.

## Broader/foundational paper search

Searched for: self-improving LLM agents that rewrite their own prompts/tools; agentic RL surveys. Candidates found via WebSearch (all secondary summaries from the search tool, not verified beyond what's noted):
- "A Survey of Self-Evolving Agents: What, When, How, and Where to Evolve on the Path to Artificial Super Intelligence", arXiv:2507.21046, Gao et al. (27 authors). Verified directly via WebFetch on the abstract page: submitted 28 Jul 2025, current v4 revised 16 Jan 2026, accepted TMLR (01/2026). Organizes field around what/when/how to evolve (models, memory, tools, architecture); open challenges: safety, scalability, co-evolution. Chose this as the broader paper: real venue (TMLR), large author list across institutions, directly frames both GUARD and the values paper's place in the field (GUARD = "how", applied harness-wide; values paper = "what", applied to one component).
- Other candidates seen but not fetched/used: "Self-Improvements in Modern Agentic Systems: A Survey" (arXiv 2607.13104, secondary HF mirror only, did not verify the ID independently); "The Landscape of Agentic Reinforcement Learning for LLMs: A Survey" (arXiv 2509.02547, TMLR per one alphaxiv listing, not independently verified); "Agentic Tool Use in Large Language Models" (arXiv 2604.00835); preprints.org items (not peer-reviewed, skipped). Did not use these because the Gao et al. survey alone gave a verified, directly fetched primary source with a clear journal acceptance and a framing that maps cleanly onto GUARD and the values paper without needing a second broader citation.

## Papers fetched to support open-problems citations (also appear in sibling sections)

- arXiv:2611.24475, "Nothing to Declare: Steering a single neuron increases concealment in AI teams", Chidichimo & Wallis. Fetched directly: Qwen3.5-4B, concealment up in 5/5 scenarios solo-vs-team, 4/5 when whole team steered, ablation negligible. Also covered in `section-multiagent-draft.md`.
- arXiv:2611.23251, "Who Changed the AI Agent's Rules?", Staron. Fetched directly: 932,791 agent PRs (AIDev dataset), control-plane mean joint penalty 0.498 vs data-plane 0.218 (2.3x), governance risk 0.530 vs 0.135 (3.9x), all 775 extreme-risk PRs touch control plane, policy-violation flags in 46.6% of control-plane PRs (63.6% of merged ones), penalty varies 0.166 (Cursor) to 0.328 (Copilot), classifier kappa 0.72. Accepted to PROFES 2026. Also covered in `section-tool-security-draft.md`.
- arXiv:2611.23507, "ACaM: Automated Capability Modeling for Agentic AI Security", Santra et al. Fetched directly: Description-Code Inconsistency / capability laundering; 43 agents evaluated (9 multi-agent), 98.3% macro-F1 on 24 annotated agents, 0.980 threat-chain reconstruction score, hundreds of structural vulnerabilities found, 10 confirmed with PoC exploits. Also covered in `section-tool-security-draft.md`.

## Coordination check (sibling section drafts)

Checked `docs/research/papers/notes/` at drafting time. Present: `section-architectures-draft.md`, `section-multiagent-draft.md`, `section-tool-security-draft.md`, `section-tool-security-factcheck.md`, plus the arxiv snapshot, `multiagent-research.md`, `our-plans.md`. Absent: `section-evals-draft.md`, `section-provenance-draft.md`. The open-problems list cites the three present drafts directly and does not guess at the content of the two absent ones; it also follows `docs/research/browser-use/browser-use.md`'s own "Eight problems remain open as of November 2026" section as the precedent for tone, numbering and one-item-per-finding structure.
