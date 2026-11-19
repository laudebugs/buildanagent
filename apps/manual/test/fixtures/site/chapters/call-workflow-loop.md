---
title: A fixture chapter for the site's build test
summary: Stands in for Chapter 1, so the build test can check a real chapter page.
opening: scenario
sources: [anthropic-building-effective-agents]
glossary: [agent-loop]
switchTo: []
---

An agent loop calls a model and runs its tools until a stop condition holds [@anthropic-building-effective-agents]. [[fig:fixture-loop]] draws it, and [[ch:tools]] comes later.

:::figure[The loop, as a placeholder]{#fixture-loop}
A placeholder for the figure.
:::

[[lst:one-call]] makes one call.

::listing[One model call]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call"}

## How the loop stops

| Stop | When |
| --- | --- |
| Answer | The model replies without a tool call |
| Cap | The loop reaches its step limit |

## Exercises

1. Count the loop's steps.
