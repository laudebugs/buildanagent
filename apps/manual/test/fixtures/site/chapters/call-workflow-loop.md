---
title: A fixture chapter for the site's build test
summary: Stands in for Chapter 1, so the build test can check a real chapter page.
opening: scenario
sources: [anthropic-building-effective-agents]
glossary: [agent-loop]
switchTo: []
---

An agent loop calls a model and runs its tools until a stop condition holds [@anthropic-building-effective-agents]. [[fig:who-decides]] compares it with a call and a workflow, and [[ch:tools]] comes later.

:::figure[A call, a workflow and a loop differ in who decides the next step]{#who-decides}
::svg{alt="Three columns of boxes joined by arrows. A call runs your code, then the model, then an answer. A workflow runs two model calls in an order your code fixed: a writer model, then a reviewer model, then an answer. A loop sends the model's request to a tool and the result back to the model, which ends with an answer when it is done. Under each column, a note says who decides the next step: your code, your code, and the model."}
:::

Picture a kitchen: :analogy[a ticket rail]{#kitchen-ticket-rail} holds the orders, as [[fig:ticket-rail]] draws it.

:::figure[A kitchen ticket rail: the cook works one ticket at a time]{#ticket-rail analogy="kitchen-ticket-rail"}
::svg{alt="Three order tickets hang from a rail. The cook's ticket, on the left, sends an arrow down to the pantry and gets one back; a dashed arrow leads from it to the pass, where finished dishes go."}
:::

The loop keeps count of its steps the way :analogy[a tally counter]{#tally-counter} does, as [[fig:tally-counter]] shows, and [[fig:loop-bench]] lights each station of the loop in turn.

:::figure[A tally counter: one click for every step the loop takes]{#tally-counter analogy="tally-counter"}
::viewer{alt="A hand tally counter on a small bench. Its window reads 0003, and its plunger, lit in the accent colour, rises from the top of the housing beside a reset knob."}
:::

:::figure[The agent loop's bench: context, model and tool, each with a lamp]{#loop-bench}
::viewer{alt="An isometric bench with three stations: a stack of three context pages, a round model with a cap, and a tool block. Each station has a small lamp; the lamp on the context stack is lit, and the card's readout says step 1 of 3, context."}
:::

[[lst:one-call]] makes one call with `generateText`, and `result.finishReason` says why the model stopped; `streamText` streams the answer instead.

::listing[One model call]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call" replay}

The same loop in two SDKs, where `stopWhen` and `Agent` set who decides:

:::tabs
::listing[AI SDK]{#loop-ai-sdk file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="loop"}
::listing[OpenAI Agents SDK]{#loop-openai file="verify/openai-agents-sdk/examples/02-function-tool.ts" region="run"}
:::

## How the loop stops

| Stop | When |
| --- | --- |
| Answer | The model replies without a tool call |
| Cap | The loop reaches its step limit |

:::box[Where each step goes]{#where-steps-go}
Each step the loop takes is one model call, and the cap counts them.
:::

## Exercises

1. Count the loop's steps.
