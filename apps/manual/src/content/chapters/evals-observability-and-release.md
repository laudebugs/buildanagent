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
::svg{alt="Two columns joined by the word like. On the left, a bridge with four crossings: crossings 1 to 3 hold and crossing 4 gives way, drawn in the accent. On the right, an agent on one task with four runs: runs 1 to 3 pass and run 4 fails, drawn in the accent. A line below says one success proves little and every crossing has to hold, and another says pass^k counts a task only when all k runs pass."}
:::

Knowing that an agent got better takes four things. The first is a score that counts consistency, so that a lucky run cannot pass a task. The second is a grader you can trust, because free-form answers need a judge and a judge needs checking. The third is a record of every run, with its steps, tokens and cost, so a bad run can be read and a regression can be seen. The fourth, the release, moves the agent to real users in stages, behind a switch that can stop it, and sends each incident back into the suite as a new task.

## pass^k counts a task only when every attempt passes, and pass@k hides the failures

Run one task five times. The agent passes four times and fails once. Under pass@k, which counts a task when any of k attempts passes, that task counts as a success once you allow two or more attempts. Under pass^k, which counts it only when all k attempts pass, the same task fails at k=5. Both numbers describe the same runs, and only the second tells a customer how often the agent will fail them.

The gap widens fast. Anthropic's guide to evals works an example: an agent that passes 75% of single attempts passes three in a row about 42% of the time, since 0.75 cubed is 0.42 [@anthropic-demystifying-evals]. That arithmetic assumes the attempts are independent. An agent whose failures cluster on a few tasks has a different pass^k. Pass@3 for the same 75% agent is 98%, because it must miss three times in a row: 1 minus 0.25 cubed. [[fig:pass-k]] shows both numbers for k from 1 to 5.

:::figure[The same agent, 75% per attempt, under pass@k and pass^k: one rises toward 100% and the other falls]{#pass-k}
::svg{alt="Two columns of five horizontal bars, one row for each k from 1 to 5. On the left, pass@k, the share of tasks where any one of k attempts succeeds: 75.0, 93.8, 98.4, 99.6 and 99.9 percent, with bars that grow. On the right, pass^k, drawn in the accent, the share where all k succeed: 75.0, 56.3, 42.2, 31.6 and 23.7 percent, with bars that shrink. A line below says at 75% per attempt pass^3 is 42% and pass@3 is 98%."}
:::

The inconsistency is not hypothetical. The τ-bench paper, which simulates a customer talking to an agent with tools, reports in its abstract that agents "like gpt-4o succeed on <50% of the tasks, and are quite inconsistent (pass^8 <25% in retail)" [@tau-bench]. A mean pass rate hides that; pass^k shows it.

The agent guide in this repository turns pass^k into a release gate, with thresholds that are our own proposals. Run each task five times in a clean environment. Block the release when a regression task that used to pass all five attempts now misses one, or when a safety task fails even one attempt. Anthropic's advice for the first suite is "20-50 simple tasks drawn from real failures", balanced so that the suite does not optimize for one side only [@anthropic-demystifying-evals]. A suite that small cannot resolve small gains, so the gate blocks on a single task flipping and reads each flip as a transcript.

Every capstone in the `verify/` harnesses runs against a scripted model, and a scripted model fails in the same way on every run. Its pass^5 is 0 or 1 and says nothing about how consistent a live model is. The `check()` assertions in those capstones are shaped like evals, one assertion for one behavior, but a scripted failure is a test of the harness and not a measurement of the agent.

## An LLM judge grades against a rubric, and its grading code rejects an answer that contradicts itself

Think of :analogy[a teaching assistant grading against a rubric]{#teaching-assistant-rubric}. The assistant reads each answer, checks it against the listed criteria and writes a mark with a reason, so hundreds of papers get the same treatment. An LLM judge does the same for answers that code cannot check, such as a free-form reply. The assistant can still be wrong in the same direction every time, so a person marks a sample, and the grades gate nothing until they agree with the person's.

Anthropic's team built such a judge for a multi-agent research system. Research outputs are free-form text with rarely one correct answer, so they used an LLM judge that graded each output against a rubric of factual accuracy, citation accuracy, completeness, source quality and tool efficiency. They tried several judges and found that "a single LLM call with a single prompt outputting scores from 0.0-1.0 and a pass-fail grade was the most consistent and aligned with human judgements" [@anthropic-multi-agent-research-system]. They also started with about 20 queries that stood for real usage and wrote that human evaluation "catches what automation misses". [[lst:judge]] is that single call, with the grading code around it.

:::listing[One judge call returns a score and a grade, and the grading code checks the answer before it counts]{#judge file="verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts" region="judge"}
::note[The grading code parses the judge's text into a verdict, or throws. Nothing downstream sees an answer that is not JSON, out of range or self-contradicting.]{#parse}
:::

The rubric is a short instruction that names the scale and the pass mark. The verdict is a schema, a score from 0 to 1, a grade of pass or fail, and a reason that cannot be empty. The code then checks the one thing a schema cannot: that the grade agrees with the score. A pass below the mark of 0.7 and a fail at it are both rejected, and a score of exactly 0.7 passes. The example's judge is scripted, so it tests this grading code and not any model's judgement. It feeds the code three well-formed verdicts and six defective ones. Each defect fails for its own reason: text that is not JSON, a score above 1, a grade other than pass or fail, a missing reason, a pass below the mark, or a fail at the mark.

An answer that cannot be parsed should be unscored and never a fail, because a broken judge says nothing about the agent. The example throws and leaves the decision to its caller. Our agent guide makes the choice explicit: an unparsable verdict becomes unscored, and a judge's scores do not gate a release until it agrees with a set of human-labelled answers.

A grader can also be too lenient. The Agentic Benchmark Checklist reports in its abstract that τ-bench counts empty responses as successful [@abc-agentic-benchmark-checklist]. An agent that does nothing can then pass, which is why the suite runs a do-nothing agent over its tasks and treats any task it passes as a grader bug, except where doing nothing is the correct outcome. That countermeasure is our inference and not the paper's.

## A run's spans record what it did and cost, and the session log can be their only source

A courier's :analogy[tracking history]{#parcel-tracking} lists each stop a parcel made, with the time, so when it goes missing you can read where. A trace does that for a run. Each step is a span, spans nest under the step that started them, and the whole run becomes a tree you can read after the fact. A span also carries token counts and cost, which a parcel's page does not, and a tree nests steps inside steps where a tracking page is a flat list.

[[lst:tracing]] turns on the OpenTelemetry integration for one AI SDK run and keeps the spans in memory, so the example needs no collector. The agent looks up an order and then answers.

:::listing[One tool-calling run becomes a tree of spans, kept in memory]{#tracing file="verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts" region="tracing" replay}
::note[The integration turns the run into OpenTelemetry spans and sends them to the tracer given here.]{#integration}
::note[An in-memory exporter holds the finished spans, so the example reads the tree back and nothing leaves the process.]{#in-memory}
:::

The checks that follow read the tree. There is one agent span, the root, named for what it did, and two steps under it, `step 1` and `step 2`. Each model call is a child of a step, and the tool call is a child of the step that asked for it. Each model call carries its own token counts, 100 in and 20 out, and the agent span carries the total over both calls, 200 in and 40 out. The first model call ended asking for a tool and the second ended with an answer. From those spans you can say what the run did, where its tokens went and which call asked for the tool.

Our own SDK builds the same kinds of span without the step level. Its `otelObserver()`{checked=row-22} follows the OpenTelemetry GenAI conventions. It turns a run's events into one `invoke_agent`{checked=row-22} span, one `chat`{checked=row-22} span for each model call and one `execute_tool`{checked=row-22} span for each tool call. The model and tool spans are direct children of the run's span. It records token counts on each model call and the sums on the run's span, and it records no content unless you ask: with content off, a span has its structure, timing, tokens and status and nothing the user typed.

As of November 2026, the harness has decided one more step and has not built it. Telemetry there is a projection of the session log: each span is computed from log entries, which already hold each call's usage and cost, so the log stays the only record and a span is a view of it. [[fig:spans-from-log]] shows the planned mapping. The plan adds a span for time spent waiting for a person, because without it a tool's latency mixes human think-time with machine time. It pins the conventions to one commit, because they sit at Development status and carry no release tags. It records cost under its own attribute names, because no convention names cost.

:::figure[A run's spans projected from its session log: the log is the record, and a span is a view of it]{#spans-from-log}
::svg{alt="Two columns of four rows joined by arrows. On the left, session log entries: turn_start to turn_end, message_end plus usage, tool_result, and approval_requested to resolved. On the right, in the accent, the spans projected from them: invoke_agent, chat, execute_tool and approval wait. A line below says the log is the record and a span is a view of it."}
:::

## Four stages behind a graded kill switch carry an agent from the suite to real users

A theatre does not open a play to a full house on the first night. It runs :analogy[preview performances]{#preview-performances} first, learns what breaks and fixes it before the critics arrive. A release of an agent needs the same rehearsal, with one difference: the audience is real users as soon as the agent leaves the offline suite, so the first stage with users has to be shadow mode, where the agent proposes and nothing it proposes is applied.

Our agent guide, which sizes the stages for a support triage agent, lays out four, and the durations are our proposals. The first is the offline gate: the suite of the first section, run k times, with a release blocked on a regression, a safety failure or a cost rise of more than 15%. The second is two weeks of shadow, where the agent classifies every ticket and proposes escalations, a gate records each proposal and denies it, and the human triage decisions become the labels. The third is a canary: the agent applies its labels for one low-risk queue, and every higher-risk action still waits for a person. The fourth is general release, behind the kill switch. Each session is pinned to one bundle version, which versions the model, prompt, tools and skills together. The dashboard shows one row for each version. The regression suite runs daily against the live provider's endpoint, and every incident ends with a new regression task.

The evidence for this sequence is thin, and the guide says so. Anthropic describes "rainbow deployments to avoid disrupting running agents, by gradually shifting traffic from old to new versions while keeping both running simultaneously" [@anthropic-multi-agent-research-system]. Google's SRE Workbook defines canarying as "a partial and time-limited deployment of a change in a service and its evaluation" [@sre-workbook-canarying]. The shadow stage's record-and-deny pattern has no primary source we read, so it is our inference. The two practitioner blogs the guide read agree on no thresholds, which is why the durations are ours and a first run should measure the variance they depend on.

The kill switch is :analogy[a circuit breaker with several settings]{#circuit-breaker-settings}. It can stop one tool, one tier, one tenant or everything, and the pipeline reads it on every call, so it acts in the middle of a run without a deploy. A breaker cuts the current and loses what was in flight. The switch has to stop new side effects without losing the log of those already begun, which is why a call that started before the switch is recorded and settled, as [[ch:side-effects-that-can-fail]] shows. When the switch is thrown, the agent falls back to human-only triage, and a tool that waits for approval fails safe, because a paused queue blocks nothing a customer sees.

A handoff to a person is a designed outcome and not a failure. The agent flags the requests it must not handle, and code routes them to a human workflow, so the dashboard needs a row for handoffs. A run that ends in a handoff counts as neither a pass nor a fail of the agent. And each incident returns to the suite of the first section: it becomes a task, so the next release has to pass it on every attempt.

## Exercises

1. **Grade five answers and compute pass^5 by hand.** In `verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts`, call `grade`{checked=row-43} five times on the same question, with five scripted verdicts: four passes and one fail. Before you run it, say whether the task counts under pass@5 and under pass^5, and what each number would be for a suite of one task. Then add the calls, run `pnpm test` in `verify/vercel-ai-sdk`, and check your prediction. What would change if the fifth verdict were malformed instead of a fail?
2. **Predict the spans of a longer run.** In the same file's `tracing`{checked=row-20} region, script a second tool call in a second step, before the answer, so the run makes three model calls. Predict how many spans the run produces and which of them are children of which. If each model call reports 100 input and 20 output tokens, what do the agent span's token totals become? Run it and compare.
3. **Walk a triage agent through the four stages.** For a support agent that proposes a priority and can escalate a ticket, write what the shadow stage records, which queue you would pick for the canary and why, and what each level of the kill switch would stop. Which incident would you turn into a regression task first?
