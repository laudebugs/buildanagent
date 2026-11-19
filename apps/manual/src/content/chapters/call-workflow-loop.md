---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: Three support requests need three shapes of program, one model call, a fixed workflow and an agent loop, and one question picks between them. Who decides the next step, your code or the model?
opening: scenario
sources: [anthropic-building-effective-agents, ai-sdk-generate-text, adk-sequential-agents, anthropic-how-tool-use-works, pi-how-pi-works, openai-practical-guide-to-building-agents, ai-sdk-testing]
glossary: [agent, workflow, agent-loop, stop-condition, harness, mock-model]
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

## A harness runs the same loop behind one method call

You will not always drive the loop step by step yourself. A harness is the program around a model that runs the loop for you, calls the tools and keeps the session. Pi is one. Its documentation describes the loop in its own words: Pi builds a model request from the system prompt, the conversation so far and the available tools, records the model's response, runs each tool call and records the results. "If tool results or queued messages require another model request, Pi starts another turn. Otherwise, the run ends." [@pi-how-pi-works] That is the five-step cycle again, behind a single method.

:::listing[A harness: one prompt runs the whole loop]{#pi-hello file="verify/pi/examples/01-hello-session.ts" region="hello" replay}
::note[`fauxSession` builds a Pi session on pi-ai's faux provider, scripted to answer "Hello from Pi."]{#faux}
::note[`session.prompt()` runs the loop and resolves once the run has finished.]{#prompt}
::note[The session starts with four tools active: `read`, `bash`, `edit` and `write`.]{#tools}
:::

In [[lst:pi-hello]] the scripted model answers with text at once, so the loop ends after one model request, and the example's checks confirm it. The events the session emits arrive in order, `message_update` and `message_end` while the answer streams, then `agent_settled` once Pi has nothing left to do. The replay shows the single request going out with Pi's system prompt and the user's "Say hello.", and the answer coming back.

The last note deserves a second look. As of November 2026, a Pi session made this way starts with four tools active, and two of them, `bash` and `write`, can run commands and change files on the machine that runs the agent. The mock in this listing never calls them. A real model could, which is why handing the model the next step also hands it whatever the tools can reach, a question [[ch:approvals-guardrails-and-injection]] and [[ch:permissions-sandboxes-and-credentials]] take up. Who decides the next step in Pi? The model does, exactly as in [[lst:tool-loop]]; the harness only runs the steps the model chooses.

## Choose the shape by asking who decides the next step

Go back to Monday's three requests. Each now has a shape, and [[fig:who-decides]] puts the three shapes side by side with the one difference that matters. In a call and in a workflow, your code laid out every path before the run began. In a loop, the model chooses each next step after reading the last result.

:::figure[A call, a workflow and a loop differ in who decides the next step]{#who-decides}
::svg{alt="Three columns of boxes joined by arrows. A call runs your code, then the model, then an answer. A workflow runs three fixed steps in order: a model, a tool, a model. A loop sends the model's request to a tool and the result back to the model, which ends with an answer when it is done. Under each column, a note says who decides the next step: your code, your code, and the model."}
:::

:::table[Three shapes, and what each costs you in control]{#three-shapes}
| Shape | Who decides the next step | Model calls per run | Use it when |
| --- | --- | --- | --- |
| One call | Your code, before the run | One | One request carries everything the model needs |
| Workflow, such as a chain | Your code, before the run | A fixed number you can count in advance | You know the steps before the input arrives |
| Agent loop | The model, after each result | Unknown until the run ends, so cap it | The next step depends on what the last step returned |
:::

The summary request is a call, the draft-and-review request is a workflow, and the order-status request is a loop. To sort a new task, we ask four questions in order and let the first "yes" set the shape. First, does one well-prompted call, with retrieval if needed, do the job? Ship the call. Second, do you know the steps in advance? Write a workflow. Third, does the number of steps depend on what each tool returns? Use one loop, with a cap you chose. Only the fourth question reaches past this chapter: is the work broad, parallel and too large for one context? Splitting it across several agents is a question for [[ch:choosing-the-shape]].

Each step up the list buys flexibility with control, and the sources say so plainly. Anthropic notes that agentic systems "often trade latency and cost for better task performance", and that "the autonomous nature of agents means higher costs, and the potential for compounding errors" [@anthropic-building-effective-agents]. OpenAI's guide to building agents draws the same line from the other side. Agents earn their place in "workflows where traditional deterministic and rule-based approaches fall short", and where they do not, "a deterministic solution may suffice" [@openai-practical-guide-to-building-agents]. A loop that answers one order-status question in two model calls may take six on a harder order, and a wrong turn in its third step carries into its fourth.

The shapes also combine, and we recommend combining them. A real order-status feature need not be a loop from end to end. Your code can check who is asking and load their orders before any model call, run one capped loop for the part where the next lookup depends on the last, and send the reply itself once the loop ends. Everything that must happen the same way every time stays in code, and the model decides only the steps that no one could write down in advance. That split is the least autonomy that works, and it is the habit this book builds on from here.

## How these examples run without a key

Every listing in this book runs against a mock model, and so can you, with no API key and no bill. A pilot practises an engine fire in :analogy[a flight simulator]{#flight-simulator}, where the fire breaks out exactly when the instructor scripted it and nobody gets hurt. A mock model plays the same part for code: it stands in for the provider and plays back answers written in advance. The AI SDK's testing guide names the problem it solves, "Testing language models can be challenging, because they are non-deterministic and calling them is slow and expensive", and the SDK ships mock models for it, `MockLanguageModelV4` among them [@ai-sdk-testing].

::listing[The scripted mock behind this chapter's AI SDK listings]{#scripted-mock file="verify/vercel-ai-sdk/examples/lib/check.ts" region="scripted"}

[[lst:scripted-mock]] wraps that mock model in a helper of our own. `scripted` takes a list of turns, each either text or a set of tool calls, plays them back in order, and records every request the code sends in `requests`. When the loop asks for a turn the script lacks, the helper throws, so an example fails if its loop makes more model calls than you planned. The other harnesses follow the same plan with their own parts: the ADK listing's `ScriptedLlm`{checked=row-68} subclasses ADK's model class, because ADK 2.5.0 ships no test model, and Pi's listing runs on pi-ai's own faux provider. Each of these three harnesses also records every example's run, and CI fails when a recording no longer matches its code, so the replays in this chapter show what the code really does today.

The analogy breaks where a simulator is at its best. A flight simulator models the aircraft and answers whatever the pilot does, but a scripted mock can give only the answers someone wrote for it in advance. A passing example therefore proves that your code handles the answers you scripted; it cannot prove that a real model will give them. [[ch:testing-offline-and-a-first-agent]] covers what such tests can and cannot show.

## Exercises

1. **Turn the workflow into a loop.** In `verify/google-adk/examples/02-workflow-agents.ts`, copy the block that [[lst:workflow]] lists. Replace `SequentialAgent` with a `LoopAgent` that holds the same writer and reviewer and stops after `maxIterations: 3`{checked=row-74}. Give the reviewer ADK's built-in `EXIT_LOOP` tool, and script its model to call `exit_loop` when it approves a draft and to ask for a new draft otherwise; the loop test further down the same file shows how. Before you run anything, predict how many model calls the loop makes if the reviewer approves the first draft, the second draft, or none, and write each prediction as a `check()`, as the file's own tests do. Run `pnpm test` in `verify/google-adk`, fix your reasoning wherever a check fails, and compare the counts with the workflow's two. Which of the two programs knows its number of calls before it runs?
2. **Give the loop a second lookup.** In `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, script the model to call `weather` twice, for Lisbon and then for Porto, before it answers. Predict how many model calls the loop makes under `isStepCount(5)`, and what `result.text` holds under `isStepCount(2)`. Write both predictions as checks, run `pnpm test` in `verify/vercel-ai-sdk`, and explain any check that fails.
3. **Sort three tasks.** For each task, name its shape and who decides the next step: translating every product description into French; a nightly job that collects yesterday's orders, summarises them and emails the summary to the team; and answering a developer who asks why a test fails in a repository the agent has never seen. For the third task, list the steps you would still keep in code.
