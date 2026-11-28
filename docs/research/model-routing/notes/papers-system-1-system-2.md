# Research notes: System 1 / System 2 for language models and agents

Compiled 2026-11-28. Raw notes, not prose for the book.

Practical questions: (1) when should an agent use a fast model versus a slow reasoning model, and (2) how do the two integrate in one agent?

## How these notes were made (read this first)

- For every paper marked "FULL TEXT" below, I downloaded the arXiv PDF, converted it with `pdftotext`, and read the sections cited. Where I say "sections read", that is the extent of my reading. I did NOT read every page of every paper. The long surveys and the Qwen3 report were read selectively (stated per entry).
- Table cells were extracted from PDF text. Where a table came out scrambled (column order lost), I say so and I quote only numbers that appear in the running prose or abstract. Numbers marked "(table, parsed from PDF text)" should be re-checked against the PDF before they go in the book.
- "Abstract only" or "search snippet only" is marked explicitly. Anything marked "NOT VERIFIED" must not be cited as fact.
- Number of runs / seeds: most papers do not state it. I record "not stated" rather than guess.
- Local copies of the PDFs (and extracted text) are in the session scratchpad, not in the repo.

Papers covered (14 full-text-read, one of them partial; plus 1 search-snippet-only item):

1. Talker-Reasoner (Christakopoulou et al., 2024)
2. SwiftSage (Lin et al., NeurIPS 2023)
3. Distilling System 2 into System 1 (Yu et al., 2024)
4. System 2 Attention (Weston and Sukhbaatar, 2023)
5. Dualformer (Su et al., ICLR 2025)
6. From System 1 to System 2: A Survey of Reasoning LLMs (Li et al., 2025) - selective read
7. Scaling LLM Test-Time Compute Optimally (Snell et al., 2024)
8. Do NOT Think That Much for 2+3=? (Chen et al., 2024/2025)
9. Stop Overthinking: A Survey on Efficient Reasoning (Sui et al., 2025) - selective read
10. AdaptThink (Zhang et al., 2025)
11. Thinkless (Fang et al., 2025)
12. s1: Simple test-time scaling (Muennighoff et al., 2025)
13. Qwen3 Technical Report (Qwen Team, 2025) - hybrid thinking, selective read
14. The Danger of Overthinking (Cuadron et al., 2025) - agentic
15. Think Twice, Click Once / FOCUS (Tang et al., 2025) - GUI grounding
16. Cognitive Duality for Adaptive Web Agents / CogniWeb (Liu et al., 2025)
17. Visual Agents as Fast and Slow Thinkers / FaST (Sun et al., ICLR 2025) - partial read
18. Reasoning on a Spectrum (Ziabari et al., 2025)
19. Don't Overthink, Don't Underthink (Mia and Amini, 2026) - small preliminary study
20. A Dual-Process Perspective on Nudge Susceptibility in LLM-Based GUI Agents (Halimeh et al., 2026) - used only for its explicit metaphor caveat

(Entries 14 onward are extras beyond the 10-14 asked for; the first 13 are the core set.)

---

## 1. Talker-Reasoner

- Citation: Konstantina Christakopoulou, Shibl Mourad, Maja Matarić (Google DeepMind). "Agents Thinking Fast and Slow: A Talker-Reasoner Architecture." arXiv:2410.08328v1, 10 Oct 2024. https://arxiv.org/abs/2410.08328 . Venue: arXiv preprint (no venue printed on the PDF). FULL TEXT read (whole paper, 8 pages plus references).
- Definition of S1/S2: Taken from Kahneman, quoted in Section 1. In the paper's own mapping (Section 3.2): Talker = System 1 = "fast agent that interacts with the user via language"; Reasoner = System 2 = "slow and deliberative agent responsible for complex problem solving", including multi-step planning, tool calls, and forming a structured "belief state" about the user. So the split is by role (conversation vs. planning/belief-forming), not by token count.
- Method (Section 3.2, Figure 3): Two LLM agents that communicate only through memory. The Reasoner writes a belief state and plan to memory; the Talker reads the latest belief from memory on each turn. The Talker may use a stale belief to keep latency low. A flag lets the Talker wait for the Reasoner: "in the planning coaching phase the Talker waits, otherwise it does not" (Section 4.2, "Talker-Reasoner Coordination"). The wait decision is a hard-coded function of the belief's coaching phase.
- Models/tasks/sizes (Section 4.2): Talker = Gemini 1.5 Flash; Reasoner = hierarchical, three "mini-Reasoners" (one per coaching phase: understanding, goal-setting, coaching-plan), each a CoT-prompted Gemini 1.5 Flash combination. Single use case: a sleep-coaching agent. Number of users/runs: none. There is no quantitative evaluation.
- Headline results: None quantitative. Section 4.3 gives qualitative example conversations; Section 4.4 describes two failure/success modes: "Intuitive Talker" (fine in the understanding phase even with an older belief) and "Snap judgement Talker" (when the user asks for a multi-step plan or resources that need tool calls, the Talker answers without the Reasoner and is wrong). Fix: the Talker is instructed to wait when the phase is "planning".
- Baselines: none. Related work (Section 2) contrasts with ReAct, Reflexion, AutoGPT.
- Stated limitations / future work (Section 5): Open problem is "deciding when not to probe the Reasoner and how to utilize it in a lower capacity most of the time"; "Ideally, given a user query, the Talker should automatically determine whether it requires System 2 reasoning". I.e. the authors say the routing decision is not solved. Also Section 1: the Talker "operates with a more outdated view of the world... and can sometimes answer easier questions than the ones asked."
- Agent-builder implication: Slow planner running asynchronously behind a fast conversational front, sharing state through memory; block the fast path (make it wait) only for turns whose state says planning or tool use is needed. Handoff = a written belief/plan object, not a message. Evidence is anecdotal only, so treat as an architecture pattern, not a measured result.

## 2. SwiftSage

- Citation: Bill Yuchen Lin, Yicheng Fu, Karina Yang, Faeze Brahman, Shiyu Huang, Chandra Bhagavatula, Prithviraj Ammanabrolu, Yejin Choi, Xiang Ren. "SwiftSage: A Generative Agent with Fast and Slow Thinking for Complex Interactive Tasks." NeurIPS 2023 (printed on PDF, line "37th Conference on Neural Information Processing Systems"). arXiv:2305.17390v2, 6 Dec 2023. https://arxiv.org/abs/2305.17390 . FULL TEXT read: Sections 1-5, the switching section, the results section and appendices B-C, Table 4.
- Definition: Dual-process theory (Kahneman, Section 2). System 1 = small seq2seq model imitating oracle trajectories ("SWIFT"); System 2 = prompting a large LLM (GPT-4) for planning and grounding ("SAGE"). The split is by model type and by training method.
- Method (Section 3.4, with the quoted conditions): Start in SWIFT. Switch to SAGE when any of four conditions holds: "1) Stuck: There are K=5 consecutive time steps with zero reward; 2) Invalid: The SWIFT's prediction for the next action is invalid in the current environment; 3) Critical: A't involves a critical decision, e.g., giving the final answer; 4) Unexpected: The observation of A't suggests that an exception is encountered." SAGE does a two-stage prompt (plan subgoals, then ground them to an action buffer, about 5 actions); execution continues from the buffer, and control reverts to SWIFT "when the buffer is empty" (also after two consecutive invalid actions, Appendix B.3).
- Models/tasks: SWIFT = flan-t5-large (770m) fine-tuned on 62k seq2seq action-prediction examples (Appendix B.1); SAGE = GPT-4 (also GPT-3.5-turbo in Appendix C.1). Benchmark: ScienceWorld, 30 task types (Table 1, Table 2). Number of runs/seeds: not stated in the sections I read.
- Headline results (Table 1, overall score; the table columns were scrambled in extraction but prose confirms these): SwiftSage 84.68; Reflexion 45.34; ReAct 36.43; SayCan 33.82; SWIFT-only (770m) 49.22 (Section 4.2 text). Table 1 caption notes the last four methods use GPT-4. Reflexion can run four rounds, others one (Section 4.2 text).
- Cost (Section 4.2 "Cost-effectiveness", Table 4): tokens per action: SayCan 1,855.84, ReAct 1,971.03, Reflexion 2,983.46, SwiftSage 757.07. Efficiency comes from "invoking LLMs only when needed" and the action buffer.
- GPT-3.5 sensitivity (Appendix C.1): ReAct falls from 36.43 to 19.76; SwiftSage keeps 62.22.
- Stated limitations (Section 5): only one textual simulator (ScienceWorld); no safety safeguards; "use of LLMs in SAGE may present scalability challenges"; and future work should "learn a trainable module to decide when to switch between SWIFT and SAGE mode", i.e. the switch is a hand-written heuristic.
- Agent-builder implication: Fast-first with a small specialised policy as default; escalate to the big model on four cheap, observable signals (no progress for K steps, invalid action, irreversible/critical action, exception text). Slow model returns a multi-step buffer so one expensive call buys several cheap steps. The strong gains are on one simulator with a heuristic switch, so the switch signals are a design hint, not a proven recipe.

## 3. Distilling System 2 into System 1

- Citation: Ping Yu, Jing Xu, Jason Weston, Ilia Kulikov (Meta FAIR). "Distilling System 2 into System 1." arXiv:2407.06023v3, 24 Jul 2024. https://arxiv.org/abs/2407.06023 . Venue on PDF: none printed (treat as preprint). FULL TEXT read: abstract, Sections 1-5, Tables 1-4, conclusion.
- Definition (Section 1, quoted): "we define System 1 as application of the Transformer... to directly produce a response given an input, without generation of intermediate tokens. We define System 2 as any approach which generates intermediate tokens, including methods that perform search or prompt multiple times." Purely operational.
- Method (Figure 1, Section 3): run a System 2 method on unlabeled inputs, filter the outputs without labels using self-consistency (majority over samples, or consistency under input perturbation such as swapping response order), then fine-tune the same model to output only the final answer.
- Models/data: Llama-2-70B-chat throughout. Tasks: Rephrase and Respond (last-letter concatenation, coin flip); System 2 Attention (SycophancyEval TriviaQA, 6668 unlabeled training examples, 400 eval: 350 biased, 50 unbiased); Branch-Solve-Merge as LLM-judge (OASST2: 19,672 training pairs, 273 validation; MT-bench); and CoT on GSM8k (7461 questions). Seeds: S2A table says "average accuracy over 3 random seeds" (Section 4.3); others not stated.
- Headline numbers:
  - Last letter concatenation (Table 1): System 1 30.0%; 1-step RaR 39.5%; 2-step RaR 44.5%; distilled 2-step RaR 98.0% with 25.5 tokens vs 106.6/41.5 tokens for the RaR variants (token columns partly scrambled).
  - Coin flip (Table 1): System 1 56.1%; 1-step 58.5%; 2-step 77.2%; distilled 75.69%.
  - S2A / TriviaQA (Table 2; column order inferred from the extraction): biased-set accuracy System 1 51.6%, S2A 76.0%, distilled S2A 81.3%, distilled without USC filtering 78.6%; unbiased 73.8 / 69.3 / 78.6 / 75.3; tokens 165 / 147 / 56 / 58.
  - BSM judge (Table 3): OASST2 agreement: GPT-4-0125 (direct) 44.7%, Llama-2-70B-chat 32.0%, BSM 49.1%, distilled BSM 58.4%; position-inconsistency 12.2% for distilled vs 56.7% for Llama direct (rows partly scrambled; the inconsistency column order should be checked); distilled model outputs "only four tokens" vs 2117.8 for BSM. MT-bench agreement: distilled 72.4% vs GPT-4-0125 direct 68.1% (inconsistency 9.1%). Paper says it still lags GPT-4 on reasoning, coding and extraction categories (Figure 2).
  - GSM8k CoT (Table 4): FAILURE CASE. System 1 few-shot 7.58%; CoT zero-shot 52.77% (k=1); distilled CoT 7.13%. Caption: "System 2 Distillation of CoT does not work well."
- Baselines: the un-distilled System 1 and System 2 versions of each method; GPT-4-0125 for the judge task; ablation without the consistency filter (Section 4, "Analysis and Ablations").
- Stated limitations: Conclusion: "not all methods can be distilled easily... with Chain-of-Thought for complex reasoning being a challenging counterexample". A "Limitations" heading exists but the extracted text for it was cut off in my extraction; I did not read its contents. Prompt-engineering sensitivity noted for RaR (Section 4.2, ablation).
- Agent-builder implication: Distillation helps for stable, repeatable "processing" tasks (de-biasing context, clarifying a query, judging, rubric-style tasks): spend slow compute once offline, then run the cheap model. Do not expect it for multi-step arithmetic or similar tasks where the tokens are the computation; keep slow reasoning online there. Handoff is offline: slow-model outputs filtered by agreement become fast-model training data.

## 4. System 2 Attention (S2A)

- Citation: Jason Weston, Sainbayar Sukhbaatar (Meta). "System 2 Attention (is something you might need too)." arXiv:2311.11829v1, 20 Nov 2023. https://arxiv.org/abs/2311.11829 . Preprint. FULL TEXT read: abstract, Sections 1-3 (experiments), limitations and discussion.
- Definition: Transformer soft attention is treated as "automatic operations analogous to system 1 reasoning"; System 2 is "allocating effortful mental activity" when System 1 is likely to err (Section 1). So here System 2 = the model rewrites its own context, then answers.
- Method: Two LLM calls with the same model, zero-shot prompted: regenerate the context keeping only relevant, unopinionated parts; then answer from the regenerated context (Figure 2).
- Models/tasks: LLaMA-2-70B-chat. SycophancyEval modified TriviaQA (200 prompts, GPT-4 as grader, Section 3.1), GSM-IC math with distractor sentences (Figure 7), and longform argument generation (Figure 6, objectivity scored by GPT-4). Runs: not stated.
- Headline numbers (Section 1 and Section 3): factuality 62.8% to 80.3% (oracle unopinionated prompt: 82.0%); objectivity +57.4% on longform; GSM-IC with in-topic distractors 51.7% to 61.3%; "the accuracy jumps up about 12% for random distractors, and 10% for in-topic distractors". Simply instructing the model to ignore irrelevant text "did not bring consistent improvement" (Section 3.2).
- Baselines: baseline prompt, oracle prompt (without the distractor), instructed prompting, and an ablation that keeps opinions in the regenerated text (Figure 8).
- Stated limitations ("Limitations & Discussion"): "does not always succeed"; "requires more computation than standard LLM regeneration"; zero-shot prompt not optimised; copying long contexts may be error-prone for weaker models.
- Agent-builder implication: The "slow" step does not have to be long reasoning; a cheap sanitising pass (strip irrelevant or leading content from the context before the main call) is a form of System 2 that targets bias and distractors. Relevant to agent context hygiene. Little here on routing; this paper is the origin of the use of the System 2 label for a prompt-level technique.

## 5. Dualformer

- Citation: DiJia Su, Sainbayar Sukhbaatar, Michael Rabbat, Yuandong Tian, Qinqing Zheng (Meta AI). "Dualformer: Controllable Fast and Slow Thinking by Learning with Randomized Reasoning Traces." ICLR 2025 (printed on PDF). arXiv:2410.09918v3, 11 Jul 2025. https://arxiv.org/abs/2410.09918 . FULL TEXT read: abstract, Sections 1-5, Tables 4.1-4.3, 4.8.
- Definition: "fast mode" = output only the solution; "slow mode" = output reasoning chain (A* search trace) and then solution (abstract, Section 1). Operational, same as paper 3.
- Method (Section 3, Figure 3.1): Train one Transformer on search-trace data where, per training example, parts of the trace are randomly dropped by four progressively more aggressive "levels" (drop close-set, also cost tokens, then some or all of the search steps), with a probability p0 of keeping the full trace. At inference a control token after BOS selects fast or slow mode; with a standard prompt the model picks ("auto mode").
- Models/tasks: From-scratch Transformers on Maze (15x15 to 30x30) and Sokoban (7x7), 100k training examples (Section 4.1; the paper writes "10^5"), following Searchformer. LLM fine-tuning: Llama-3-8B and Mistral-7B on Aug-MATH (MATH rewritten by Llama-3.1-70B-Instruct; 7500 train / 5000 test), with p in {0.1,0.2,0.3,0.4} (Section 4.2). Metrics: 1-Solved-64, 1-Optimal-64, etc. (64 samples per task). Seeds/runs: not stated in sections I read.
- Headline numbers (abstract): slow mode 97.6% optimal rate on unseen 30x30 mazes vs Searchformer 93.3%, with 45.5% fewer reasoning steps; fast mode 80% vs Solution-Only 30%; auto mode 96.6% optimal with 59.9% fewer steps than Searchformer. Section 4.1.3, Figure 4.1: in auto mode, the share of slow-mode paths rises as wall density and maze size rise. Math (Section 4.2, Table 4.8): for Mistral-7B, slow-mode greedy accuracy +1.7% absolute at p=0.1 (stated as about 10% relative); Pass@20 up to 61.9%; fast-mode also higher than baseline.
- Baselines: Solution-Only model (fast), Complete-Trace model and Searchformer (slow), base Aug-MATH fine-tune.
- Stated limitations: Conclusion lists future work only: whether the approach "helps models scale", curriculum learning, hierarchical planning for harder tasks. The auto-mode difficulty tracking is correlational; the authors name two possible causes (harder problems need more thinking, or the model prefers slow mode more often) and do not separate them (Section 4.1.3).
- Agent-builder implication: Training one model to do both modes means a single checkpoint can serve "fast" and "slow" calls and can learn when to trace on its own. But the tested domains are planning puzzles, and the LLM-scale evidence is a modest gain. For a builder using hosted models this maps to "one model with a thinking switch" (see Qwen3, AdaptThink).

## 6. From System 1 to System 2: A Survey of Reasoning LLMs

- Citation: Zhong-Zhi Li, Duzhen Zhang, Ming-Liang Zhang et al.; corresponding authors Zhijiang Guo, Le Song, Cheng-Lin Liu. arXiv:2502.17419v6, 25 Jun 2025 (PDF is in an IEEE journal LaTeX template; no accepted venue stated; I do not claim one). https://arxiv.org/abs/2502.17419 . PARTIAL READ: abstract, Section 1 (intro), Section 2 (early System 2), Section 6.2, plus keyword searches on System 1/2, overthinking. Not read: benchmark tables, most of Sections 3-5.
- Definition (Section 1, quoted): "System 1, which is fast, automatic, and intuitive... System 2, which is slower, more analytical, and deliberate." Foundation LLMs are placed in System 1; reasoning LLMs (o1/o3, DeepSeek-R1) are placed as "closely mimicking the deliberate reasoning of System 2" (abstract).
- Method: Survey. Organises reasoning LLM work by features, core methods (including RL, search, process rewards), and benchmarks.
- Models/tasks/results: Survey; no new experiments in the parts I read.
- Stated limitations/open problems, Section 6.2 "Collaborative Slow & Fast-thinking Systems" (quoted): "A key challenge in reasoning LLMs is the loss of fast-thinking capabilities, which results in inefficiencies when simple tasks require unnecessary deep reasoning." Says current reasoning LLMs "struggle to maintain this balance" and calls for "adaptive switching mechanisms, joint training frameworks, and co-evolution strategies." Mentions a "System 1-2 switcher" (their ref [116]) and speculative decoding.
- Agent-builder implication: Useful as a citation for the framing "reasoning model = slow; base chat model = fast" and for the stated gap that switching is unsolved. It is a framing paper, so use primary results (below) for numbers.

## 7. Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters

- Citation: Charlie Snell, Jaehoon Lee, Kelvin Xu, Aviral Kumar (UC Berkeley, Google DeepMind). arXiv:2408.03314v1, 6 Aug 2024. https://arxiv.org/abs/2408.03314 . Later published at ICLR 2025 (from memory; NOT VERIFIED in the PDF text I read, which is v1). FULL TEXT read: abstract, Sections 1-4, 6-8 (Section 5 revisions and Section 6 combined analysis skimmed).
- Definition: Not a dual-process paper. It argues "Humans tend to think for longer on difficult problems" (Section 1) and builds a prompt-difficulty-conditioned policy for allocating test-time compute. Useful as the quantitative basis for "slow only when the problem needs it".
- Method: Two mechanisms: search against a process reward model (best-of-N, beam search, lookahead) and sequential revisions by a model fine-tuned to revise. "Compute-optimal" strategy (Section 3.1-3.2): pick the best strategy per difficulty bin, where difficulty = five quantile bins of the base model's pass@1 (2048 samples per problem), either from ground truth ("oracle difficulty") or model-predicted; two-fold cross-validation.
- Models/tasks: PaLM 2-S* (Codey) on MATH (Section 3.3); PRM trained on Math-Shepherd-style labels (the paper discusses why it avoided the PRM800K data, line "easy to exploit"). Runs: not stated beyond sampling counts.
- Headline numbers: abstract: compute-optimal gives "more than 4x" efficiency vs best-of-N; Conclusion (Section 8): "a factor of 2-4x". FLOPs-matched: on problems where a smaller base model has "somewhat non-trivial success rates, test-time compute can be used to outperform a 14x larger model" (abstract; Figure 9, Section 7). Also: on easy questions beam search with more budget gets WORSE (Section 4: "On the easy questions (levels 1 and 2)... beam search, degrades performance as the generation budget increases"), better on levels 3-4, and "On the most difficult questions (level 5), no method makes much meaningful progress." Figure 9 caption: when inference tokens are large relative to pretraining tokens, pretraining is preferable on harder questions; test-time compute preferable on easy questions and when Y << X.
- Baselines: best-of-N weighted, majority voting, beam search, lookahead, parallel vs sequential revisions.
- Stated limitations (Section 8 and 3.2): difficulty estimation "requires applying a non-trivial amount of test-time compute itself" and their experiments do not charge for it; "across the board these schemes provided small gains on hard problems"; only MATH and one model family.
- Agent-builder implication: Difficulty relative to THIS model (its own pass rate) is the signal that predicts whether extra compute pays; extra search can hurt on easy items by over-optimising a verifier; the cost of estimating difficulty must be counted. Hard, verifiable problems are where bigger model beats more samples.

## 8. Do NOT Think That Much for 2+3=? On the Overthinking of o1-Like LLMs

- Citation: Xingyu Chen, Jiahao Xu, Tian Liang, Zhiwei He, et al., Zhaopeng Tu, Rui Wang (Tencent AI Lab, SJTU). arXiv:2412.21187v2, 1 Feb 2025. https://arxiv.org/abs/2412.21187 . Venue: arXiv in the version read (later venue NOT VERIFIED). FULL TEXT read: abstract, Sections 1-4 and the method/results sections, Table 4; no dedicated limitations section found by search.
- Definition: Not dual-process. "Overthinking": "excessive compute... on questions that are exceptionally simple or for which the answer is already evident". Reasoning "involves not only accuracy but also the application of the appropriate level of complexity" (Section 1).
- Method (Section 4): self-training: sample 10 responses per instance from the model, build simplified positive examples (First-Correct Solution, FCS+Reflection, Greedily Diverse Solutions), and fine-tune with SimPO (also compared SFT, DPO, RPO). Adds outcome efficiency and process efficiency metrics.
- Models/tasks: QwQ-32B-Preview and DeepSeek-R1 for analysis; QwQ-32B-Preview for training. Test sets ASDIV (2,305 instances), GSM8K, MATH500, plus GPQA and AIME in the abstract; difficulty ordering stated as ASDIV < GSM8K < MATH500.
- Headline numbers: for "what is the answer of 2 plus 3?", o1-like models used "1,953% more tokens" than conventional models (Section 1, Figure 1a); in "more than 92% of cases, the initial round of solutions produces the correct answer", and the first round is "less than 60%" of tokens (Section 2, Figure 5); QwQ on ASDIV averages 3.5 solutions vs 3.2 on MATH500 (so more rounds on easier data); both models get "less than 50%" outcome efficiency on MATH500 Level 1 (Figure 7). Method result: "reduce token output by 48.6% while maintaining accuracy" on MATH500 for QwQ-32B-Preview (Section 1, Figure 1b). Table 4 (cells parsed from PDF text): MATH500 QwQ base accuracy 93.0, 3.2 solutions, 2407.9 tokens; SimPO with FCS+Reflection (their recommended setting) 92.8, 1.9 solutions, 1330.7 tokens. (Their 48.6% headline is not the same as the 44.7% drop that those two table cells imply, so check which setting Figure 1b shows.)
- Baselines: DPO/RPO/SFT/SimPO on shortest-response data, base model; conventional LLMs Llama-3.3-70B-Instruct and Qwen2.5-Math-72B-Instruct for efficiency comparison (Table 1).
- Agent-builder implication: Reasoning models spend the most compute where it is least useful (trivial queries), and the first answer is usually already right. If the model is a pure reasoning model, put a fast route in front of it or cap the budget for easy inputs.

## 9. Stop Overthinking: A Survey on Efficient Reasoning for LLMs

- Citation: Yang Sui, Yu-Neng Chuang, Guanchu Wang et al. (Rice University). arXiv:2503.16419v4, 21 Aug 2025. https://arxiv.org/abs/2503.16419 . Published version (TMLR) NOT VERIFIED. PARTIAL READ: abstract, taxonomy, Section 5.2 "Routing Prompts" and sections on certainty-based adaptive reasoning; not the whole survey.
- Relevant content: Section 5.2 organises routing by prompt attributes: unknown criterion (describes Claude 3.7 Sonnet as the "first hybrid reasoning model" with two response modes, and says the routing criterion is unclear); trained classifier (RouteLLM, which uses Chatbot Arena preference data; Sketch-of-Thought with a DistilBERT router); and uncertainty-based self-routing (Self-Ref; "Confident or Seek Stronger"). It describes agentic overthinking work (Cuadron et al., 4,018 trajectories) and S1-Bench, a benchmark of "straightforward tasks aligned with System 1 thinking" for reasoning models.
- Limitations: survey; I did not verify numbers in the cited works from this document.
- Agent-builder implication: Good map of three decision-signal families for routing (trained difficulty classifier, model's own uncertainty, prompt properties) and a pointer to S1-Bench.

## 10. AdaptThink

- Citation: Jiajie Zhang, Nianyi Lin, Lei Hou, Ling Feng, Juanzi Li (Tsinghua). "AdaptThink: Reasoning Models Can Learn When to Think." arXiv:2505.13417v1, 19 May 2025. https://arxiv.org/abs/2505.13417 . Preprint in the version read. FULL TEXT read: abstract, Sections 1-5, Table 1 (partly scrambled), limitations.
- Definition: Thinking vs "NoThinking" (reasoning model skips the thinking block and writes the final solution directly, via an empty `</think>` first token). Not tied to Kahneman beyond motivation.
- Method (Sections 3-4): RL with a constrained objective that maximises the probability of NoThinking while keeping accuracy at least the reference level (relaxed with a penalty; margin delta=0.05), plus importance sampling to force half Thinking and half NoThinking samples so NoThinking is explored from the start. Policy chooses by its first token.
- Pilot (Section 3, Figure 2): DeepSeek-R1-Distill-Qwen-7B, MATH, 16 responses per problem in each mode. NoThinking is comparable on Levels 1-3 and "slightly outperforms Thinking on the easiest Level-1 problems"; "Thinking only brings notable benefits for challenging problems."
- Models/tasks: DeepSeek-R1-Distill-Qwen-1.5B and -7B; training on DeepScaleR (40K problems); evaluation on GSM8K (1319), MATH500 (500), AIME 2024 (30; 16 samples per problem), and out-of-distribution MMLU (Section 5). Training: 1 epoch, 314 steps, 8xH800 node for 32 hours (1.5B).
- Headline numbers: abstract: average length of the 1.5B model cut by 53% with accuracy up 2.4% across three math sets. Section 1: GSM8K -50.9%, MATH500 -63.5%, AIME2024 -44.7% length with accuracy +4.1%, +1.4%, +1.6%. Table 1 (parsed): 1.5B on GSM8K: original Thinking 79.0 accuracy, 978 tokens; AdaptThink 83.1, 480; NoThinking 69.8, 280. 7B on GSM8K: Thinking 87.9 / 682; AdaptThink 91.0 / 309. Figure 3/5: choice of NoThinking falls as MATH level rises. MMLU (Table 4): length down "more than 30%" with NoThinking chosen for about 16% of problems, accuracy higher than original.
- Baselines: Thinking, NoThinking, DPO-Shortest, OverThink, DAST, O1-Pruner, TLMRE, ModelMerging, RFT-MixThinking.
- Stated limitations: only 1.5B and 7B models due to compute; training on math only because of verifiable rewards; (Section 5.5) a small rise in "implicit thinking" inside NoThinking mode for the 7B model.
- Agent-builder implication: Evidence that a single reasoning model can learn to emit a mode choice as its first token, with difficulty-dependent behaviour. But it learned on math with verifiable rewards; no tool-use evidence.

## 11. Thinkless

- Citation: Gongfan Fang, Xinyin Ma, Xinchao Wang (NUS). "Thinkless: LLM Learns When to Think." arXiv:2505.13379v2, 26 Jun 2025. https://arxiv.org/abs/2505.13379 . Preprint in version read. FULL TEXT read: abstract, Sections 1-4, limitations; Table 1 numbers NOT reliably recoverable from the PDF text (column order lost), so I only quote prose.
- Definition: Short-form vs long-form reasoning, selected by control tokens `<short>` and `<think>`; "based on both task complexity and the model's ability" (abstract).
- Method: Warm-up SFT on paired long and short responses, then Decoupled GRPO (DeGRPO) with a separate loss on the control token and on the response tokens; says vanilla GRPO suffers early "mode collapse" because the response part dominates the token-level loss (Section 3, Figure on collapse).
- Models/tasks: DeepSeek-R1-Distill-Qwen-1.5B base; DeepScaleR (about 40K) for RL; evaluation on AIME, Minerva Algebra, MATH-500, GSM8K; 4 H100 GPUs, one node (Section 4.1). Baselines (Section 4.2): reasoning model, instruct models (Qwen2.5 1.5B, Qwen2.5-Math-1.5B-Instruct), model merging, CoT-Valve, and routers: a random router and a Qwen-7B router.
- Headline (Section 4.2 text, Finding 1; abstract): "reduce the usage of long-chain thinking by 50% - 90%". Minerva Algebra: reasoning mode used "for only 25% of the samples, reducing token usage to one-third of the original, while maintaining performance within a 1% margin". Router comparison: on AIME where "even the reasoning model achieves only 28% accuracy, the router struggles to recognize its difficulty", whereas Thinkless "jointly considers both input complexity and model capability". Also: fixed-length-control methods (merging, CoT-Valve) have an optimal length that "varies significantly across datasets", so a coefficient tuned on one dataset degrades another such as AIME. Also: on GSM8K, long reasoning "offers no clear advantage" and the 4K-context Qwen2.5-Math-1.5B-Instruct does better.
- Stated limitations: warm-up is simple SFT with slight initial performance drop and possible catastrophic forgetting; only a 40K-problem math dataset, so future work should add more domains.
- Agent-builder implication: A router that sees only the query misjudges difficulty for the specific reasoning model; the policy that actually pays the cost should learn the choice. This is evidence against a fixed external classifier but only at 1.5B and on math.

## 12. s1: Simple test-time scaling

- Citation: Niklas Muennighoff, Zitong Yang, Weijia Shi, Xiang Lisa Li, Li Fei-Fei, Hannaneh Hajishirzi, Luke Zettlemoyer, Percy Liang, Emmanuel Candès, Tatsunori Hashimoto. arXiv:2501.19393v3, 1 Mar 2025. https://arxiv.org/abs/2501.19393 . Venue in this version: none printed (EMNLP 2025 publication from memory, NOT VERIFIED). FULL TEXT read: abstract, Sections 1-5 (Table 1-3 partly scrambled).
- Definition: Not dual-process. "Test-time scaling": spend more tokens at inference to improve accuracy.
- Method (Section 3): "budget forcing": cap thinking by appending the end-of-thinking delimiter ("Final Answer:" optionally) once a maximum is hit; lengthen by suppressing the delimiter and appending "Wait" so the model re-checks. Metrics: Control, Scaling slope, Performance (Section 3.2).
- Models/data: Qwen2.5-32B-Instruct fine-tuned on s1K (1,000 questions with reasoning traces distilled from Gemini 2.0 Flash Thinking, selected for difficulty, diversity, quality; 7 H100 GPU hours vs 394 for the full 59K set, Section 4). Evaluated on AIME24, MATH500, GPQA Diamond, greedy decoding (Section 4).
- Headline numbers: abstract: "exceeds o1-preview on competition math questions by up to 27% (MATH and AIME24)"; budget forcing extrapolates AIME24 "from 50% to 57%" (Figure 1: f(7320)=57%). Section 5.2/Figure 4: gains "flatten out at six times" (of suppressing the end token) and suppressing too often "can lead the model into repetitive loops"; sequential scaling by budget forcing beats majority voting on the base model (Figure 4 right). The paper also says the concurrent r1-32B is stronger but trained on 800x more reasoning samples.
- Baselines: token/step/class-conditional length control, rejection sampling (Table 3), majority voting; o1-preview and Gemini 2.0 Thinking (Table 1).
- Stated limitations: flattening beyond about six "Wait"s, context limits, and repeated loops (Section 5.2).
- Agent-builder implication: A thinking-token cap is a working, cheap control knob (this and Qwen3's budget are the same trick), usable as the "dial" between fast and slow inside a single model; and the "Wait" trick shows more thinking is not monotonic.

## 13. Qwen3 Technical Report (hybrid thinking, selective read)

- Citation: Qwen Team. arXiv:2505.09388v1, 14 May 2025. https://arxiv.org/abs/2505.09388 . Technical report. SELECTIVE READ: abstract, "Thinking Mode Fusion" and "Thinking Budget" paragraph (Section 4.3), the thinking-budget scaling paragraph and Figure 2 in the evaluation; not the benchmark tables.
- What it says: one model with a "thinking mode" and "non-thinking mode", switched by `/think` and `/no_think` flags in the user or system message; non-thinking samples keep an empty thinking block (Section 4.3, Table 9). "Thinking Budget": when the thinking length hits a user-set threshold the process is halted and a fixed stop-thinking instruction is inserted ("Considering the limited time by the user, I have to give the solution based on the thinking directly now."), after which the model answers; "this ability is not explicitly trained but emerges naturally" from thinking-mode fusion. Figure 2: Qwen3-235B-A22B shows "scalable and smooth performance improvements correlated to the allocated thinking budget" on four benchmarks.
- Stated rationale: "reducing the cost and complexity of deploying separate models for thinking and non-thinking tasks."
- Not read: numerical comparisons of thinking vs non-thinking per benchmark; I did not check them.
- Agent-builder implication: In the open-weight ecosystem the hybrid model has become the default packaging of fast/slow in one model, with the decision left to the caller (flag + budget), not to the model. The switch signal is the application's job.

## 14. The Danger of Overthinking: Examining the Reasoning-Action Dilemma in Agentic Tasks

- Citation: Alejandro Cuadron, Dacheng Li, Wenjie Ma, Xingyao Wang, ..., Ion Stoica, Ana Klimovic, Graham Neubig, Joseph E. Gonzalez. arXiv:2502.08235v1, 12 Feb 2025. https://arxiv.org/abs/2502.08235 . Preprint. FULL TEXT read: abstract, Sections 1-5, Figures 1-5, Tables 1-3 (partly).
- Definition: "Overthinking": "models favor extended internal reasoning chains over environmental interaction." Three patterns: Analysis Paralysis, Rogue Actions, Premature Disengagement (Figure 4).
- Method: Run models in OpenHands on SWE-bench Verified, score each trajectory 0-10 with an LLM-as-judge overthinking score that validates against human experts (Spearman 0.800, Figure 5, on 20 traces scored by experts), analyse 4,018 trajectories.
- Headline results: Overthinking score negatively correlated with issue resolution for both reasoning (R-squared 0.892) and non-reasoning models (R-squared 0.839) (Figure 1/Table 1); reasoning models score about three times higher on overthinking (Table 2). Cost (Section 1 and Figure 3): o1 high effort 29.1% resolved at $1,400 vs low effort 21.0% at $400 (3.5x cheaper); generating two low-effort attempts ($800 total) and choosing the lower-overthinking one gives 27.3%, "reducing computational costs by 43%" vs high effort; with more samples 30.3% "using 15% less computational costs".
- Baselines: pass@k vs "Lowest Overthinking@k".
- Stated limitations: the o1 family hides its reasoning tokens, so those trajectories were scored without them (Section 3); software-engineering tasks only. Suggested mitigations (native function calling, selective RL) are not tested in the sections I read.
- Agent-builder implication: In an agent loop, more reasoning per step can reduce success by substituting imagined for real feedback. A cheap monitor (is the agent reasoning instead of acting?) is a usable escalation/de-escalation signal. Lower-effort model plus a selection step can beat a high-effort single run on cost.

## 15. Think Twice, Click Once (FOCUS): GUI grounding with fast and slow systems

- Citation: Fei Tang, Yongliang Shen, Hang Zhang et al. (Zhejiang University, Microsoft Research Asia). arXiv:2503.06470v1, 9 Mar 2025. https://arxiv.org/abs/2503.06470 . Preprint in version read. FULL TEXT read: abstract, Sections 1-3, Tables 1, 2, 4, switching section.
- Definition: Fast = direct grounding prediction; slow = progressive analysis (interface summary, then focused analysis, then grounding); inspired by "human dual-system cognition".
- Method: One Qwen2-VL-2B-Instruct model trained on a mixed set where about 48.3% of samples are fast and 51.7% (150K) are slow (Section 2). Switch is made by the model's own first-token probability: p_slow = alpha * p(summary_start) vs p_fast = (1 - alpha) * p(grounding_start); the larger wins (Section 2.3, Equations 2-3). "Task complexity" is thus learned, not computed.
- Results: ScreenSpot (1,272 samples) average 77.4% vs ShowUI 75.1% and InfiGUIAgent 76.3% among about-2B models (Table 2 prose); ScreenSpot-Pro 13.3% vs AriaUI 11.3% and CogAgent 7.7%. Ablation (Table 4): removing both slow-stage components drops 77.4% to 71.4%; removing summary -2.6, removing focus -4.2. Figure 4: alpha ablation (best at 0.6, per caption fragment).
- Stated limitations: I did not find a dedicated limitations section in what I read. Absolute numbers on ScreenSpot-Pro are low (13.3%).
- Agent-builder implication: A GUI-grounding step can mix fast direct clicks and slower stepwise analysis in one small model, with the choice read off the model's own token probabilities. Treat as grounding-only evidence (single-step), not full-task agent evidence.

## 16. Cognitive Duality for Adaptive Web Agents (CogniWeb)

- Citation: Jiarun Liu, Chunhong Zhang, Zheng Hu (BUPT). arXiv:2508.05081v1, 7 Aug 2025. https://arxiv.org/abs/2508.05081 . "Preprint. Under review." FULL TEXT read: abstract, Sections 1-6, Table 1 (partly scrambled).
- Definition: Fast = intuitive, reactive behaviour (offline imitation learning, e.g. clicking by interface similarity); slow = deliberative planning with online exploration (typing text, conditional filters) (Figure 1).
- Method: System 1 (gpt-4o prompted for direct action, or fine-tuned Phi-3-mini-128k-instruct 3.8B or gemma-3-1b-it with SFT on MiniWoB++ plus Mind2Web); System 2 (gpt-4o with reasoning and reflection and an episodic memory); a Switch with weight lambda_t, implemented "as a hybrid approach combining rule-based switching with prompt learning" with few-shot switching scenarios, and noting that SwiftSage-style heuristics "face generalization challenges" (Section 3).
- Evaluation: WebArena, 812 tasks, "2 epochs" (Section 4); metrics: success rate and tokens per trajectory.
- Results: CogniWeb 43.96% with fine-tuned Phi-3-mini as System 1 and 393.89 output tokens; a "purely reasoning-based agent (System 2 only)" reaches 46.06% with 1503.83 tokens, "nearly four times the average output length... for this modest 2% performance improvement" (Section 4). Abstract: "43.96% success rate" and "75% reduction in token usage". Ablation: removing the self-reflection memory from System 2 drops success from about 40% to 20%. Qualitative (Figure 4): System 2 plans, System 1 executes clicks, System 2 re-engages to verify.
- Stated limitations/caveats: Does not beat the best prior WebArena entries (Zhang et al. 2025a, Su et al. 2025); the authors argue WebArena "emphasizes System 2 capabilities over System 1" because its sites are simplified; the Table 1 token/other columns are partly unreadable in my extraction so I am not quoting more than the prose numbers.
- Agent-builder implication: This is the direct "slow planner, fast executor, switch back to slow for verification" shape for web agents, with a cost ratio (about 4x tokens for about 2 points). Evidence is on one benchmark and the "75%" and "2 points" claims rest on this one comparison; preprint.

## 17. Visual Agents as Fast and Slow Thinkers (FaST)

- Citation: Guangyan Sun, Mingyu Jin et al. ICLR 2025. arXiv:2408.08862v4, 10 Feb 2025. https://arxiv.org/abs/2408.08862 . PARTIAL READ: abstract, Sections 1-3 and the results text; Table 1/2 cells not verified.
- Definition: System 1 = fast direct answer; System 2 = slower hierarchical chain-of-evidence with a proposal step.
- Method: a "switch adapter" (LoRA on LLaVA-v1.5) trained on positive fast-thinking data and negative contextual data so that low confidence on uncertain or unseen objects triggers slow mode (Remarks 2.1-2.2, Section 1).
- Results (abstract): 80.8% on VQAv2; 48.7% GIoU on ReasonSeg. Section 4 text: +2.3% VQAv2, +1.8% GQA, +2.5% TextVQA vs LLaVA-v1.5.
- Limitations: not read closely.
- Agent-builder implication: The trigger is the model's uncertainty about whether it can answer. Modality is vision, so transfer to text agents is a guess.

## 18. Reasoning on a Spectrum: Aligning LLMs to System 1 and System 2 Thinking

- Citation: Alireza S. Ziabari, Farzan Karimi-Malekabadi, Nona Ghazizadeh, Zhivar Sourati, Payam Piray, Morteza Dehghani (USC). arXiv:2502.12470v3, 15 Oct 2025. https://arxiv.org/abs/2502.12470 . Preprint. READ: abstract, Sections 1-5 (Section 5.5), not all appendices.
- Definition: System 1 = short heuristic responses, System 2 = step-by-step; they curate a dataset of paired System 1 and System 2 answers and align Llama-3-8B-Instruct and Mistral-7B-Instruct-v0.1 with SFT, DPO and SimPO (Section 4).
- Findings: "System 2-aligned models excel in arithmetic and symbolic reasoning, while System 1-aligned models perform better in commonsense reasoning tasks" (abstract); Table 1: 13 benchmarks (cells not extracted). Interpolating the alignment mix changes accuracy monotonically (Figure 4). "System 1 models employ more definitive outputs, whereas System 2 models demonstrate greater uncertainty" (abstract). Training-free combination by entropy: with weight w=0.4 the Llama DPO-dynamic model beats the base on 12 of 13 benchmarks, SimPO-dynamic on 11; Mistral DPO-dynamic on 11 of 13, SimPO-dynamic on 12 of 13 (Section 5.5).
- Limitations: not read.
- Agent-builder implication: For some task types (commonsense), forced step-by-step is worse; entropy of the generation is a candidate switching signal. Small 7-8B models only.

## 19. Don't Overthink, Don't Underthink: Toward Adaptive Reasoning in Agentic AI

- Citation: Md Jueal Mia, M. Hadi Amini (Florida International University). arXiv:2608.26442v1, 26 Aug 2026. https://arxiv.org/abs/2608.26442 . Preprint, very new; small scale. READ: most of the 30 KB text.
- Content: A "preliminary empirical study" (their wording, Conclusion) in a LangGraph agent framework on MATH-500 and GAIA with tool agent Qwen3.5-4B and reasoning models including Phi-4-reasoning and Llama-3.1-8B-Instruct. Findings: Phi-4-reasoning beats Qwen3.5-4B on MATH-500 (92.40% vs 87.60%) but takes 180.80 s vs 70.21 s and 4046.59 vs 2461.67 output tokens; on GAIA, Phi-4-reasoning takes 182.94 s vs 67.49 s and gets slightly lower accuracy (11.52% vs 12.12%). Under-reasoning rates: on GAIA 71.52% for Llama-3.1-8B-Instruct, 62.42% for Phi-4-reasoning, 36.97% for Qwen3.5-4B. Proposes (as a direction, not tested) an "adaptive-reasoning controller" that allocates reasoning effort through an agent run.
- Caveat: One configuration, small models, no controller built. Use only as a hint that over- and under-reasoning coexist in agent pipelines.

## 20. A Dual-Process Perspective on Nudge Susceptibility in LLM-Based GUI Agents

- Citation: Haya Halimeh, Sascha Kaltenpoth, Kevin Bösch, Oliver Müller (Paderborn University). arXiv:2609.19843v1, 17 Sep 2026. https://arxiv.org/abs/2609.19843 . Preprint. Used only for (a) its explicit caveat on the metaphor (see below) and (b) its abstract-level finding, which I read in the abstract and Section 2 only: 3,600 agents, 21,600 simulations, six frontier models from three providers; reasoning configuration reduced susceptibility to default nudges but heightened it to social-influence nudges. "Extensive reasoning therefore did not make agents more robust but redirected the route through which choice architecture takes effect."
- Agent-builder implication: Slow thinking is not a safety fix; it changes which manipulations work. Do not assume the slow path is the safe path for adversarial UIs.

---

# Synthesis

## What "System 1" and "System 2" mean differs by paper

| Paper | System 1 is | System 2 is |
|---|---|---|
| Talker-Reasoner | conversational agent, always on, reads memory | planner / belief-former with tools, runs behind |
| SwiftSage | small fine-tuned seq2seq (770m flan-t5) | prompted GPT-4 doing plan-and-ground |
| Distilling S2 into S1; Dualformer | no intermediate tokens | any approach that emits intermediate tokens / traces |
| System 2 Attention | the attention mechanism itself | an LLM call that rewrites the context |
| AdaptThink, Thinkless, Qwen3 | no-thinking / short response | long chain-of-thought |
| CogniWeb; FOCUS; FaST | direct action / direct grounding / direct answer | planning and reflection / stepwise analysis / evidence chain |
| Reasoning on a Spectrum | short heuristic answers | step-by-step answers |

The label is not stable. It can mean role, model size, presence of intermediate tokens, or mode of one model. A book chapter should define its own term (for instance "no-reasoning-tokens path" vs "reasoning-tokens path") rather than inherit one.

## Recurring decision signals (what the papers use to decide fast vs slow)

1. Difficulty estimate.
   - Snell et al.: difficulty is the base model's own pass@1 binned in five levels; the best strategy differs per bin; estimating it costs compute that they do not charge (Sections 3.2, 8).
   - AdaptThink pilot (Figure 2) and Chen et al. (Figure 7): the benefit of thinking grows with MATH level; trivial items waste most.
   - Thinkless text: an external router (Qwen-7B) fails to see AIME's difficulty for the reasoning model; model-specific learning is better.
   - Dualformer: auto mode picks slow more as maze size and wall density grow (Figure 4.1), but this is correlational.
2. Confidence / uncertainty.
   - FaST: low confidence triggers slow mode (switch adapter). FOCUS: first-token probabilities. Reasoning on a Spectrum: entropy of generations to combine S1 and S2 models (12 of 13 benchmarks improved at w=0.4). Survey (Sui et al., Section 5.2): Self-Ref and "Confident or Seek Stronger" route on uncertainty (only seen via the survey's description).
3. Verifier or progress failure.
   - SwiftSage: K=5 zero-reward steps, invalid action, unexpected observation. CogniWeb: rule-based switch for common failure patterns plus prompt-learned switch. Snell: a verifier can be over-optimised on easy items.
4. Step type / task phase.
   - SwiftSage "critical" action (final answer); Talker-Reasoner coaching phase "planning" means wait for the Reasoner; CogniWeb: text input and filters are slow, clicking is fast (Figure 1).
5. Cost / latency budget.
   - Qwen3 thinking budget and s1 budget forcing: an explicit token cap. Cuadron: cost-quality curve of effort levels. Talker-Reasoner: latency is the stated reason for the asynchronous split.
6. A signal that appears in one paper only: an "overthinking score" over agent trajectories (reasoning in place of acting), Cuadron et al.

## Recurring integration shapes

1. Fast-first with escalation (SwiftSage; CogniWeb switch; FaST; FOCUS; routing in the Sui survey). Escalation signal is a failure, an uncertainty or a step type.
2. Slow planner plus fast executor (Talker-Reasoner as async front/back; CogniWeb qualitative example where System 2 plans and System 1 clicks; SwiftSage's SAGE action buffer, where one slow call funds about five fast steps).
3. Distillation (Yu et al.): slow outputs filtered by self-consistency become fast training data. Works for context-sanitising, rewriting, judging tasks; failed on GSM8k CoT (7.13% vs 52.77%).
4. Adaptive thinking budget inside one model: Dualformer (trace dropping), AdaptThink (first-token NoThinking), Thinkless (control tokens), Qwen3 (flags plus budget), s1 (budget forcing), Reasoning on a Spectrum (aligned pair with entropy mixing).
5. Cheap pre-pass on the input (System 2 Attention): a slow-ish step to clean the context before a normal call.

## Points where papers disagree or sit in tension

- Who decides: Thinkless argues an external router cannot see model-specific difficulty, so the reasoning model should choose; SwiftSage and Talker-Reasoner use hand-written external rules; Qwen3 leaves the choice to the caller. Both SwiftSage and Talker-Reasoner list a learned or automatic switch as unsolved future work.
- Whether slow helps in agents: Snell and s1 find more thinking scales on verifiable math; Cuadron finds more reasoning correlates with LOWER success in SWE-bench agents (though o1 high effort still got 29.1% vs 21.0% for low effort, so effort level and the overthinking-score measure are not the same thing); CogniWeb finds System 2 only is 2 points better at about 4x tokens on WebArena.
- Whether distillation of slow into fast is feasible: Yu et al. say yes for rewriting and judging, no for math CoT; Dualformer and AdaptThink instead keep both modes in one model.
- Whether "no thinking" can beat thinking: AdaptThink and Thinkless find NoThinking equal or better on easy items and some GSM8K cases; Snell finds extra search hurts on easy items; Reasoning on a Spectrum finds System 1 alignment wins on commonsense tasks. None of these were tested on tool-using agents.
- Evidence level is uneven: Talker-Reasoner has no quantitative results; CogniWeb is on one benchmark and under review; AdaptThink and Thinkless use 1.5B (and 7B) models on math; Snell uses one model family on MATH.
- Test-time compute vs model size: Snell shows a smaller model with test-time compute can beat a 14x larger model on problems with non-trivial base success, but pretraining wins on the hardest questions at high inference loads (Figure 9); this bears on "fast small model plus verifier" vs "one big model".

## The Kahneman framing is a metaphor

- The papers use it as inspiration, and several state caveats or define it operationally:
  - Yu et al. define S1/S2 by presence of intermediate tokens, which is an engineering definition, not a psychological one.
  - Talker-Reasoner opens with the Kahneman quote but says "most cognitive processes are a mix of both" (Section 1) and ends with the authors' claim to be "the first to formalize the duality".
  - Halimeh et al. (2026) say "the parallel is functional rather than mechanistic... the analogy concerns observable input-output behaviour... not the underlying computation" (Section 2; cites Shanahan et al., 2023, which I did not read) and, from the abstract-level search result, "LLMs do not switch between these modes autonomously in the same way" (NOT VERIFIED beyond a search snippet).
  - Li et al.'s survey (Section 6.2) says "Unlike humans, who fluidly switch... current reasoning LLMs struggle to maintain this balance".
- I did NOT find, and did not read in full, a paper whose main thesis is a critique of the S1/S2 analogy for LLMs. A search surfaced items I have NOT opened: an essay discussing arguments for and against equating chain-of-thought with human System 2 thinking (Substack "The Sequence"), a 2025 hypothesis paper reading reasoning-model breakdowns as bounded-rationality effects (title not captured; mentions a link to the "illusion of thinking" debate), and a 2026 semantic-memory paper (arXiv:2604.12816) that calls the framework a "useful metaphor". Treat those as leads, not sources.
- Also relevant background not read here: human dual-process theory itself is contested in psychology (not researched in this pass).

## Implications for an agent builder (distilled)

- Start with the fast path as the default. Escalate on observable triggers: no progress for several steps, invalid or malformed tool call, an unexpected tool error, an irreversible or final action, a model-reported low confidence.
- Put slow compute where it pays: planning, verification and error recovery, not every step. Evidence for per-step trade-offs in agents: CogniWeb (about 4x tokens for about 2 points) and Cuadron (cost of high effort).
- Handoff mechanisms seen: shared memory/belief object (Talker-Reasoner); an action buffer returned by the slow model (SwiftSage); a first-token mode choice (AdaptThink, Thinkless, FOCUS); a flag/budget from the caller (Qwen3, s1).
- Easy items on reasoning models waste most; cap or bypass.
- Offline distillation for stable, repeated transformations; not for multi-step arithmetic reasoning.
- Measure on your own task: every strong number above comes from math, planning puzzles, a single simulator, or one web benchmark.

## Gaps to follow up

- Claude, OpenAI and Gemini hybrid-reasoning documentation (effort levels, adaptive thinking) is first-party documentation, not covered here.
- Routing papers (RouteLLM, FrugalGPT, cascades with confidence) were not read in full; only seen via the Sui survey.
- Papers on thinking-budget in tool-use agents specifically (beyond Cuadron and CogniWeb) were not found in this pass.
- Re-verify scrambled table cells (AdaptThink Table 1, Thinkless Table 1, CogniWeb Table 1, Dualformer Tables 4.1-4.3, Chen et al. Table 4) against the PDFs before quoting in print.
- Check final venues for Snell (ICLR 2025?), s1 (EMNLP 2025?), Chen et al. and AdaptThink before citing.
