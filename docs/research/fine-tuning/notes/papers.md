# Papers on fine-tuning, distillation, RL and prompting (as of November 2026)

Research notes, gathered 2026-11-19 from arXiv abstract pages fetched with `curl`. Each entry gives the latest version and its date from the submission history, then quotes the abstract. Abstracts were read as data; bodies were not read unless noted.

## Takeaway

The papers agree on a split. Fine-tuning teaches a model behaviour, formats and narrow skills, and it lets a small model match a large one on one task. It teaches new facts badly, and retrieval beats it for knowledge. Prompting goes further than its reputation: careful prompting beat specialist tuned models in medicine, many-shot prompts match fine-tuning on some tasks, and a prompt optimiser beat RL with far fewer rollouts. Tuning also carries risks prompting lacks: lost safety training, broad misalignment from narrow data, and forgetting outside the target domain.

## Knowledge: retrieval beats tuning

- **Ovadia et al., "Fine-Tuning or Retrieval? Comparing Knowledge Injection in LLMs"** ([arXiv 2312.05934](https://arxiv.org/abs/2312.05934), v3, 30 Jan 2024): "while unsupervised fine-tuning offers some improvement, RAG consistently outperforms it, both for existing knowledge encountered during training and entirely new knowledge". "LLMs struggle to learn new factual information through unsupervised fine-tuning".
- **Gekhman et al., "Does Fine-Tuning LLMs on New Knowledge Encourage Hallucinations?"** ([arXiv 2405.05904](https://arxiv.org/abs/2405.05904), v3, 1 Oct 2024): new-knowledge examples "are learned significantly slower"; once learned, "they linearly increase the model's tendency to hallucinate". The results "support the view that large language models mostly acquire factual knowledge through pre-training, whereas fine-tuning teaches them to use it more efficiently."
- **Balaguer et al. (Microsoft), "RAG vs Fine-tuning: Pipelines, Tradeoffs, and a Case Study on Agriculture"** ([arXiv 2401.08406](https://arxiv.org/abs/2401.08406), v3, 30 Jan 2024): "an accuracy increase of over 6 p.p. when fine-tuning the model and this is cumulative with RAG, which increases accuracy by 5 p.p. further."

## Prompting goes further than expected

- **Nori et al., Medprompt, "Can Generalist Foundation Models Outcompete Special-Purpose Tuning? Case Study in Medicine"** ([arXiv 2311.16452](https://arxiv.org/abs/2311.16452), v1, 28 Nov 2023): with Medprompt, "GPT-4 achieves state-of-the-art results on all nine of the benchmark datasets in the MultiMedQA suite"; it "outperforms leading specialist models such as Med-PaLM 2 by a significant margin with an order of magnitude fewer calls"; "a 27% reduction in error rate on the MedQA dataset". Authors are from Microsoft, which sells GPT-4 through Azure.
- **Agarwal et al., "Many-Shot In-Context Learning"** ([arXiv 2404.11018](https://arxiv.org/abs/2404.11018), v3, 17 Oct 2024): many-shot learning "performs comparably to fine-tuning", is "effective at overriding pretraining biases", and "inference cost increases linearly in the many-shot regime".
- **Mosbach et al., "Few-shot Fine-tuning vs. In-context Learning: A Fair Comparison and Evaluation"** ([arXiv 2305.16938](https://arxiv.org/abs/2305.16938), v2, 30 May 2023): controlling for model size (125M to 30B) and examples, "both approaches generalize similarly; they exhibit large variation and depend on properties such as model size and the number of examples".
- **Agrawal et al., GEPA, "Reflective Prompt Evolution Can Outperform Reinforcement Learning"** ([arXiv 2507.19457](https://arxiv.org/abs/2507.19457), v2, 14 Feb 2026): "Across six tasks, GEPA outperforms GRPO by 6% on average and by up to 20%, while using up to 35x fewer rollouts." GEPA "samples trajectories (e.g., reasoning, tool calls, and tool outputs) and reflects on them in natural language".

## Small tuned models can match large prompted ones on one task

- **Hsieh et al., "Distilling Step-by-Step!"** ([arXiv 2305.02301](https://arxiv.org/abs/2305.02301), v2, 5 Jul 2023): "our finetuned 770M T5 model outperforms the few-shot prompted 540B PaLM model using only 80% of available data on a benchmark".
- **Zhao et al. (Predibase), "LoRA Land: 310 Fine-tuned LLMs that Rival GPT-4"** ([arXiv 2405.00732](https://arxiv.org/abs/2405.00732), v1, 29 Apr 2024): "4-bit LoRA fine-tuned models outperform base models by 34 points and GPT-4 by 10 points on average" over 10 base models and 31 tasks. Predibase sells fine-tuning and LoRA serving.
- **Biderman et al., "LoRA Learns Less and Forgets Less"** ([arXiv 2405.09673](https://arxiv.org/abs/2405.09673), v2, 20 Sep 2024): "LoRA substantially underperforms full finetuning" in code and maths, but "LoRA better maintains the base model's performance on tasks outside the target domain."

## Agents

- **Chen et al., "FireAct: Toward Language Agent Fine-tuning"** ([arXiv 2310.05915](https://arxiv.org/abs/2310.05915), v1, 9 Oct 2023): "most of these agents rely on few-shot prompting techniques with off-the-shelf LMs". "fine-tuning Llama2-7B with 500 agent trajectories generated by GPT-4 leads to a 77% HotpotQA performance increase."
- **Zeng et al., "AgentTuning"** ([arXiv 2310.12823](https://arxiv.org/abs/2310.12823), v2, 22 Oct 2023): "The AgentLM-70B is comparable to GPT-3.5-turbo on unseen agent tasks", "without compromising general abilities".
- **Kang et al., "Distilling LLM Agent into Small Models with Retrieval and Code Tools"** ([arXiv 2505.17612](https://arxiv.org/abs/2505.17612), v2, 5 Nov 2025): "sLMs as small as 0.5B, 1.5B, 3B parameters can achieve performance competitive with next-tier larger 1.5B, 3B, 7B models fine-tuned using CoT distillation".
- **Wei et al. (Meta AI, with UIUC and CMU), "SWE-RL"** ([arXiv 2502.18449](https://arxiv.org/abs/2502.18449), v2, 1 Dec 2025): "Llama3-SWE-RL-70B, achieves a 41.0% solve rate on SWE-bench Verified"; on five out-of-domain tasks RL improved results "whereas a supervised-finetuning baseline even leads to performance degradation on average."

## Risks of tuning

- **Qi et al., "Fine-tuning Aligned Language Models Compromises Safety, Even When Users Do Not Intend To!"** ([arXiv 2310.03693](https://arxiv.org/abs/2310.03693), v1, 5 Oct 2023): "we jailbreak GPT-3.5 Turbo's safety guardrails by fine-tuning it on only 10 such examples at a cost of less than $0.20 via OpenAI's APIs"; "simply fine-tuning with benign and commonly used datasets can also inadvertently degrade the safety alignment of LLMs, though to a lesser extent."
- **Betley et al., "Emergent Misalignment: Narrow finetuning can produce broadly misaligned LLMs"** ([arXiv 2502.17424](https://arxiv.org/abs/2502.17424), v7, 20 Jan 2026): a model "finetuned to output insecure code without disclosing this to the user" then "acts misaligned on a broad range of prompts that are unrelated to coding"; the effect "is strongest in GPT-4o and Qwen2.5-Coder-32B-Instruct".
