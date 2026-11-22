---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: Three support requests need three shapes of program, one model call, a fixed workflow and an agent loop, and one question picks between them. Who decides the next step, your code or the model?
opening: scenario
sources: [anthropic-building-effective-agents, ai-sdk-generate-text, adk-sequential-agents, anthropic-how-tool-use-works, pi-how-pi-works, openai-practical-guide-to-building-agents, ai-sdk-testing, buildanagent-sdk-readme]
glossary: [agent, workflow, agent-loop, stop-condition, harness, mock-model]
switchTo: [B11]
---

It is Monday, and the support lead has sent you three requests before your coffee has cooled. First, put a one-line summary on every new ticket, so the queue reads at a glance. Second, draft a reply to each ticket and have a second pass check its tone before a person presses send. The third request is the one she underlined: answer customers who ask "where is my order?" That answer can take one lookup or five, because an order may ship as three parcels and one of them may be held at customs.

You have called a model API before, so the tempting plan is one agent that handles all three. Hold that plan for a few pages. The three requests need three different programs, and one question tells them apart: who decides the next step, your code or the model? In this chapter you make one model call, then a fixed workflow of calls, then a loop in which the model chooses its own next step, and you run every one of them on your laptop without an API key. By the end you can match any task to the least autonomy that does it, and say why.

## Start with one model call, and stop there if it does the job

The summary request needs exactly one model call. Your code sends the ticket and an instruction, the model sends back a line of text, and your code stores it. Nothing in the task waits on a result the model has not seen, so no second step exists for anyone to decide. Anthropic's advice for building with models starts at this point: find "the simplest solution possible", and add complexity only when the task needs it [@anthropic-building-effective-agents]. For many applications, the same post says, "optimizing single LLM calls with retrieval and in-context examples is usually enough". Retrieval can be as plain as your code looking up the customer's plan and pasting it into the prompt. The program still makes one call.

Five of this chapter's six listings come in two tabs. The first tab runs on our own packages, `@buildanagent/gateway` and `@buildanagent/sdk`, and the second runs the same step on an established SDK, so you can see what changes between SDKs and what stays. The sixth listing, Pi's harness, keeps a single tab until our own harness can keep a session. As of November 2026 our packages are `0.1.0` alpha releases, so their names may still change. [[lst:one-call-ours]] and [[lst:one-call]] make the summary's one call, the first through our gateway and the second with the Vercel AI SDK's `generateText`. Read each as a request and a reply: your code sends one request and reads one answer.

::::tabs
:::listing[Our SDK]{#one-call-ours file="packages/sdk/examples/01-one-call.ts" region="call" replay}
::note[`scripted` puts our SDK's test model, `ScriptedModel`, behind the gateway's `createModel()`. The model plays back the answer written here, so the call needs no key and sends nothing over the network. The box [How these examples run without a key](#how-these-examples-run-without-a-key), near the end of this chapter, explains how.]{#mock}
::note[One request: the `system` prompt, the `messages` so far and the `tools` the model may call, which here are none.]{#request}
::note[`answer.stopReason` is `"stop"`: the model ended its answer on its own instead of asking for anything.]{#finish}
:::
:::listing[AI SDK]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call" replay}
::note[`scripted` builds a mock model that plays back the answer written here, so the call needs no key and sends nothing over the network. The box [How these examples run without a key](#how-these-examples-run-without-a-key), near the end of this chapter, explains how.]{#mock}
::note[One request: `instructions` reach the model as the system message and `prompt` as the user's message.]{#request}
::note[`result.finishReason` is `"stop"`: the model ended its answer on its own instead of asking for anything.]{#finish}
:::
::::

The two tabs hand back the answer in different shapes. Our gateway's `complete()` returns the model's message itself, with its `content` and its `stopReason`. The AI SDK's `generateText` returns a result instead: the answer comes back as `result.text`, and `result.steps` holds one step, because one request went out and one answer came back [@ai-sdk-generate-text]. Step through either replay beside its listing and you see the whole exchange. A system message and a user message go out together, the text "Hello from the mock." comes back, and the example's checks pass one by one.

Who decided anything in that program? Your code did, before it ran: it chose the instruction, the prompt and what to do with the answer. The model wrote words and nothing else. In our view that limit is also the call's strength, since a program with one step has one place to fail, one bill to read and one output to test. Its weakness shows as soon as the work has a second step. When the reply must be drafted and then reviewed, or the answer needs a fact that only a lookup can supply, one call has nowhere to put the extra step.

## When you know the steps in advance, write them down as a workflow

The second request has two steps, and you know both before the first ticket arrives: draft the reply, then review its tone. Picture :analogy[an assembly line]{#assembly-line} with two stations bolted to the floor. Every car passes the first station and then the second, in the same order, and nobody on the line decides where a car goes next. The people who built the line decided that, long before this car arrived.

A workflow is that line in code. Anthropic defines workflows as "systems where LLMs and tools are orchestrated through predefined code paths" [@anthropic-building-effective-agents]. The same post names five workflow patterns: prompt chaining, routing, parallelization, orchestrator-workers and evaluator-optimizer. Draft-then-review is the first pattern on that list, a prompt chain, in which "each LLM call processes the output of the previous one". Anthropic recommends a chain when the task "can be easily and cleanly decomposed into fixed subtasks". In a chain your code makes the first model call, takes its output and hands it to the second, so the order of the steps lives in your program, never in a model's answer.

Both tabs below build that chain: a writer, then a reviewer, in an order the code sets.

::::tabs
:::listing[Our SDK]{#workflow-ours file="packages/sdk/examples/02-workflow.ts" region="sequential" replay}
::note[The writer's answer becomes `draft`, a plain variable in your code.]{#writer}
::note[The code pastes `draft` into the reviewer's instruction. This call runs second because its line comes second: the order of these lines is the workflow.]{#reviewer}
:::
:::listing[Google ADK]{#workflow file="verify/google-adk/examples/02-workflow-agents.ts" region="sequential" replay}
::note[The writer's answer goes into session state under the key `"draft"`, because its `outputKey` says so.]{#writer}
::note[The reviewer's instruction reads that state back: ADK replaces `{draft}` with the writer's text before the reviewer's model call.]{#reviewer}
::note[`SequentialAgent` runs its `subAgents` in the order of this list, every time.]{#order}
:::
::::

[[lst:workflow-ours]] needs no workflow class, and our SDK has none: two `complete()` calls, one after the other, are the whole workflow. Each station is a model call, and your code carries the writer's `draft` to the reviewer itself. [[lst:workflow]] builds the same chain with Google's Agent Development Kit (ADK). Each station is an `LlmAgent` with its own model, and a `SequentialAgent` bolts them together. ADK's documentation says a sequential agent "executes its sub-agents in the order they are specified in a list", and that its execution "is not controlled by an AI model" [@adk-sequential-agents]. The two replays show what that means on the wire. In each, two model calls go out, one per station. The writer's call carries the instruction "Write." and comes back with a draft; the reviewer's call carries "Review this: DRAFT-TEXT", the writer's output pasted into its instruction, and comes back with "LGTM". ADK also passes the writer's reply along in the reviewer's messages, as context, while our tab sends the reviewer only the user's request. In both tabs, the writer's model never learns that a reviewer exists.

The analogy breaks at the stations. A station on a real line bends the same bracket every time, but each station here is a model call, and a model call can hand on something unexpected: a reviewer that answers "LGTM" to a rude draft, or a writer whose draft is empty. The line still runs in order, yet nothing inspects the part unless your code does. Anthropic's answer is to add "programmatic checks" between the steps of a chain, a gate in your code that stops a bad draft before it reaches the next station [@anthropic-building-effective-agents].

One version detail matters if you write ADK code yourself. As of November 2026, ADK 2.5.0 marks `SequentialAgent` deprecated in favour of its graph-based `Workflow`, and constructing one logs a warning that says so [@adk-sequential-agents]. The listing still runs, and the shape it teaches carries over unchanged: steps that your code wires together before the run starts.

Who decides the next step in a workflow? Your code still does, only now it decides several steps instead of one, and it decides them all before the first ticket arrives. That fixed path is the workflow's strength and also its limit, which the third request exposes. Whether the order-status answer needs one lookup or five depends on what the first lookup returns, and no line laid out in advance knows that.

## The loop: a model calls tools until a stop condition holds

The third request breaks every fixed path you could draw. A customer asks where order 4417 is. One lookup may show a single parcel, delivered yesterday, and the job is done. The same lookup may instead show three parcels, one of them held at customs, and now the next step is a customs lookup that no one could have scheduled before the first result came back. When the next step depends on what the last step returned, something has to read that result and choose. In an agent loop, the model does the choosing. Anthropic describes agents as systems in which models "dynamically direct their own processes and tool usage" [@anthropic-building-effective-agents]. It recommends them for "open-ended problems where it's difficult or impossible to predict the required number of steps, and where you can't hardcode a fixed path", which describes the order-status request exactly.

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

That cycle is the agent loop. [[fig:loop-bench]] lays it out as a bench you can step through, one lit part per step, with the labels the steps use: the context, the model call, the tool, the `tool_result`{checked=row-28} it produces, the append that adds it to the context, and the final answer. Both loop replays later in this section record those six steps in the same order.

:::figure[The agent loop's bench: the context goes to a model call, the tool's result is appended, and the loop runs until the model answers]{#loop-bench}
::viewer{alt="An isometric bench. At the back stands a rack of upright message cards labelled context, with one more card in the rack's last slot labelled append. Beside it sits a round unit labelled model call, then a block labelled tool. On the front row, two trays each hold one card: one labelled answer, in front of the model call, and one labelled tool_result, in front of the tool. The lamp on the context rack is lit, and the readout says 1 of 6, context to model call. Stepping lights, in turn, the model call, the tool, the tool_result card, the appended card, and the answer card."}
:::

The kitchen stops matching the loop at memory, and that difference teaches the most important fact in this chapter. A cook remembers yesterday's orders and what the pantry said a minute ago. A model remembers nothing between calls: each model call sees only what that request carries. The append in step 4 is therefore the loop's whole memory. Anthropic's documentation has your code send "the original messages, the assistant's response, and a user message with the `tool_result`{checked=row-28} blocks" on each turn [@anthropic-how-tool-use-works]. A result your code forgets to append is a result the model never saw.

[[lst:weather-tool-ours]] and [[lst:weather-tool]] give the loop something to call: a weather tool, defined with our SDK's `defineTool()` and with the Vercel AI SDK's `tool()`. In both, a description and an input schema go to the model, and an `execute` function runs in your process, where the model never sees it. Our tool also carries its own `name`, while the AI SDK takes a tool's name from the key you pass it under, as `tools: { weather }` in [[lst:tool-loop]] does.

:::tabs
::listing[Our SDK]{#weather-tool-ours file="packages/sdk/examples/03-tool-loop.ts" region="tool"}
::listing[AI SDK]{#weather-tool file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="tool"}
:::

[[lst:tool-loop-ours]] and [[lst:tool-loop]] then run the loop with that tool until the model answers with text.

::::tabs
:::listing[Our SDK]{#tool-loop-ours file="packages/sdk/examples/03-tool-loop.ts" region="loop" replay}
::note[The script plays two answers: first a call to `weather` for Lisbon, then the text "It is 21C in Lisbon."]{#script}
::note[The tools the model may call. `run()` runs them for you and appends their results.]{#tools}
::note[The stop condition: at most five model calls. Without it, a run may make 20.]{#cap}
:::
:::listing[AI SDK]{#tool-loop file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="loop" replay}
::note[The mock plays two turns: first a call to `weather` for Lisbon, then the text "It is 21C in Lisbon."]{#script}
::note[The tools the model may call. `generateText` runs them for you and appends their results.]{#tools}
::note[The stop condition: at most five steps. Without it, the loop would stop after the first step.]{#cap}
:::
::::

Step through either replay and you can watch the five steps happen. The first request carries the user's question and the tool list; in our tab it also carries the system prompt, because `run()` takes a `system` prompt on every run. The model answers with a tool call, `weather` with the city Lisbon, and finishes with a tool-call reason instead of `"stop"`: `"tool_calls"` in our tab and `"tool-calls"` in the AI SDK's. The loop runs the tool, whose schema fills in the default unit, and the second request carries the tool result: Lisbon, 21 degrees, Celsius. The model then answers in text, finishes with `"stop"`, and the loop ends after two model calls.

A loop needs a way to end that does not depend on the model alone, and the two SDKs' defaults show why. In our SDK, `maxSteps` caps the model calls a run makes, at 20 unless you set it, and a run that reaches the cap ends with its own stop reason, `max_steps`{checked=row-125}, instead of an answer [@buildanagent-sdk-readme]. In the AI SDK, `stopWhen` sets the stop condition, and `isStepCount(5)` stops the loop after five steps even if the model keeps asking for tools [@ai-sdk-generate-text]. Leave `stopWhen` out, and `generateText` uses its default, `isStepCount(1)`. The AI SDK example shows what that default does: the tool still runs in the first step, but no second model call follows, so the model never reads the weather and the final text is empty. Our example shows the same with `maxSteps: 1`: the tool runs, and the run ends after one model call without an answer. We recommend that every loop state its own cap rather than trust a default, because the defaults differ from one SDK to the next, 20 model calls in ours and one step in the AI SDK, as [[ch:stopping-and-structured-output]] shows. With a cap in place the loop is sure to end: if the model never stops asking for tools, the cap stops it.

## A harness keeps the session and brings its own tools

`run()` and `generateText` already ran the loop behind one call, so a harness has to add something else. Look at what [[lst:tool-loop-ours]] and [[lst:tool-loop]] took from you: the instructions, the tool and its `execute` function all came from your code. Once the call returned, the run lived on only in what your code kept. A harness is the program around a model that runs the loop for you, calls the tools and keeps the session. Pi is one, and its documentation opens on the difference: Pi "coordinates model requests, tool execution, context assembly, and session storage" [@pi-how-pi-works]. Three things set Pi apart from `run()` and `generateText`, and each is a job your code would otherwise do itself, as it did in the tool loop's two tabs:

- **It assembles the context.** Pi writes the system prompt itself, "from its base instructions and discovered context files", and every request "also carries tool definitions".
- **It brings its own tools.** A Pi session starts with tools of its own, so the model can read and change files although your code defined no tool.
- **It keeps the session.** A session is "Pi's record of a conversation, including messages, tool calls and results". Pi adds each new message to that record, so a second prompt continues the conversation of the first, and Pi can keep the record in a file and continue it later.

Inside, the loop is the one you already know. Pi builds a model request from the system prompt, the conversation so far and the available tools, records the model's response, runs each tool call and records the results. "If tool results or queued messages require another model request, Pi starts another turn. Otherwise, the run ends." [@pi-how-pi-works]

:::listing[A harness: one prompt runs the whole loop]{#pi-hello file="verify/pi/examples/01-hello-session.ts" region="hello" replay}
::note[`fauxSession` builds a Pi session on pi-ai's faux provider, scripted to answer "Hello from Pi."]{#faux}
::note[`session.prompt()` runs the loop and resolves once the run has finished.]{#prompt}
::note[The session starts with four tools active: `read`, `bash`, `edit` and `write`.]{#tools}
:::

The replay of [[lst:pi-hello]] shows the first two of those jobs in its single request. The example wrote no system prompt and defined no tool. Yet next to the user's "Say hello.", the request carries a system prompt that Pi assembled from six sections, from a preamble to the working directory, and the four tools `read`, `bash`, `edit` and `write`. Compare the replays of [[lst:one-call-ours]] and [[lst:one-call]], whose requests held only the two messages your code wrote. The scripted model answers with text at once, so the loop ends after one model request, and the example's checks confirm it. Pi also reports its progress as events, in order: `message_update` and `message_end` while the answer streams, then `agent_settled` once Pi has nothing left to do.

Those four tools deserve a second look. As of November 2026 they are the tools a Pi session starts with by default, and two of them, `bash` and `write`, can run commands and change files on the machine that runs the agent. The mock in this listing never calls them. A real model could. When you hand the model the next step, you also hand it whatever its tools can reach, and [[ch:approvals-guardrails-and-injection]] and [[ch:permissions-sandboxes-and-credentials]] show how to fence that in. In Pi, as in [[lst:tool-loop-ours]] and [[lst:tool-loop]], the model decides the next step; the harness only runs the steps the model chooses.

## Choose the shape by asking who decides the next step

Go back to Monday's three requests. Each now has a shape, and [[fig:who-decides]] puts the three shapes side by side with the one difference that matters. In a call and in a workflow, your code laid out every path before the run began. In a loop, the model chooses each next step after reading the last result.

:::figure[A call, a workflow and a loop differ in who decides the next step]{#who-decides}
::svg{alt="Three columns of boxes joined by arrows. A call runs your code, then the model, then an answer. A workflow runs two model calls in an order your code fixed: a writer model, then a reviewer model, then an answer. A loop sends the model's request to a tool and the result back to the model, which ends with an answer when it is done. Under each column, a note says who decides the next step: your code, your code, and the model."}
:::

:::table[Three shapes, and what each costs you in control]{#three-shapes}
| Shape | Who decides the next step | Model calls per run | Use it when |
| --- | --- | --- | --- |
| One call | Your code, before the run | One | One request carries everything the model needs |
| Workflow, such as a chain | Your code, before the run | A fixed number you can count in advance | You know the steps before the input arrives |
| Agent loop | The model, after each result | Unknown until the run ends, so cap it | The next step depends on what the last step returned |
:::

The summary request is a call, the draft-and-review request is a workflow, and the order-status request is a loop. To sort a new task, we ask four questions in order and let the first "yes" set the shape. First, does one well-prompted call, with retrieval if needed, do the job? Ship the call. Second, do you know the steps in advance? Write a workflow. Third, does the number of steps depend on what each tool returns? Use one loop, with a cap you chose. Only the fourth question reaches past this chapter: is the work broad, parallel and too large for one context? Splitting it across several agents is a question for [[ch:choosing-the-shape]].

Each step up the list gains flexibility and gives up control. Anthropic notes that agentic systems "often trade latency and cost for better task performance", and that "the autonomous nature of agents means higher costs, and the potential for compounding errors" [@anthropic-building-effective-agents]. A loop that answers one order-status question in two model calls may take six on a harder order, and a wrong turn in its third step carries into its fourth.

OpenAI's guide to building agents asks a different question, and it uses one of this chapter's words in another sense. For OpenAI, a workflow is any "sequence of steps that must be executed to meet the user's goal", whoever decides those steps, so in its terms an agent runs workflows too. The guide's test looks at the judgement a task needs, not at whether you can count its steps. OpenAI points agents at work where rules struggle: "complex decision-making", "difficult-to-maintain rules" and "heavy reliance on unstructured data", such as a refund approval that turns on exceptions. Where a task shows none of these, "a deterministic solution may suffice" [@openai-practical-guide-to-building-agents]. In our reading the two tests overlap without matching. A refund decision can need judgement yet happen in one fixed step, which one call may handle. A task with an unknown number of lookups, by contrast, needs a loop even when each lookup is simple.

The shapes also combine, and we recommend combining them. A real order-status feature need not be a loop from end to end. Your code can check who is asking and load their orders before any model call, run one capped loop for the part where the next lookup depends on the last, and send the reply itself once the loop ends. Everything that must happen the same way every time stays in code, and the model decides only the steps that no one could write down in advance. That split is the least autonomy that works, and it is the habit this book builds on from here.

:::::box[How these examples run without a key]{#how-these-examples-run-without-a-key top}
Every listing in this book runs against a mock model, so you can run each one yourself with no API key and no bill. A pilot practises an engine fire in :analogy[a flight simulator]{#flight-simulator}, where the fire breaks out exactly when the instructor scripted it and nobody gets hurt. A mock model plays the same part for code: it stands in for the provider and plays back answers written in advance. The AI SDK's testing guide names the problem it solves, "Testing language models can be challenging, because they are non-deterministic and calling them is slow and expensive", and the SDK ships mock models for it, `MockLanguageModelV4` among them [@ai-sdk-testing]. Our SDK ships its own, `ScriptedModel`, which plays back one scripted answer per model call [@buildanagent-sdk-readme].

::::tabs
:::listing[Our SDK]{#scripted-mock-ours file="packages/sdk/examples/04-scripted-model.ts" region="scripted"}
::note[The script holds one answer, a call to `weather`, and the run will ask for a second.]{#steps}
::note[`createModel()` binds the scripted adapter to a model id, as it binds a real provider's adapter.]{#gateway}
::note[The second model call finds no scripted answer, so the run ends with the stop reason `"error"` instead of throwing.]{#strict}
::note[`calls` holds a frozen copy of each request the script answered.]{#calls}
:::
::listing[AI SDK]{#scripted-mock file="verify/vercel-ai-sdk/examples/lib/check.ts" region="scripted"}
::::

[[lst:scripted-mock-ours]] uses `ScriptedModel` on its own, and shows that it is strict. When a run asks for an answer the script lacks, the run ends with an error, and `assertComplete()` throws, so a test that calls it fails whenever its loop makes more model calls than you planned. This chapter's other examples on our SDK reach the same model through a short helper, `scripted`, that puts it behind `createModel()`.

The AI SDK's examples use a helper of the same name, and [[lst:scripted-mock]] shows it wrapping the AI SDK's mock model. That `scripted` takes a list of turns, each either text or a set of tool calls, plays them back in order, and records every request the code sends in `requests`. When the loop asks for a turn the script lacks, the helper throws, so an example fails if its loop makes more model calls than you planned. The other harnesses follow the same plan with their own parts: the ADK listing's `ScriptedLlm`{checked=row-68} subclasses ADK's model class, because ADK 2.5.0 ships no test model, and Pi's listing runs on pi-ai's own faux provider. Our package and each of these three harnesses also record every example's run, and CI fails when a recording no longer matches its code, so the replays in this chapter show what the code really does today.

Mocks part company with simulators where a simulator is at its best. A flight simulator models the aircraft and answers whatever the pilot does, but a scripted mock can give only the answers someone wrote for it in advance. A passing example therefore proves that your code handles the answers you scripted; it cannot prove that a real model will give them. [[ch:testing-offline-and-a-first-agent]] covers what such tests can and cannot show.
:::::

## Exercises

1. **Turn the workflow into a loop.** In `verify/google-adk/examples/02-workflow-agents.ts`, copy the block that [[lst:workflow]] lists. Replace `SequentialAgent` with a `LoopAgent` that holds the same writer and reviewer and stops after `maxIterations: 3`{checked=row-74}. Give the reviewer ADK's built-in `EXIT_LOOP` tool, and script its model to call `exit_loop` when it approves a draft and to ask for a new draft otherwise; the loop test further down the same file shows how. Before you run anything, predict how many model calls the loop makes if the reviewer approves the first draft, the second draft, or none, and write each prediction as a `check()`, as the file's own tests do. Run `pnpm test` in `verify/google-adk`, fix your reasoning wherever a check fails, and compare the counts with the workflow's two. Which of the two programs knows its number of calls before it runs?
2. **Give the loop a second lookup.** In `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, script the model to call `weather` twice, for Lisbon and then for Porto, before it answers. Predict how many model calls the loop makes under `isStepCount(5)`, and what `result.text` holds under `isStepCount(2)`. Write both predictions as checks, run `pnpm test` in `verify/vercel-ai-sdk`, and explain any check that fails.
3. **Sort three tasks.** For each task, name its shape and who decides the next step: translating every product description into French; a nightly job that collects yesterday's orders, summarises them and emails the summary to the team; and answering a developer who asks why a test fails in a repository the agent has never seen. For the third task, list the steps you would still keep in code.
