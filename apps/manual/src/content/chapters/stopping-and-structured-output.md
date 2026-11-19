---
title: "Stopping: caps, stop conditions and structured output"
summary: An agent stops when the model answers, when a condition you wrote holds, or when a cap runs out, and each SDK counts and reports that end in its own way. A schema then turns the answer into a typed object, which fixes its shape but never its truth.
opening: question
sources: [ai-sdk-loop-control, langgraph-graph-api, claude-agent-sdk-agent-loop, openai-agents-running-agents]
glossary: [agent-loop, stop-condition, tool]
switchTo: [B11, B14]
---

How many times may an agent call its model before something stops it? Put that question to the eight SDKs this book verifies and, as of November 2026, the answers run from one to five hundred. The Vercel AI SDK's `generateText` makes one model call unless you ask for more, and its `ToolLoopAgent` makes up to twenty. The OpenAI Agents SDK allows ten turns and Cloudflare's Think agent ten steps. LangChain allows twenty-five steps of a graph, which came to thirteen model calls when we counted, and Google's ADK allows five hundred. Pi, the Claude Agent SDK and the GitHub Copilot SDK set no cap at all, so a model that keeps asking for tools keeps getting them.

The spread matters because a cap may be what ended your run, and the SDK may not tell you. An agent loop ends in one of three ways: the model answers without asking for a tool, a stop condition you wrote holds, or a cap runs out. The model decides the first, you decide the second, and the SDK's authors decide the third unless you override them. Once the loop has ended, your program usually wants more than prose: an object with known fields that it can store, route or show. This chapter answers three questions in that order: when does an agent stop, who decides, and how does your program get a typed answer out of it? By the end you can set a cap in the unit your SDK counts, read why a run ended before you trust its answer, and check an answer against a schema without mistaking a well-formed answer for a true one.

## A cap ends the run wherever it is, and each SDK counts it in its own unit

Buy :analogy[a bus ticket good for three stops]{#bus-ticket}, and the driver puts you off after the third stop, whether or not it is the one you wanted. The ticket knows nothing about your destination. It counts stops, and when the count runs out, the ride is over. A step cap is just as blind: it ends the loop after a set number of steps, whatever the model was about to do next.

In the AI SDK, the cap is a stop condition passed as `stopWhen`. The SDK checks it after each step whose model call asked for tools; the docs say `stopWhen` "controls when to stop execution when there are tool results in the last step" [@ai-sdk-loop-control]. A step is one model call and the tools it ran, and `isStepCount(3)` holds once the run has three steps. So the loop ends after the third model call even when that call asked for another tool, and the tool it ran gets no model call to read its result. [[lst:cap-ai]] and its two neighbours each cap a loop whose model never stops asking for a tool; switch tabs to compare them.

::::tabs
::listing[Vercel AI SDK]{#cap-ai file="verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts" region="step-cap"}
:::listing[LangChain]{#cap-langchain file="verify/langchain/examples/06-recursion-limit.ts" region="attempt"}
::note[`config` is the run's second argument, and `recursionLimit` sits at its top level. Call `attempt()` without it, and LangGraph uses its default of 25.]{#limit}
::note[At the limit LangGraph throws `GraphRecursionError`. `attempt` catches it and returns it with the number of model calls the run made.]{#thrown}
:::
:::listing[Claude Agent SDK]{#cap-claude file="verify/claude-agent-sdk/examples/04-max-turns.ts" region="max-turns"}
::note[The task needs two turns: one to call the knowledge-base search, and one to answer with text.]{#task}
::note[`maxTurns: 1` leaves no turn for the answer, so the run ends in `"error_max_turns"` instead of a result.]{#max-turns}
:::
::::

The three listings cap the same kind of runaway loop, but their numbers count different things:

- **An AI SDK step** is one model call and the tools it ran. In the recorded run of [[lst:cap-ai]], `isStepCount(3)` let exactly three requests reach the model.
- **A Claude Agent SDK turn** is "one pass through the loop", and the final text-only answer counts as a turn of its own, so the docs ask you to count "each turn with tool calls, plus one for the final text-only response" [@claude-agent-sdk-agent-loop].
- **A LangGraph super-step** is one round in which the graph runs its active nodes. LangChain's agent runs the model and the tools as separate nodes, so one model call and its tool round take two super-steps. The default of 25 allowed 13 model calls in [[lst:cap-langchain]], and a limit of 5 allowed 3 [@langgraph-graph-api].
- **An OpenAI Agents SDK turn** is one model call, and ADK counts model calls directly.

A bus company at least counts every stop the same way. SDKs do not, so the same number means different things. A cap of 25 allows twenty-five model calls in OpenAI's unit but thirteen in LangChain's, and in Claude's it allows twenty-four turns with tool calls and the answer. [[tbl:default-caps]] sets the defaults side by side, with what each SDK does when its cap fires.

:::table[Each SDK's default cap, the unit it counts, and what happens when it fires, as of November 2026]{#default-caps}
| SDK and entry point | Option | Default | Counts | At the cap |
| --- | --- | --- | --- | --- |
| AI SDK `generateText` | `stopWhen` | `isStepCount(1)` | Steps | Returns normally |
| AI SDK `ToolLoopAgent` | `stopWhen` | `isStepCount(20)` | Steps | Returns normally and logs a warning |
| OpenAI Agents SDK `run()`{checked=row-18} | `maxTurns` | 10 | Turns | Throws `MaxTurnsExceededError`{checked=row-18} |
| Cloudflare Think | `maxSteps`{checked=row-19} | 10 | AI SDK steps | Ends the turn, as the AI SDK does |
| LangChain `createAgent` | `recursionLimit` | 25 | Graph super-steps | Throws `GraphRecursionError` |
| Google ADK `Runner`{checked=row-20} | `maxLlmCalls`{checked=row-20} | 500 | Model calls | Throws `LlmCallsLimitExceededError`{checked=row-20} |
| Claude Agent SDK `query()` | `maxTurns` | No limit | Turns | Yields an `"error_max_turns"` result, then throws |
| Pi | None | No limit | | |
| GitHub Copilot SDK | None | No limit | | |
:::

[[fig:default-caps]] puts the same defaults on one scale, in model calls, the unit a bill counts. The scale is logarithmic, so each mark is ten times the last, because the defaults span more than two orders of magnitude.

:::figure[The SDKs' default caps on one scale, from one model call to five hundred]{#default-caps}
::svg{alt="A horizontal logarithmic scale of model calls, marked 1, 10, 100 and 500. Six default caps sit on it: the AI SDK's generateText at 1, the OpenAI Agents SDK's run and Cloudflare Think at 10, LangChain's createAgent at 13, the AI SDK's ToolLoopAgent at 20, and Google ADK at 500. A box below the scale says that Pi, the Claude Agent SDK and the GitHub Copilot SDK set no default cap."}
:::

Two rows of the table deserve a second look. The Copilot SDK's `sendAndWait`{checked=row-23} gives up waiting after 60 seconds by default, but its type declarations say the timeout "does not abort in-flight agent work", so it is no cap on the loop. And the AI SDK's own docs say what a default is for: its twenty steps are "a safety measure to prevent runaway loops that could result in excessive API calls and costs" [@ai-sdk-loop-control]. A default sized for every task fits none in particular.

We recommend that every agent set its own cap, in model calls, from the longest run its task legitimately needs. Count the steps of the worst honest case, then add a margin for a retry or two. Chapter 1's order-status request needs a lookup, a customs lookup and an answer, so three model calls, and a cap of five or six leaves room for one failed call each. No source we found measures how often real agents hit a default cap, so that margin is our judgement. Spend can be capped too: the Claude Agent SDK's `maxBudgetUsd`{checked=row-25} stops a run once its estimated cost passes a limit, and the docs warn that it checks after each response, so "spend can therefore pass the cap by up to the cost of that one response" [@claude-agent-sdk-agent-loop].
