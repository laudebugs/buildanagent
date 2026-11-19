# Raw research notes: foundational LLM agent architectures section

Working material behind `section-architectures-draft.md` and its fact-check. The draft and fact-check supersede these notes where they disagree.

## ReAct — Yao et al., arXiv:2210.03629
- Title: ReAct: Synergizing Reasoning and Acting in Language Models.
- Authors: Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao.
- v1 6 Oct 2022, v2 27 Nov 2022, v3 10 Mar 2023 (ICLR camera-ready, current).
- Core idea: interleave reasoning traces and task-specific actions in one generation stream, instead of studying chain-of-thought reasoning and action-plan generation separately.
- ALFWorld: +34 absolute success rate over imitation learning. WebShop: +10 absolute success rate over RL. HotpotQA/FEVER: reduces hallucination vs. chain-of-thought by querying a Wikipedia API.
- Used 1-2 in-context examples (few-shot prompting, no fine-tuning for the main results).

## Reflexion — Shinn et al., arXiv:2303.11366
- Title: Reflexion: Language Agents with Verbal Reinforcement Learning.
- Authors: Noah Shinn, Federico Cassano, Edward Berman, Ashwin Gopinath, Karthik Narasimhan, Shunyu Yao (overlap with ReAct's Yao and Narasimhan).
- v1 20 Mar 2023 ... v4 10 Oct 2023 (current; "a few additional experiments").
- Core idea: verbal self-reflection, not weight updates. Agent reflects on scalar or free-form feedback, stores reflection text in an episodic memory buffer, uses it on the next trial.
- Headline number: 91% pass@1 on HumanEval vs 80% for GPT-4 baseline.
- Ablations on feedback type, feedback incorporation method, agent type.
- Relation to ReAct: builds a second (outer, cross-trial) loop around a ReAct-shaped inner loop; the inner loop still interleaves reasoning and acting.

## Toolformer — Schick et al., arXiv:2302.04761
- Title: Toolformer: Language Models Can Teach Themselves to Use Tools.
- Authors: Timo Schick, Jane Dwivedi-Yu, Roberto Dessì, Roberta Raileanu, Maria Lomeli, Luke Zettlemoyer, Nicola Cancedda, Thomas Scialom.
- Single version, 9 Feb 2023.
- Core idea: self-supervised fine-tuning teaches the model itself which APIs to call, when, with what args, and how to fold results into future token prediction. Needs only a handful of demonstrations per API.
- APIs: calculator, Q&A system, two search engines, translation system, calendar.
- Result described qualitatively in the abstract as "substantially improved zero-shot performance," competitive with much larger models; no exact numbers quoted (would need full PDF for benchmark table).
- Key distinction from ReAct/modern tool-calling: tool-use habit is baked into the model's weights via fine-tuning, not implemented as a harness-level structured function-call interface that any model can be prompted/tuned to use. Industry practice (OpenAI function calling, Anthropic tool use, etc.) went the harness-boundary route instead — this is the drafting agent's own synthesis, not sourced to a single paper (flagged as such in the fact-check, row 8).

## Voyager — Wang et al., arXiv:2305.16291
- Title: Voyager: An Open-Ended Embodied Agent with Large Language Models.
- Authors: Guanzhi Wang, Yuqi Xie, Yunfan Jiang, Ajay Mandlekar, Chaowei Xiao, Yuke Zhu, Linxi Fan, Anima Anandkumar.
- v1 25 May 2023, v2 19 Oct 2023 (current).
- Three components: automatic curriculum (maximizes exploration), growing skill library (executable code, stored/retrieved), iterative prompting (environment feedback + execution errors + self-verification).
- Driven by black-box GPT-4 API calls — no fine-tuning.
- Results vs prior SOTA: 3.3x more unique items, 2.3x longer travel distance, up to 15.3x faster tech-tree milestones. Skill library transfers to a new Minecraft world where other techniques fail to generalize.
- Code/prompts open-sourced at voyager.minedojo.org.
- AutoGPT/BabyAGI lineage: popularized a similar "agent writes its own sub-goals and loops" shape around the same time (2023), but these are open-source projects without a benchmarked paper comparable to Voyager's — not independently checked against their repos in this pass (flagged ⚠️ unverified in fact-check row 11).

## 2025-2026 survey/position paper search
- Searched arXiv/web for "LLM agent architecture survey" / "agentic AI architecture" 2025-2026.
- Candidates found:
  - arXiv:2601.01743 "AI Agent Systems: Architectures, Applications, and Evaluation" (Bin Xu).
  - arXiv:2508.17281 "From Language to Action: A Review of Large Language Models as Autonomous Agents and Tool Users" (Chowa, Alvi, Rahman, Rahman, Raiaan, Islam, Hussain, Azam). v1 24 Aug 2025, v2 28 Oct 2025 (current). Reviews only 2023-2025 papers from A*/A-rank conferences and Q1 journals; analyzes 68 datasets; organized around 7 research questions covering single/multi-agent architecture, tool integration, reasoning/planning/memory, prompting vs fine-tuning, benchmarks, and 10 future directions. Chosen as the section's survey citation.
  - arXiv:2505.19683 "Large Language Models for Planning: A Comprehensive and Systematic Survey" — planning-focused, not chosen (narrower than full architecture).
  - arXiv:2402.02716 "Understanding the planning of LLM agents: A survey" (2024, slightly outside the 2025-2026 window) — not chosen as primary survey, but same lineage.
  - arXiv:2309.07864 "The Rise and Potential of Large Language Model Based Agents: A Survey" and arXiv:2308.11432 "A Survey on Large Language Model based Autonomous Agents" — both 2023, well outside the 2025-2026 window, not chosen despite likely higher citation counts.
- Citation-count check: attempted Semantic Scholar Graph API (api.semanticscholar.org/graph/v1/paper/arXiv:...) for several of the above; got HTTP 429 (rate limited) on every attempt, including after an 8-second wait. Attempted Google Scholar direct URL; got 404. Could not confirm a citation count for any candidate survey in this pass. The draft therefore does not claim a specific citation count for the chosen survey, and instead cites its review-scope restriction (A*/A-rank/Q1, 2023-2025) as the available proxy for rigor.

## Plan-then-execute vs. ReAct-style
- arXiv:2509.08646 "Architecting Resilient LLM Agents: A Guide to Secure Plan-then-Execute Implementations" (Del Rosario, Krawiecka, Schroeder de Witt), submitted 10 Sep 2025, cs.CR.
- Practical guide, not an empirical study: argues Plan-then-Execute (separate Planner + Executor) gives predictability, cost-efficiency and reasoning quality over reactive patterns like ReAct, and that fixing control flow upfront gives inherent resilience to indirect prompt injection (control-flow integrity).
- Gives implementation blueprints for LangChain/LangGraph, CrewAI, AutoGen; discusses dynamic re-planning, parallel DAG execution, human-in-the-loop verification.
- Caveat: abstract-level claims about predictability/cost/quality are not backed by cited benchmark numbers in what we could read from the abstract page; would need the full PDF to see if the body gives numbers. Did not fetch the full PDF in this pass — the draft's use of this source only claims what the abstract itself asserts, which was fetched and read directly.

## Connection to our AGENTS.md planned architecture
- Point 2 (stateless harness loop, explicit stop conditions, hooks: before/after model step, before/after tool call, context transform, steering queue) is architecturally closest to ReAct: reasoning and acting interleave in one loop, not a separate planner/executor split.
- Point 4 (small set of tools + MCP client) matches the harness-boundary tool-use model that the industry converged on instead of Toolformer's fine-tuned-in tool habit.
- Point 5 (layered context policy: between-turn, mid-turn, overflow-retry compaction) is the generalized version of Reflexion's "carry forward a reflection, not the whole failed transcript" trick.
- Point 6 (file-based memory first) and `.agents/skills/` match Voyager's "skills as persistent, inspectable, composable files" choice over re-deriving behavior from scratch each run.
- Plan-then-execute (Del Rosario et al.) is not a rival architecture to adopt wholesale; its benefits (re-planning, scoped tool access, injection resistance) are describable as policies the before/after-tool-call hooks can impose on top of the ReAct-shaped loop, per the draft's closing paragraph. This is the drafting agent's own synthesis across the papers and AGENTS.md, flagged as a design judgment (not an external claim) in fact-check rows 8 and 18.
