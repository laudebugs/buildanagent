# Fact-check: Evals, observability and release: knowing an agent got better

The claims log for [`evals-observability-and-release.md`](../src/content/chapters/evals-observability-and-release.md), checked section by section as each was drafted (BK21). Each row names the claim, the section it sits in, the verdict and the primary source. Pages were read on 2026-11-22. Package claims are checked against the harness pins of that date: `ai@7.0.162` and `@ai-sdk/otel` for the tracing example.

## The research question, answered before drafting

**Question.** How do you know an agent got better, what should every run record, and how do you release it safely?

**Answer, from the todo's sources only.** You know an agent got better when it passes more tasks on every attempt: pass^k, run k times in a clean environment, is the number to gate on, because pass@k rises with k while pass^k falls ([Anthropic, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)). Free-form answers need an LLM judge that grades against a rubric, and Anthropic found a single call that returns a 0.0 to 1.0 score and a pass-fail grade the most consistent and the best aligned with human judgements ([How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)). Every run should record a tree of spans, an agent span, a span for each step, and a span for each model call and tool call, with token counts, so a run can be read and costed; our harness plans to project that tree from the session log (harness guide §9). A release goes through an offline gate, two weeks of shadow, a canary and a general release behind a graded kill switch, and each incident becomes a regression task (agent guide §7).

**Gaps.** Rollout evidence is thin and mostly practitioner writing, and the durations, thresholds and k=5 are our proposals. The harness's telemetry projection and the eval package are stubs, as of November 2026.

## Opening and "pass^k counts a task only when every attempt passes, and pass@k hides the failures"

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| 1 | Under pass@k a task counts when any attempt passes, and under pass^k only when all k attempts pass | Opening; § pass^k | ✅ | [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [agent log row 11](../../../docs/research/agent/fact-check.md): the page defines both and computes "(0.75)³ ≈ 42%"; τ-bench defines pass^k as the consistency metric ([agent log row 4](../../../docs/research/agent/fact-check.md)) |
| 2 | An agent that passes 75% of single attempts passes three in a row about 42% of the time, since 0.75 cubed is 0.42 | § pass^k | ✅ | Agent log row 11: the page computes "(0.75)³ ≈ 42%"; 0.75³ = 0.421875 |
| 3 | The same agent's pass@3 is 98%: 1 minus 0.25 cubed | § pass^k | ✅ | Arithmetic: 1 − 0.25³ = 0.984375. The figure's values for k=1 to 5 are 1 − 0.25^k (75.0, 93.8, 98.4, 99.6, 99.9) and 0.75^k (75.0, 56.3, 42.2, 31.6, 23.7) |
| 4 | τ-bench's abstract says agents "like gpt-4o succeed on <50% of the tasks, and are quite inconsistent (pass^8 <25% in retail)" | § pass^k | ✅ | [arXiv 2406.12045](https://arxiv.org/abs/2406.12045), abstract, [agent log row 4](../../../docs/research/agent/fact-check.md). A claim about what the abstract says, not about the paper's method or tables, so the chapter attributes it to the abstract |
| 5 | Our guide's gate runs each task five times in a clean environment, blocks when a regression task that passed pass^5 now fails it or a safety task fails a single attempt, and these numbers are our proposals | § pass^k | ✅ | [Agent guide §6](../../../docs/guides/agent.md#6-evals-30-real-tickets-graded-on-final-state-released-on-passk-with-cost-beside-every-score): "The suite, k=5 and the 15% budgets are our proposals" |
| 6 | Anthropic's advice for a first suite is "20-50 simple tasks drawn from real failures", with evals balanced because "one-sided evals create one-sided optimization" | § pass^k | ✅ | Agent log row 11: all passages found on the page |
| 7 | A suite that small cannot resolve small gains, so the gate blocks on a single task flipping and reads each flip as a transcript | § pass^k | ⚠️ | Agent guide §6: "aggregate scores cannot resolve small changes … The gate therefore blocks on individual task flips"; our design reasoning, and the page's "45 tasks catch a 13-point gap only half the time" was not re-checked here |
| 8 | Every capstone in `verify/` runs against a scripted model that fails in the same way on every run, so its pass^5 is 0 or 1 | § pass^k | ✅ | `AGENTS.md`, "Mock models"; the capstones' scripted models in `verify/*/examples/` (example headers); the rest is arithmetic |
| 9 | The capstones' `check()` assertions are shaped like evals, and a scripted failure tests the harness and does not measure the agent | § pass^k | ⚠️ | Our reading, stated as such in the chapter |
