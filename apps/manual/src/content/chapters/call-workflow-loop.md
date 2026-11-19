---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: Three support requests need three shapes of program, one model call, a fixed workflow and an agent loop, and one question picks between them. Who decides the next step, your code or the model?
opening: scenario
sources: [anthropic-building-effective-agents, ai-sdk-generate-text, adk-sequential-agents, anthropic-how-tool-use-works]
glossary: [agent, workflow, agent-loop, stop-condition]
switchTo: [B11]
---

It is Monday, and the support lead has sent you three requests before your coffee has cooled. First, put a one-line summary on every new ticket, so the queue reads at a glance. Second, draft a reply to each ticket and have a second pass check its tone before a person presses send. The third request is the one she underlined: customers keep asking "where is my order?", and the answer can take one lookup or five, because an order may ship as three parcels and one of them may be held at customs.

You have called a model API before, so the tempting plan is one agent that handles all three. Hold that plan for a few pages. The three requests need three different programs, and one question tells them apart: who decides the next step, your code or the model? In this chapter you make one model call, then a fixed workflow of calls, then a loop in which the model chooses its own next step, and you run every one of them on your laptop without an API key. By the end you can match any task to the least autonomy that does it, and say why.

## Start with one model call, and stop there if it does the job

The summary request needs exactly one model call. Your code sends the ticket and an instruction, the model sends back a line of text, and your code stores it. Nothing in the task waits on a result the model has not seen, so no second step exists for anyone to decide. Anthropic's advice for building with models starts at this point: find "the simplest solution possible", and add complexity only when the task needs it [@anthropic-building-effective-agents]. For many applications, the same post says, "optimizing single LLM calls with retrieval and in-context examples is usually enough". Retrieval can be as plain as your code looking up the customer's plan and pasting it into the prompt. The program still makes one call.

[[lst:one-call]] makes that call with the Vercel AI SDK's `generateText`. Read it as a request and a reply.

:::listing[One model call: your code sends one request and reads one answer]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call" replay}
::note[`scripted` builds a mock model that plays back the answer written here, so the call needs no key and sends nothing over the network. The last section of this chapter explains how.]{#mock}
::note[One request: `instructions` reach the model as the system message and `prompt` as the user's message.]{#request}
::note[`result.finishReason` is `"stop"`: the model ended its answer on its own instead of asking for anything.]{#finish}
:::

The answer comes back as `result.text`, and `result.steps` holds one step, because one request went out and one answer came back [@ai-sdk-generate-text]. Step through the replay beside the listing and you see the whole exchange. A system message and a user message go out together, the text "Hello from the mock." comes back, and the example's checks pass one by one.

Who decided anything in that program? Your code did, before it ran: it chose the instruction, the prompt and what to do with the answer. The model wrote words and nothing else. In our view that limit is also the call's strength, since a program with one step has one place to fail, one bill to read and one output to test. Its weakness shows as soon as the work has a second step. When the reply must be drafted and then reviewed, or the answer needs a fact that only a lookup can supply, one call has nowhere to put the extra step.

## When you know the steps in advance, write them down as a workflow

The second request has two steps, and you know both before the first ticket arrives: draft the reply, then review its tone. Picture :analogy[an assembly line]{#assembly-line} with two stations bolted to the floor. Every car passes the first station and then the second, in the same order, and nobody on the line decides where a car goes next. The people who built the line decided that, long before this car arrived.

A workflow is that line in code. Anthropic defines workflows as "systems where LLMs and tools are orchestrated through predefined code paths" [@anthropic-building-effective-agents]. The same post names five workflow patterns: prompt chaining, routing, parallelization, orchestrator-workers and evaluator-optimizer. Draft-then-review is the first pattern on that list, a prompt chain, in which "each LLM call processes the output of the previous one". Anthropic recommends a chain when the task "can be easily and cleanly decomposed into fixed subtasks". In a chain your code makes the first model call, takes its output and hands it to the second, so the order of the steps lives in your program, never in a model's answer.

:::listing[A fixed workflow: a writer, then a reviewer, in an order the code sets]{#workflow file="verify/google-adk/examples/02-workflow-agents.ts" region="sequential" replay}
::note[The writer's answer goes into session state under the key `"draft"`, because its `outputKey` says so.]{#writer}
::note[The reviewer's instruction reads that state back: ADK replaces `{draft}` with the writer's text before the reviewer's model call.]{#reviewer}
::note[`SequentialAgent` runs its `subAgents` in the order of this list, every time.]{#order}
:::

[[lst:workflow]] builds that chain with Google's Agent Development Kit (ADK). Each station is an `LlmAgent` with its own model, and a `SequentialAgent` bolts them together. ADK's documentation says a sequential agent "executes its sub-agents in the order they are specified in a list", and that its execution "is not controlled by an AI model" [@adk-sequential-agents]. The replay shows what that means on the wire. Two model calls go out, one per station. The writer's call carries the instruction "Write." and comes back with a draft; the reviewer's call carries "Review this: DRAFT-TEXT", the writer's output pasted into its instruction, and comes back with "LGTM". ADK also passes the writer's reply along in the reviewer's messages, as context. The writer's model, by contrast, never learns that a reviewer exists.

The analogy breaks at the stations. A station on a real line bends the same bracket every time, but each station here is a model call, and a model call can hand on something unexpected: a reviewer that answers "LGTM" to a rude draft, or a writer whose draft is empty. The line still runs in order, yet nothing inspects the part unless your code does. Anthropic's answer is to add "programmatic checks" between the steps of a chain, a gate in your code that stops a bad draft before it reaches the next station [@anthropic-building-effective-agents].

One version detail matters if you write ADK code yourself. As of November 2026, ADK 2.5.0 marks `SequentialAgent` deprecated in favour of its graph-based `Workflow`, and constructing one logs a warning that says so [@adk-sequential-agents]. The listing still runs, and the shape it teaches carries over unchanged: steps that your code wires together before the run starts.

Who decides the next step in a workflow? Your code still does, only now it decides several steps instead of one, and it decides them all before the first ticket arrives. That fixed path is the workflow's strength and also its limit, which the third request exposes. Whether the order-status answer needs one lookup or five depends on what the first lookup returns, and no line laid out in advance knows that.

## The loop: a model calls tools until a stop condition holds

The third request breaks every fixed path you could draw. A customer asks where order 4417 is. One lookup may show a single parcel, delivered yesterday, and the job is done. The same lookup may instead show three parcels, one of them held at customs, and now the next step is a customs lookup that no one could have scheduled before the first result came back. When the next step depends on what the last step returned, something has to read that result and choose. In an agent loop, the model does the choosing. Anthropic describes agents as systems in which models "dynamically direct their own processes and tool usage", and recommends them for "open-ended problems where it's difficult or impossible to predict the required number of steps, and where you can't hardcode a fixed path" [@anthropic-building-effective-agents].

Picture :analogy[a kitchen ticket rail]{#kitchen-ticket-rail} on a busy evening. The cook pulls one ticket, table 7's pasta, and works it. Partway through, the cook calls to the pantry for basil, looks at what comes back, and decides whether to call for anything else. Nobody gives the cook a list of pantry trips in advance, and the ticket is finished when the dish goes out to the pass, as [[fig:ticket-rail]] shows.

:::figure[A kitchen ticket rail: the cook works one ticket, calling for ingredients, until the dish is done]{#ticket-rail analogy="kitchen-ticket-rail"}
::svg{alt="Three order tickets hang from a rail. The cook's ticket, table 7, on the left, sends an arrow down to the pantry and gets one back; a dashed arrow leads from it to the pass, where the finished dish goes. Two more tickets, table 9 and table 4, wait on the rail."}
:::

The mechanism under the analogy is a short, strict exchange. A model never runs anything itself: it asks for a tool by name, with arguments, and for the tools in this chapter your code runs the tool and sends the result back [@anthropic-how-tool-use-works]. Anthropic's tool-use documentation spells the cycle out in five steps, and every SDK in this book runs the same cycle under its own names:

1. Your code sends the context: the messages so far and the list of tools the model may call.
2. The model answers with one or more tool calls instead of a final answer.
3. Your code runs each tool and wraps each output as a tool result, which Anthropic's API calls a `tool_result`{checked=row-28} block.
4. Your code appends the model's tool call and the results to the context and sends the whole context back.
5. The cycle repeats while the model keeps asking for tools. It ends when the model stops asking, which normally means it has answered with text.

That cycle is the agent loop. [[fig:loop-bench]] lays it out as a bench you can step through, one lit part per step, with the labels the steps use: the context, the model call, the tool, the `tool_result`{checked=row-28} it produces, the append that adds it to the context, and the final answer.

:::figure[The agent loop's bench: the context goes to a model call, the tool's result is appended, and the loop runs until the model answers]{#loop-bench}
::viewer{alt="An isometric bench. At the back stands a rack of upright message cards labelled context, with one more card in the rack's last slot labelled append. Beside it sits a round unit labelled model call, then a block labelled tool. On the front row, two trays each hold one card: one labelled answer, in front of the model call, and one labelled tool_result, in front of the tool. The lamp on the context rack is lit, and the readout says 1 of 6, context to model call. Stepping lights, in turn, the model call, the tool, the tool_result card, the appended card, and the answer card."}
:::

Here the analogy breaks, and the break teaches the most important fact in this chapter. A cook remembers yesterday's orders and what the pantry said a minute ago. A model remembers nothing between calls: each model call sees only what that request carries. The append in step 4 is therefore the loop's whole memory. Anthropic's documentation has your code send "the original messages, the assistant's response, and a user message with the `tool_result`{checked=row-28} blocks" on each turn [@anthropic-how-tool-use-works]. A result your code forgets to append is a result the model never saw.

[[lst:weather-tool]] gives the loop something to call. It is a weather tool in the Vercel AI SDK: a description and an input schema, which the model sees, and an `execute` function, which runs in your process and which the model never sees.

::listing[A tool: a description and a schema for the model, and a function for your code]{#weather-tool file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="tool"}

:::listing[The loop runs until the model answers with text]{#tool-loop file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="loop" replay}
::note[The mock plays two turns: first a call to `weather` for Lisbon, then the text "It is 21C in Lisbon."]{#script}
::note[The tools the model may call. `generateText` runs them for you and appends their results.]{#tools}
::note[The stop condition: at most five steps. Without it, the loop would stop after the first step.]{#cap}
:::

Step through the replay of [[lst:tool-loop]] and you can watch the five steps happen. The first request carries the user's question and the tool list. The model answers with a tool call, `weather` with the city Lisbon, and finishes with `"tool-calls"` instead of `"stop"`. `generateText` runs the tool, whose schema fills in the default unit, and the second request carries the model's call and the `tool_result`{checked=row-28}: Lisbon, 21 degrees, Celsius. The model then answers in text, finishes with `"stop"`, and the loop ends after two model calls.

A loop needs a way to end that does not depend on the model alone, and the AI SDK makes that point the hard way. `stopWhen` sets the stop condition, and `isStepCount(5)` stops the loop after five steps even if the model keeps asking for tools [@ai-sdk-generate-text]. Leave `stopWhen` out, and `generateText` uses its default, `isStepCount(1)`. The same example shows what that default does: the tool still runs in the first step, but no second model call follows, so the model never reads the weather and the final text is empty. We recommend that every loop state its own cap rather than trust a default, because the defaults differ from one SDK to the next, as [[ch:stopping-and-structured-output]] shows. With a cap in place the loop is sure to end: if the model never stops asking for tools, the cap stops it.

## Exercises

1. Exercises follow once the chapter's sections are written.
