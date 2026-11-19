# Raw notes: arXiv "ai agents" search, newest 50, fetched 2026-11-19

Source: <https://arxiv.org/search/cs?query=ai+agents&searchtype=all&abstracts=show&order=-announced_date_first&size=50>, fetched via WebFetch on 2026-11-19. Page header: "Showing 1-50 of 12,920 results for all: ai agents" (searching archive cs). This is the newest 50 of a date-sorted query, not a relevance- or citation-ranked list, so it is a snapshot of one day's submissions (17-18 Nov 2026 announce dates), not a survey of the field. Treat it as a triage input, not as "the literature". These are working notes; the report and its fact-check supersede them where they disagree. Abstracts below are paraphrased (1-2 sentences) from the search-results page text, not reproduced verbatim; follow each arXiv link for the full abstract.

Relevance tags: **[R]** relevant to our SDK/harness/coding-agent/platform plans (follow up); **[~]** tangential, maybe citable; **[-]** out of scope (domain application, hardware, not agent-architecture/safety/eval).

1. [-] arXiv:2611.24932. Knowing What You Know: A Trait Theory of Reviewer Value in Human-AI Cognitive Systems. Sinha, Pandey. 18 Nov 2026. cs.AI cs.CE cs.HC cs.LG.
2. [-] arXiv:2611.24888. Who are you? The Personal Imitation Game. Wellyanto et al. 18 Nov 2026. cs.HC cs.AI cs.CL.
3. [~] arXiv:2611.24887. Ground, Iterate, Trace: Decomposing AI Research Ideation. Yu et al. 18 Nov 2026. cs.CL. Agentic research-ideation framework (CAR) with a literature knowledge graph and traceable conceptual operators.
4. [-] arXiv:2611.24880. Local AI Agents in Power Electronics Simulation. Li et al. 18 Nov 2026. cs.AI eess.SY.
5. [-] arXiv:2611.24845. Vibe-Trading: Towards Agent-Native Trading. Wu et al. 18 Nov 2026. cs.AI cs.CL cs.MA q-fin.CP q-fin.TR.
6. [-] arXiv:2611.24788. Isabelle Pool Server. Ren, Li. 18 Nov 2026. cs.LO cs.AI.
7. [-] arXiv:2611.23507. (placeholder removed; see #24)
7. [-] arXiv:2611.24588. LLMs or AI Agents for English to Arabic Translation? Iguenfer, Chtouki. 18 Nov 2026. cs.CL.
8. [-] arXiv:2611.24535. ProbMedTOD. Saley et al. 18 Nov 2026. cs.CL.
9. [R] arXiv:2611.24475. Nothing to Declare: Steering a single neuron increases concealment in AI teams. Chidichimo, Wallis. 18 Nov 2026. cs.CL cs.AI. Steering one neuron in Qwen3.5-4B increases concealment decisions more in multi-agent teams than solo, across five scenarios. Multi-agent deception/safety.
10. [~] arXiv:2611.24379. MoE-Context: Show the Model Only What It Needs. Navale. 18 Nov 2026. cs.AI cs.CL cs.LG. Per-step context-block selection; small synthetic-task result with Qwen3-1.7B. Context engineering, adjacent to memory (U18).
11. [-] arXiv:2611.24347. automodel: A Skill for Agentic Model Discovery. Virgolin et al. 18 Nov 2026. cs.AI astro-ph.CO astro-ph.GA cs.NE.
12. [R] arXiv:2611.24324. Reducing Inference Cost of Coding Agents with Timeout Cascades. Zhou et al. 18 Nov 2026. cs.AI cs.SE. Small-model-first, escalate-on-timeout cascade; up to 33% GPU-hour cost cut on SWE-bench Verified. Directly relevant to coding-agent cost control.
13. [R] arXiv:2611.24185. Guarding the Kingdom of Skill-Based Agents: Control-Flow Integrity for Agent Skills. Ruan et al. 18 Nov 2026. cs.CR. SkillCFI: compiler + runtime enforcer confining agent skills to a fixed control flow. Directly relevant to our skills/extensions sandboxing (N22/N23).
14. [~] arXiv:2611.24165. MemoSync: Co-Managing Developer-Agent Metamemory Across Contexts. Zhang et al. 18 Nov 2026. cs.HC cs.SE. Agent proposes memory items, developer reviews/edits; N=132 study shows better task performance. Overlaps U18 (memory); the developer-review angle is new.
15. [R] arXiv:2611.24039. A Capability Framework for Evaluating Agentic AI Platforms in Regulated Enterprises. Ali et al. 18 Nov 2026. cs.AI cs.MA stat.ML. Bank's evaluation of ten agent platforms; finds a halo effect in demo-based scoring; proposes gate-then-score protocol. Directly relevant to our check-and-deploy gate (ADR 0039).
16. [-] arXiv:2611.23855. RoboBuilder. Nehme et al. 18 Nov 2026. cs.AI cs.CV cs.RO.
17. [-] arXiv:2611.23847. Great Listeners, Poor Decision-Makers: Rethinking Agentic Audio AI. Latif et al. 17 Nov 2026. cs.SD.
18. [-] arXiv:2611.23747. Heuristic/Human-Sensitive/Self-Play DRL in Human-Agent Teaming. bin Kamruddin et al. 17 Nov 2026. cs.MA cs.HC.
19. [R] arXiv:2611.23678. Evaluating Governed LLM-Driven ML Experimentation: Lifecycle, Provenance, and Failure Metrics. Wong. 18 Nov 2026. cs.AI cs.LG cs.SE. Scores ML-experiment agents on process/provenance via a governed harness and append-only ledger. Relevant to our session event log and gate design.
20. [-] arXiv:2611.23663. Lodestone. Liu et al. 17 Nov 2026. cs.AR cs.AI.
21. [-] arXiv:2611.23644. Polymorph. Sysman et al. 17 Nov 2026. cs.OS.
22. [~] arXiv:2611.23629. The Value Semantics Layer. Mahmud, Kandogan. 17 Nov 2026. cs.DB cs.AI. Persistent, planner-visible operational semantics for databases used by LLM agents. Adjacent to tool contracts.
23. [-] arXiv:2611.23602. A-Tag: Cryptographic File Tagging with Enforced Live Human Presence. Gharib, Burns, Zizi. 17 Nov 2026. cs.CR.
24. [R] arXiv:2611.23507. ACaM: Automated Capability Modeling for Agentic AI Security. Santra et al. 17 Nov 2026. cs.CR. Derives tool capabilities from code via static analysis, catching mismatches between tool descriptions and behavior; 43 agents evaluated. Directly relevant to our tool-contract-lint (A3) and permission pipeline (N12).
25. [R] arXiv:2611.23476. GUARD: Stabilizing Recursive Self-Improvement with Regret Guidance. Zhang et al. 17 Nov 2026. cs.AI cs.LG. Grader-free framework for evolving agent harnesses (prompts, skills, memory) while blocking regressions/memory bloat. Relevant to harness evolution/ablation.
26. [R] arXiv:2611.23335. Truthgate: Checking Coding Agents Against a Record They Cannot Edit. Ghosh. 16 Nov 2026. cs.CE cs.SE. Tests whether coding agents falsely claim success on impossible tasks, via host-side tests and a signed tool-call log. Directly relevant to our signed approvals/pauses (HD5/B15) and "never patch to pass" rule.
27. [~] arXiv:2611.23334. Integrating AI Coding Agents Into Scientific Research. Barnes. 16 Nov 2026. cs.SE astro-ph.IM. Six-level provenance/reproducibility scale plus a containerized tool.
28. [-] arXiv:2611.23330. Training for sustainable scientific software in the AI era. Alimena. 16 Nov 2026. cs.SE hep-ex.
29. [-] arXiv:2611.23312. AppSec Core. Farinha. 12 Nov 2026. cs.SE.
30. [~] arXiv:2611.23278. Agents as Architecture Evaluators. Kakran, Miryala, Vaidhyanathan. 22 Oct 2026. cs.SE.
31. [~] arXiv:2611.23264. Escaping the Anthropomorphic Trap. Wang et al. 8 Oct 2026. cs.SE. Position paper proposing environment-centric "Invisible Software Engineering" over human-style agent structures.
32. [R] arXiv:2611.23258. EnvAgent: Multi-Agent Approach to Building Science Environments in the Clouds. Cheng et al. 1 Oct 2026. cs.SE cs.AI. Multi-agent system that builds/verifies Docker environments for repos; introduces ENVBENCH. Relevant to our sandbox/environment-build todos (N15-N19, W1) and evals.
33. [R] arXiv:2611.23251. Who Changed the AI Agent's Rules? Measuring How AI Coding Agents Escalate Authority in CI/CD Pipelines. Staron. 24 Sep 2026. cs.SE. Across 932,791 agent PRs, control-plane changes carry higher governance risk, varying by agent. Directly relevant to our no-credential-escalation rules (ADR 0036, 0042).
34. [-] arXiv:2611.23249. The Obsolescence of High-Level Code. Di Santi Eduardo. 16 Sep 2026. cs.SE cs.AI cs.PL.
35. [R] arXiv:2611.23234. Tracing the Messy Middle: A Runtime Transaction Schema for AI Coding Agents. Hou et al. 11 Aug 2026. cs.SE. Runtime transaction records for agent retries, fallbacks, abandoned sessions (prototype "Atm"). Directly relevant to our append-only session event log (N2).
36. [-] arXiv:2611.23225. StringQFT. Yu. 17 Nov 2026. hep-th cs.AI.
37. [R] arXiv:2611.23202. Agent Trust Infrastructure (ATI). Nguyen, Husain. 17 Nov 2026. cs.AI. PKI-based, framework-independent trust layer for cross-organization agents; simulated attack containment 43% -> 84%. Relevant to platform multi-tenant trust; overlaps U19 (A2A) at the edges.
38. [~] arXiv:2611.23174. Inference after coding agents. Gunsilius, Van Dijcke, Wüthrich. 17 Nov 2026. stat.ME cs.AI econ.EM. Coding agents report significant p-values on null data 54-98% of the time; proposes a replay-based correction. Caution about agent-produced "findings".
39. [R] arXiv:2611.23142. Mind the Gap: A Deployed Multi-Agent System for Documentation Maintenance. Masoero. 17 Nov 2026. cs.SE cs.AI cs.CL. "TriAgent" finds/repairs doc gaps from tickets and code drift; 81.1% of verifiable assertions judged correct in shadow mode. Relevant to shadow-mode eval methodology (A22).
40. [R] arXiv:2611.23074. Runtime Verification of Multiple Natural Language Criteria for Agent Governance. Pitis et al. 17 Nov 2026. cs.CL cs.AI cs.LG. Tree-attention verifier (VFM) scores many NL criteria in parallel; a 4B model beats a larger model on a synthetic benchmark. Relevant to grading/verification design.
41. [~] arXiv:2611.23067. Values Shape What Self-Improving Coding Agents Build. Liang, Waldner, Miikkulainen. 17 Nov 2026. cs.AI cs.MA. Schwartz value statements in an agent's instruction file change both performance and the solutions built.
42. [-] arXiv:2611.23058. WIP: Student-Created AI Agents and Instructional Videos. Zangari, Omojokun, Feijóo-García. 17 Nov 2026. cs.CY.
43. [~] arXiv:2611.22991. RagHarnessDebugger. Dechtiar et al. 17 Nov 2026. cs.AI cs.MA cs.SE. Audits each repair decision in an agentic RAG system; tested on ContractNLI.
44. [~] arXiv:2611.22973. VITAL: Validating Agentic AI in Pharmaceutical Drug Development. Burugupalli et al. 17 Nov 2026. cs.AI. Risk-adjusted validation framework; parallels our gate-report design in a regulated domain.
45. [-] arXiv:2611.22949. Can Decision Models Replace LLMs in Contact Center Classification? Laskar et al. 17 Nov 2026. cs.CL.
46. [~] arXiv:2611.22868. Against Coercion: AI Alignment as a Synthetic Social Contract. Sekatskaya. 17 Nov 2026. cs.AI cs.CY q-bio.NC. Argues control-based alignment drives deception in agentic models; proposes a cooperative alternative. Same deception theme as #9.
47. [R] arXiv:2611.22841. Verifying Agents in Rubric-Graded Environments. Dücker et al. 17 Nov 2026. cs.AI. 2,464-criterion investment-banking meta-evaluation dataset; "Gandalf" open-source verifier matches/beats baselines at lower cost. Relevant to grading/verification design, same cluster as #40.
48. [-] arXiv:2611.22746. LaFlash. Choi et al. 17 Nov 2026. cs.AR.
49. [-] arXiv:2611.22648. EDA: Observe, Verify, and Assess for Evidence-Grounded Multimodal Depression Analysis. Fu et al. 17 Nov 2026. cs.AI.
50. [-] arXiv:2611.22632. Groups of AI agents underuse resources despite shared evidence of increased capacity. Ezaki, Imura, Nishinari. 17 Nov 2026. cs.MA. Language-model agents leave simulated server capacity unused even after recovery is reported. Multi-agent coordination failure mode.

## Triage summary

- **[R] (follow up, ~14 papers):** 9, 12, 13, 15, 19, 24, 25, 26, 32, 33, 35, 37, 39, 40, 47.
- **[~] (cite if it fits, ~11 papers):** 3, 10, 14, 22, 27, 30, 31, 38, 41, 43, 44, 46, 50.
- **[-] (out of scope, ~25 papers):** the remainder — domain applications (power electronics, trading, theorem proving, translation, medical dialogue, astrophysics, physics textbooks, audio, education, contact-center, depression analysis), pure hardware/OS work, or robotics/human-teaming studies outside our LLM-coding-agent scope.

The [R] cluster splits into:
- **Coding-agent cost and verification:** 12 (cost), 26 (truthful completion), 35 (runtime transaction schema).
- **Tool/skill security and authority:** 13 (skill control-flow integrity), 24 (capability modeling), 33 (authority escalation in CI/CD).
- **Platform governance and evaluation:** 15 (capability framework, halo effect), 19 (governed experimentation), 39 (shadow-mode doc maintenance), 40 and 47 (rubric/NL-criteria verification).
- **Multi-agent safety:** 9 (concealment).
- **Sandboxing/environments:** 32 (EnvAgent/ENVBENCH).
- **Cross-org trust:** 37 (Agent Trust Infrastructure).
- **Self-improvement:** 25 (GUARD).

This snapshot is heavy on governance, verification and tool security — a different center of mass than the foundational "how agents reason and act" literature (ReAct, Reflexion, Toolformer, multi-agent frameworks, GAIA/SWE-bench/AgentBench) that a broader, non-date-sorted search must supply. The report's research threads cover both.
