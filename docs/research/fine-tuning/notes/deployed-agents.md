# Evidence from deployed agents (as of November 2026)

Research notes, gathered 2026-11-19. The one independent source is MAP ([map-reread.md](map-reread.md)); everything else is a vendor describing its own product, fetched with `curl` and read as data.

## Takeaway

Two kinds of team tune agent models, and they look nothing alike. Most enterprise teams in MAP prompt frontier models and tune only where latency or volume forces it (6 of 20). Coding-agent vendors with their own harness and fleets of sandboxes, Cursor and Cognition, train agent models with reinforcement learning inside that harness, for speed. Both vendors say their tuned model is tied to the harness it was trained in, and both still rank the best frontier models at or above their own on quality.

## Independent: MAP

- 14 of 20 interviewed teams use no SFT or RL; 5 use SFT, 4 of them alongside off-the-shelf models; 1 uses RL; 3 of the 4 latency-bound teams tune. Teams call SFT and RL "brittle to model upgrades, requiring costly retraining when versions change" ([arXiv 2512.04123v4](https://arxiv.org/abs/2512.04123), §5.2).

## Vendor: Cursor Composer

- [Cursor, "Composer: Building a fast frontier model with RL"](https://cursor.com/blog/composer), 29 Oct 2025: "On our benchmarks, the model achieves frontier coding results with generation speed four times faster than similar models."
- "It is specialized for software engineering through reinforcement learning (RL) in a diverse range of development environments." "During RL, we want our model to be able to call any tool in the Cursor Agent harness." Training needed "hundreds of thousands of concurrent sandboxed coding environments in the cloud" and scaled "to thousands of NVIDIA GPUs".
- "during RL, the model learns useful behaviors on its own like performing complex searches, fixing linter errors, and writing and executing unit tests."
- Footnote: "Benchmarked on an internal benchmark in the Cursor tool harness." "'Best Frontier' includes GPT-5 and Sonnet 4.5, which both outperform Composer."

## Vendor: Cursor Tab

- [Cursor, "Improving Cursor Tab with online RL"](https://cursor.com/blog/tab-rl), 12 Sep 2025: the Tab model handles "over 400 million requests per day", and Cursor uses which suggestions "users accept and reject" to improve it "using online reinforcement learning". Tab is a completion model, not an agent; it shows where the training signal comes from at scale.

## Vendor: Cognition SWE-1.5

- [Cognition, "SWE-1.5"](https://cognition.ai/blog/swe-1-5), 29 Oct 2025: "a frontier-size model with hundreds of billions of parameters that achieves near-SOTA coding performance", served "at up to 950 tok/s – 6x faster than Haiku 4.5 and 13x faster than Sonnet 4.5".
- Method: "End-to-end reinforcement learning (RL) on real task environments using our custom Cascade agent harness on top of a leading open-source base model." "Our vision is to co-optimize models and harness: we repeatedly dogfooded the model, noticed issues with the harness, made adjustments to tools and prompts, and then re-trained the model on the updated harness."
- On harness coupling: "After tuning, we observed a noticeable performance improvement over evaluations done in alternative harnesses. Note that this is not a reflection of the capability of the harnesses themselves: models tuned for the other harnesses could perform just as well if not better (e.g. Sonnet in Claude Code). A notable factor in the lower scores was a greater incidence of tool call failures."
- Infrastructure: a hypervisor "that allows us to scale Devin to tens of thousands of concurrent machines".

## Vendor: Anthropic and AWS

- Anthropic's Haiku moderation result (81.5% → 99.6%, 85% fewer tokens) and the SK Telecom quote are in [provider-docs.md](provider-docs.md#anthropic). AWS claims Bedrock RFT "improves model accuracy by up to 66% on average compared to base models" ([Bedrock RFT](https://docs.aws.amazon.com/bedrock/latest/userguide/reinforcement-fine-tuning.html)).
