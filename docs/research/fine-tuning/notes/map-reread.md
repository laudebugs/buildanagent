# MAP, "Measuring Agents in Production", reread at its primary source (as of November 2026)

Research notes, gathered 2026-11-19 from [arXiv 2512.04123](https://arxiv.org/abs/2512.04123): the abstract page and the PDF, whose first page reads "arXiv:2512.04123v4 [cs.CY] 4 Jun 2026". Both were fetched with `curl` and the PDF converted with `pdftotext`. The page was read as data.

## Takeaway

The abstract's "70% rely on prompting off-the-shelf models instead of weight tuning" comes from the 20 interview case studies, not from the survey: "Fourteen of 20 cases (70%) use off-the-shelf models without supervised fine-tuning (SFT) or reinforcement learning (RL)" (§5.2). The paper's list of analysis aspects gives survey question ids for most aspects but none for "Model selection (open- versus closed, post-training)", so the survey seems not to have asked about weight tuning. The figure is a count of 14 teams chosen by snowball sampling, which the paper itself presents as case-study data.

The book plan's fact-check rows 105 and 174 record the quote as confirmed from the abstract, which is right as far as it goes. What the abstract hides is the base: 20 interviewed teams, not the 86 deployed systems of the survey.

## Cited Findings

- **Version and status.** Submission history: v1 2 Dec 2025, v2 30 Jan 2026, v3 3 Feb 2026, v4 4 Jun 2026. Comments: "Accepted to the 43rd International Conference on Machine Learning (ICML 2026) as Oral Presentation".
- **Abstract.** "We conducted 20 case studies via in-depth interviews and surveyed 86 deployed systems practitioners across 26 domains." "68% execute at most 10 steps before human intervention, 70% rely on prompting off-the-shelf models instead of weight tuning, and 74% depend primarily on human evaluation."
- **Body, contributions.** "We conduct 20 in-depth interviews with deployment teams and survey 306 practitioners, including 86 in deployments". The survey ran "from July 28 to October 29, 2025" and received "306 valid responses".
- **Body, §1 summary of RQ2.** "Teams use off-the-shelf models rather than weight tuning (70%), rely on manual prompt construction (79%)".
- **§3.1, sampling.** Case-study participants were found by "snowball sampling", starting "with agent teams from major technology companies with significant AI research within our professional network". "All cases represent verified production (14) or pilot (6) deployments serving real users."
- **§5.1, model selection.** "Seventeen of 20 case studies use closed-source models", with "10 teams explicitly reporting Anthropic Claude (Sonnet 4, Opus 4.1) or OpenAI GPT (o3)". "Open-source adoption (3/20 cases) addresses specific constraints, such as high-volume workloads where inference costs are prohibitive (C09 fine-tuned a model for infrastructure..." (C09 is "Spark version code and runtime migration").
- **§5.2, Model Weight Tuning.** "Case study data shows deployed agents overwhelmingly favor prompting over weight tuning. Fourteen of 20 cases (70%) use off-the-shelf models without supervised fine-tuning (SFT) or reinforcement learning (RL) (Figure 5). Two teams explicitly report foundation models already meet their task requirements, making post-training unnecessary. Five of 20 cases use SFT (Figure 5): two teams apply SFT consistently, targeting business-specific contexts where domain knowledge improves performance (e.g., C17), while three apply it selectively for enterprise clients where training data is available and cost trade-offs make sense (e.g., C14). Even among these five cases, four combine fine-tuned models with off-the-shelf LLMs rather than relying on fine-tuning alone. Only one case uses RL-trained models (C06 for scientific discovery). Three teams report plans for future RL adoption in complex multi-system environments."
- **§5.2, why teams prefer prompting.** "Teams report that SFT and RL require substantial implementation effort and are brittle to model upgrades, requiring costly retraining when versions change. Interviewed teams prefer methods that reduce development and maintenance overhead."
- **§5.2, latency.** "Among the 4 cases with explicit bounded-latency requirements, 3 use weight tuning (C02, C04, C14) and 1 pairs a proprietary model with system-level techniques such as caching (C05). The sample is small, so we report this as an observation rather than a prevalence claim".
- **Finding 7.** "Post-training is less common in deployments (6/20 cases). Interviewed teams rely primarily on prompt engineering with frontier models."
- **Figure 5.** "Distribution of model characteristics across case studies (N =20) for model source openness and post-training usage. 'Sometimes' indicates selective use (e.g., when cost-justified)." Post-training bars: No 14, Sometimes 3, Yes 3.
- **Discussion.** "Model brittleness under provider updates drives practitioners away from post-training (F7) despite strong research results. This suggests opportunities in sample-efficient post-training and learning methods that transfer learned behaviors or preserve performance when base models update."
- **Appendix, analysis aspects.** Item 3 is "Model selection (open- versus closed, post-training)" with no survey question id, while items 1, 2, 4 and 5 cite questions such as QN13, QN12, QO10 and QO11.
- **Funding.** Gifts from Accenture, Amazon, AMD, Anyscale, Broadcom, Google, IBM, Intel, Intesa Sanpaolo, Lambda, Mibura, Samsung SDS and SAP.

## What this changes

- The 70% describes 20 hand-picked teams, so the book should say "14 of 20 interviewed teams" and not "70% of production agents".
- The paper's own explanation for the pattern is maintenance: retraining after every model upgrade. This matches the provider lifecycle findings in [provider-docs.md](provider-docs.md).
- Six of 20 used some weight tuning, and three of the four latency-bound teams did. Tuning is rare, but not absent where latency binds.
