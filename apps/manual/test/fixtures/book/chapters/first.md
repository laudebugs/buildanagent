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

The loop keeps count of its steps the way :analogy[a tally counter]{#tally-counter} does, as [[fig:tally-counter]] shows, and [[fig:loop-bench]] lights each station of the loop in turn.

:::figure[A tally counter: one click for every step the loop takes]{#tally-counter analogy="tally-counter"}
::viewer{alt="A hand tally counter on a small bench. Its window reads 0003, and its plunger, lit in the accent colour, rises from the top of the housing beside a reset knob."}
:::

:::figure[The agent loop's bench: context, model and tool, each with a lamp]{#loop-bench}
::viewer{alt="An isometric bench with three stations: a stack of three context pages, a round model with a cap, and a tool block. Each station has a small lamp; the lamp on the context stack is lit, and the card's readout says step 1 of 3, context."}
:::

## Exercises

1. Run the loop and count its steps.
