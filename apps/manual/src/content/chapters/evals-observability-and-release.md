---
title: "Evals, observability and release: knowing an agent got better"
summary: A pass rate on one attempt hides how often an agent fails. This chapter shows why pass^k is the number to gate a release on, how an LLM judge and its grading code score an answer, how a run's spans record what it did and cost, and how four stages behind a graded kill switch carry an agent to real users.
opening: analogy
sources: [anthropic-demystifying-evals, anthropic-multi-agent-research-system, tau-bench, sre-workbook-canarying, abc-agentic-benchmark-checklist]
glossary: [pass-k, llm-judge]
switchTo: [N31, N36, N38]
---

A bridge that held the first crossing is not a bridge you trust if it gives way on every fourth. :analogy[A bridge that must hold every crossing]{#bridge-every-crossing} is the right picture of an agent that does the same task again and again: one success proves little, and the number that matters is how often every attempt holds. [[fig:bridge]] puts the two side by side.

:::figure[A bridge that must hold every crossing: one success proves little, and every attempt has to hold]{#bridge analogy="bridge-every-crossing"}
::svg{alt="Two columns joined by the word like. On the left, a bridge with three crossings: crossing 1 holds, crossing 2 holds, crossing 3 gives way, drawn in the accent. On the right, an agent on one task with three runs: run 1 passes, run 2 passes, run 3 fails, drawn in the accent. A line below says one success proves little and every crossing has to hold, and another says pass^k counts a task only when all k runs pass."}
:::

Knowing that an agent got better takes three things, and this chapter takes them in turn. The first is a score that counts consistency, so that a lucky run cannot pass a task. The second is a grader you can trust, because free-form answers need a judge and a judge needs checking. The third is a record of every run, with its steps, tokens and cost, so a bad run can be read and a regression can be seen. A release then moves the agent to real users in stages, behind a switch that can stop it, and sends each incident back into the suite as a new task.

## pass^k counts a task only when every attempt passes, and pass@k hides the failures

Run one task five times. The agent passes four times and fails once. Under pass@k, which counts a task when any attempt passes, that task is a success at every k above one. Under pass^k, which counts it only when all k attempts pass, the same task is a failure at k=5. Both numbers describe the same runs, and only the second tells a customer how often the agent will fail them.

The gap widens fast. Anthropic's guide to evals works an example: an agent that passes 75% of single attempts passes three in a row about 42% of the time, since 0.75 cubed is 0.42 [@anthropic-demystifying-evals]. The same agent has a pass@3 of 98%, because it would have to fail three times in a row to miss: 1 minus 0.25 cubed. [[fig:pass-k]] shows both numbers for k from 1 to 5.

:::figure[The same agent, 75% per attempt, under pass@k and pass^k: one rises toward 100% and the other falls]{#pass-k}
::svg{alt="Two columns of five horizontal bars, one row for each k from 1 to 5. On the left, pass@k, the share of tasks where any one of k attempts succeeds: 75.0, 93.8, 98.4, 99.6 and 99.9 percent, with bars that grow. On the right, pass^k, drawn in the accent, the share where all k succeed: 75.0, 56.3, 42.2, 31.6 and 23.7 percent, with bars that shrink. A line below says at 75% per attempt pass^3 is 42% and pass@3 is 98%."}
:::

The inconsistency is not hypothetical. The τ-bench paper, which simulates a customer talking to an agent with tools, reports in its abstract that agents "like gpt-4o succeed on <50% of the tasks, and are quite inconsistent (pass^8 <25% in retail)" [@tau-bench]. A mean pass rate hides that; pass^k shows it.

Our agent guide turns this into a release gate, and the numbers are our proposals. Run each task five times in a clean environment. Block the release when a regression task that passed pass^5 now fails it, or when a safety task fails a single attempt. Anthropic's advice for the first suite is "20-50 simple tasks drawn from real failures", balanced so that the suite does not optimize for one side only [@anthropic-demystifying-evals]. A suite that small cannot resolve small gains, so the gate blocks on a single task flipping and reads each flip as a transcript.

One caution applies to this book's own examples. Every capstone in the `verify/` harnesses runs against a scripted model, and a scripted model fails in the same way on every run. Its pass^5 is 0 or 1 and says nothing about how consistent a live model is. The `check()` assertions in those capstones are shaped like evals, one assertion for one behavior, but a scripted failure is a test of the harness and not a measurement of the agent.

## An LLM judge grades against a rubric, and its grading code rejects an answer that contradicts itself

Think of :analogy[a teaching assistant grading against a rubric]{#teaching-assistant-rubric}. The assistant reads each answer, checks it against the listed criteria and writes a mark with a reason, so hundreds of papers get the same treatment. An LLM judge does the same for answers that code cannot check, such as a free-form reply. The assistant can still be wrong in the same direction every time, so a person marks a sample, and the grades gate nothing until they agree with the person's.

Anthropic's team built this for a multi-agent research system. Research outputs are free-form text with rarely one correct answer, so they used an LLM judge that graded each output against a rubric of factual accuracy, citation accuracy, completeness, source quality and tool efficiency. They tried several judges and found that "a single LLM call with a single prompt outputting scores from 0.0-1.0 and a pass-fail grade was the most consistent and aligned with human judgements" [@anthropic-multi-agent-research-system]. They also started with about 20 queries that stood for real usage and wrote that human evaluation "catches what automation misses". [[lst:judge]] is that single call, with the grading code around it.

:::listing[One judge call returns a score and a grade, and the grading code checks the answer before it counts]{#judge file="verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts" region="judge"}
::note[The grading code parses the judge's text into a verdict, or throws. Nothing downstream sees an answer that is not JSON, out of range or self-contradicting.]{#parse}
:::

The rubric is a short instruction that names the scale and the pass mark. The verdict is a schema, a score from 0 to 1, a grade of pass or fail, and a reason that cannot be empty. The code then checks the one thing a schema cannot: that the grade agrees with the score. A pass below the mark of 0.7 and a fail at it are both rejected, and a score of exactly 0.7 passes. The example's judge is scripted, so it tests this grading code and not any model's judgement. It feeds the code three well-formed verdicts and six defective ones, and each defect is rejected for its own reason: text that is not JSON, a score above 1, a grade that is not pass or fail, a missing reason, a pass below the mark and a fail at it.

An answer that cannot be parsed should be unscored and never a fail, because a broken judge says nothing about the agent. The example throws and leaves the decision to its caller. Our agent guide makes the choice explicit: an unparsable verdict becomes unscored, and a judge's scores do not gate a release until it agrees with a set of human-labelled answers.

A grader can also fail the other way. The Agentic Benchmark Checklist reports in its abstract that τ-bench counts empty responses as successful [@abc-agentic-benchmark-checklist]. An agent that does nothing can then pass, which is why the suite runs a do-nothing agent over its tasks and treats any task it passes as a grader bug, except where doing nothing is the correct outcome. That countermeasure is our inference and not the paper's.
