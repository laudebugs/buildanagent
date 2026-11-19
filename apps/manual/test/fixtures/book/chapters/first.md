---
title: The first chapter
summary: A fixture chapter that uses every feature the content model checks.
opening: scenario
sources: [alpha-docs, beta-paper]
glossary: [agent-loop, mcp]
switchTo: [B11]
---

Picture a kitchen. :analogy[A ticket rail]{#kitchen-ticket-rail} holds the orders [@alpha-docs].

An agent loop calls a model until it stops [@alpha-docs; @beta-paper]. The agent loop then ends, and MCP connects it to data. Lowercase mcp is not the abbreviation.

:::figure[A kitchen ticket rail: the cook works one ticket at a time]{#ticket-rail analogy="kitchen-ticket-rail"}
::svg{alt="Three order tickets hang from a rail. The cook's ticket, on the left, sends an arrow down to the pantry and gets one back; a dashed arrow leads from it to the pass, where finished dishes go."}
:::

:::table[How the loop stops]{#stop-reasons}
| Stop | When |
| --- | --- |
| Answer | The model replies without a tool call |
:::

See [[fig:ticket-rail]], [[tbl:stop-reasons]] and [[lst:hello]] in [[ch:second]]; [[ch:third]] is not written yet. At re:Invent the colon stays text.

## Exercises

1. Run the loop and count its steps.
