# Raw research notes: provenance, verification, and eval governance papers (Nov 2026)

Working material behind `section-provenance-draft.md`. The draft and its fact-check supersede these notes where they disagree.

## Source list (from docs/research/papers/notes/arxiv-2026-11-18-snapshot.md)

- #15 arXiv:2611.24039 — A Capability Framework for Evaluating Agentic AI Platforms in Regulated Enterprises — Ali, Siddiqui, Zahid — snapshot: 18 Nov 2026
- #19 arXiv:2611.23678 — Evaluating Governed LLM-Driven ML Experimentation: Lifecycle, Provenance, and Failure Metrics — Wong — snapshot: 17 Nov 2026 (arXiv page itself: 18 Nov 2026 — discrepancy, see fact-check)
- #35 arXiv:2611.23234 — Tracing the Messy Middle: A Runtime Transaction Schema for AI Coding Agents — Hou, Li, Chen, Chen — snapshot: 11 Aug 2026 (also what the arXiv page reports, despite the "2611" id prefix — unresolved oddity, not asserted with a date in the draft)
- #39 arXiv:2611.23142 — Mind the Gap: A Deployed Multi-Agent System for Documentation Maintenance — Masoero — snapshot/arXiv: 17 Nov 2026
- #40 arXiv:2611.23074 — Runtime Verification of Multiple Natural Language Criteria for Agent Governance — Pitis, Alamdari, Tang, Klassen, McIlraith — snapshot/arXiv: 17 Nov 2026
- #47 arXiv:2611.22841 — Verifying Agents in Rubric-Graded Environments — Dücker, Kumar, Liu, Chaudhary, Plesner, Guzmán, Athalye — snapshot/arXiv: 17 Nov 2026

## Per-paper notes (from fetching each arXiv abstract page directly)

**#15 Ali et al.** Bank innovation-lab evaluation of 10 agentic AI platforms. Cross-functional panel, 9 capability dimensions, 3 financial-services workloads. Scores fell into 3 tiers. Secondary analysis: very high internal consistency across dimensions → halo effect (demo-based scoring rewards presentation over capability). Proposal: four-layer gate-then-score protocol + trace-level reliability metrics + autonomy-readiness scale + reproducibility protocol. Notes a controlled harness is needed to turn this into real measurement.

**#19 Wong.** Governed harness for LLM-driven ML experimentation. Control plane (not the LLM) manages each trial's lifecycle: scope-checks edits, decides keep/discard, writes every trial to an append-only ledger. Governance metrics computed from the ledger: invalid-action rate, repeated-bad rate, provenance completeness. 6 ML tasks, 1,445 trials. Ledgers released for reproduction.

**#35 Hou et al.** Argues existing agent-output datasets (patches/commits/benchmark results) miss failed retries, fallback strategies, routing decisions, and abandoned sessions — the stuff that drives cost and reliability. Proposes an observability framework recording these as structured runtime "transaction records." Prototype: Atm (Agent Token Manager), local-first, reconciles gateway records with transcript evidence, does not send prompt content to external collectors. Three open research problems named: (1) trace reconciliation without shared request identifiers, (2) outcome linking across asynchronous systems, (3) intervention causality.

**#39 Masoero.** TriAgent: multi-agent system that finds documentation that has drifted from code/tickets and proposes repairs. Deployed, 43 days of shadow-mode operation: 499 tickets triaged, 92 doc gaps surfaced. LLM judge panel: 81.1% of verifiable assertions judged correct. Human and agent replies found complementary, not redundant. Repairing a gap improved the agent's later answers to the same ticket (a feedback-loop finding).

**#40 Pitis et al.** VFM: tree-attention verifier. Scores many natural-language criteria against one agent output in parallel, returns per-criterion verdict: satisfied / violated / not-applicable. Pretrained on CriteriaBank, ~394K labeled examples. A fine-tuned 4B model beats GPT-5.4 on a synthetic governance benchmark; outperforms DynaGuard-4B on trace-level failure detection. CriteriaBank pretraining helps cross-domain transfer especially with little data. Perf: 1,000 criteria vs. a 4K-token context in <2s on one H100, <11GB VRAM. Per-criterion verdicts can pinpoint which rule was violated and trigger escalation to a bigger judge model.

**#47 Dücker et al.** First systematic study of verifiers grading agent outputs against multiple NL criteria. Release BankerVerifierBench: 2,464 human-judged rubric criteria, 24 investment-banking tasks. Derive a taxonomy of verifier capabilities → distill into 3 design principles → implement as Gandalf, an open-source verifier. Gandalf matches/beats existing verifiers on F1 at lower cost; also performs well on OpenClaw (a personal-productivity environment, different domain). Releasing benchmark + Gandalf + code/data.

## Repo cross-references checked

- AGENTS.md "Planned architecture" point 3: "Append-only, tree-shaped session event log." (exact wording)
- N2 (`docs/todos/ready/N2-session-entries-schema.md`): defines `SessionEntry` union, `permission_decision`, namespaced `product_record` entries, JSON Schema generation, stable-surface marking. Depends on N1, B2 (done). Backed by ADR 0013 (entry-per-content-block, status Proposed/provisional until N35) and ADR 0018 (retention + stable entry base, status Accepted, amended by ADR 0056 on 2026-11-19 re: memory-delete purge).
- ADR 0039 (`docs/decisions/0039-check-and-deploy-gate.md`): Accepted 2026-11-18. Gate type-checks, runs tests against mock model with host tools denied by name, runs evals scored by graders the generator cannot read/edit, signs a report per commit; deploy adapters require a passing signed report; graders live in the platform, never the user's repo; every later deploy re-runs the gate. Consequences point to F3/F4 (gate build) and F15 (tests whether generated project can read/alter graders).
- A22 (`docs/todos/ready/A22-shadow-metrics.md`): shadow-mode rollout machinery — `assertStageReady()`, `shadowHelpdesk()`, `joinShadowLabels()`, `dashboardRows()`, `sampledJudgeScore` (null until A20 calibrates a judge). Explicitly deferred (header note, 2026-11-18) until the triage round resumes per ADR 0032; still filed under `ready/`, not withdrawn.
- ADR 0032 (`docs/decisions/0032-personal-coding-agent-first.md`): Accepted 2026-11-18. Coding agent (one user, owner's repos, owner's key) replaces the triage agent as the first agent on the stack (M7). Triage plan, AD1–AD14, ADRs 0022–0031, and todos A1–A24 are deferred, not withdrawn.
- `docs/research/reversible-actions/sagas.md`: sagas = sequences of local transactions with semantic (not state-restore) compensation; relevant one-sentence cross-reference for Hou et al.'s point about retries/fallbacks/abandoned sessions needing structured recording — the same partial-failure shape that sagas are built to compensate for.

## Searches run to confirm no better-fitting todo ids exist

- `grep -rli shadow docs/todos/{ready,done,ongoing}` → hits: A22-shadow-metrics.md (current), plus A24, A23, A2, A18, A16, A20, N12, F15, A11, T25 (incidental "shadow" mentions, not dedicated shadow-eval todos), and one in docs/todos/done/G3a-research-agent.md. A22 is the one dedicated shadow-metrics todo; confirmed still in `ready/`, not renamed or renumbered since AGENTS.md/snapshot was written.
- Confirmed via `ls docs/decisions/ | grep -i check` that ADR 0039 is still the current check-and-deploy gate ADR (no newer ADR supersedes it as of this check).
