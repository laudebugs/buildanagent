---
title: "Choosing the shape: buy, adopt or build, how to plan, and when subagents pay"
summary: An agent's shape is three choices made before any prompt is written. This chapter sorts the SDKs by who owns the loop, says why to start planning with ReAct, separates workflows, routing and handoffs by who decides the next step, and runs one subagent to show what it keeps out of the parent's context and what it adds to the bill.
opening: fact
sources: [anthropic-multi-agent-research-system, claude-agent-sdk-hosting, claude-agent-sdk-overview, copilot-sdk-nodejs-readme, openai-agents-running-agents, pi-how-pi-works, ai-sdk-generate-text, cloudflare-agents-chat-agents, buildanagent-sdk-readme, liu-what-does-a-harness-buy, yao-react, del-rosario-plan-then-execute, shinn-reflexion, anthropic-building-effective-agents, adk-sequential-agents, adk-graph-routes, openai-agents-handoffs, openai-agents-orchestration, openai-agents-tools, openai-agents-context, openai-agents-results]
glossary: [agent, agent-loop, harness, react, plan-and-execute, workflow, handoff, subagent, token, context-window]
switchTo: [B19b]
---

In Anthropic's own data, an agent typically uses about four times the tokens of a chat, and a system of several agents about fifteen times [@anthropic-multi-agent-research-system]. The two multiples are separate measurements. Each is the price of a shape: a loop costs the first, and dividing the work among several loops costs the second. A team that picks its shape by habit pays that price on every request.

Three choices fix an agent's shape before anyone writes a prompt: who owns the loop, how the work is planned, and how many agents share it. Each section ends on what the choice costs, and the exercises rewrite one handoff as a router and as a subagent and compare the calls.

## Who owns the loop decides between buying, adopting and building, and moving later costs a rewrite

You have a month to ship an agent that fixes failing tests in a customer's repository, and there are three ways to get its loop. :analogy[Renting a furnished flat, leasing an empty one or building a house]{#flat-lease-house} is the same choice in housing. The furnished flat is lived in this week with someone else's furniture, the empty lease lets you choose every piece, and the house gives you the foundations as well. The picture breaks at the exit. A tenant moves out with a van, but an agent's tools, hooks and prompts are written against one loop's vocabulary, so changing the loop costs a rewrite of whatever you built on top.

The precise question is who runs the loop. Buying means a vendor's program runs it and you configure it. When your code calls `query()`{checked=row-2}, the Claude Agent SDK starts a separate `claude`{checked=row-2} process, and that process owns the shell, the working directory and the session transcripts [@claude-agent-sdk-hosting]. The SDK is Claude Code as a library, with "the same tools, agent loop, and context management that power Claude Code" [@claude-agent-sdk-overview]. GitHub's Copilot SDK likewise controls the Copilot CLI over JSON-RPC [@copilot-sdk-nodejs-readme]. Adopting means a loop that runs in your own process. The OpenAI Agents SDK runs an agent with its `Runner`{checked=row-6} [@openai-agents-running-agents], Pi's TypeScript SDK creates and controls agent sessions in process [@pi-how-pi-works], and the Vercel AI SDK puts its tool loop inside `generateText`{checked=row-8} [@ai-sdk-generate-text]. LangChain.js and Google ADK also run in your process. Cloudflare Agents splits the work. The platform hosts each agent as a Durable Object, and the chat agent's loop is a call to the AI SDK's `streamText`{checked=row-9} that you write [@cloudflare-agents-chat-agents]. Building means the loop is yours to change, as the one this book builds is [@buildanagent-sdk-readme]. [[fig:three-tiers]] places the eight SDKs this book verifies, as of November 2026.

:::figure[Three tiers of loop ownership: a vendor runs the loop you buy, your process runs the one you adopt, and you change the one you build]{#three-tiers}
::svg{alt="Three columns. Buy, a vendor's program: Claude Agent SDK and Copilot SDK. Adopt, a library loop: OpenAI Agents SDK, Vercel AI SDK, LangChain.js, Google ADK, Pi and Cloudflare Agents. Build, a loop you own, drawn in the accent: the buildanagent SDK. Below the columns, a dashed line, and under it: the vendor runs it, your code runs it, you change it."}
:::

Three questions place a team in a tier: does it need to control the loop, for example its compaction or its turn scheduling; must it stay portable across model vendors; and does its agent look like a coding agent? The answers are our judgement, drawn from the vendors' documents, and [[tbl:shapes]] gives the starting point each one suggests.

:::table[Where each situation should start, our reading of the vendors' documents as of November 2026]{#shapes}
| If this describes you | Start with | Why |
| --- | --- | --- |
| A coding or filesystem agent, a small team and a fast start | Buy the Claude Agent SDK, if Claude-only models are acceptable | The loop, the tools and the context management come tuned, and you configure them [@claude-agent-sdk-overview] |
| A chat or workflow agent, or several model vendors | Adopt a library loop | It runs in your process, so your tests drive it directly and your code decides what surrounds it |
| Custom compaction, routing, cost control or model portability is your product | Build the loop, and buy sandboxes and observability | None of the vendor loops we verified gives custom compaction, full loop control and portability across vendors together |
:::

The case for buying is weaker than a vendor's score table suggests. One study ran seven models through three production coding harnesses, Claude Code, mini-SWE-agent and OpenCode, and reran each setup unchanged. Swapping the harness changed the outcome of about as many tasks as rerunning the same harness did. Across the study's setups, both changed 13% of the 45 tasks at the median. Those tasks are SWE-bench Verified's two hardest difficulty bands. Harnesses differed in cost instead, from under 10% to three or four times, depending on the model [@liu-what-does-a-harness-buy]. A better score is no reason to buy a loop, but the time it saves and the work it was tuned for can be. Whatever the tier, keep your evaluations and your telemetry in your own hands, because they are what let you leave a tier when the numbers turn.

## ReAct is the default plan, and an upfront plan or a reflection pass has to earn its extra model calls

Ask an agent why order 42's refund never reached the customer, and it cannot know its route in advance. It reads the order, then the payment, then perhaps the bank's note, and each result decides the next lookup. :analogy[A hiker who reads the sign at each fork, against one who follows a route planned the night before]{#hiker-signs-or-route} makes the choice plain. The sign-reader holds no plan beyond the next fork, so a closed bridge is only new information. The route-follower can describe the whole trip to anyone before leaving, and a closed bridge leaves them off the map until they redraw it. The picture breaks on cost. Redrawing a hiker's route costs a day, but a model can redraw its plan at every step for the price of a call.

ReAct is the sign-reader. The model writes a reasoning trace and a task action in an interleaved sequence, so each observation can change the next thought [@yao-react]. The loop of [[ch:call-workflow-loop]] has this shape. On two interactive benchmarks, ALFWorld and WebShop, ReAct prompted with one or two examples on a frozen PaLM-540B model beat imitation-learning and reinforcement-learning baselines by 34 and 10 absolute points of success rate. That model is from 2022, so read the margins as a direction, not as a gap you would see today. Without the thoughts, the agent failed to split goals into subgoals or lost track of the state of the world. ReAct also has a failure of its own: the model repeats its earlier thoughts and actions and cannot jump out of the loop [@yao-react]. The step cap of [[ch:stopping-and-structured-output]] is what cuts such a loop off.

Plan-and-execute is the route-follower. A planner model writes the whole plan before any tool runs, and an executor works through it, perhaps with a smaller model or plain code. A 2025 guide argues that the split makes the trajectory predictable, uses the expensive planner sparingly, and keeps text injected through a tool result from rewriting the plan. It also names the price. Once the plan is set, the agent follows it, so a flawed plan needs a re-planning step, and the executor can itself be a ReAct agent [@del-rosario-plan-then-execute]. The guide is an argument with code blueprints and reports no measurements of its own. The pattern fits work whose steps depend on one another and whose order is worth auditing, such as a refund that must update the order, refund the card and send the email in that order, which [[ch:side-effects-that-can-fail]] approves as one plan.

Reflection adds a second pass. In Reflexion, an evaluator scores a finished attempt, the agent writes a verbal reflection on what went wrong and stores it in a memory, and the next trial starts with that memory. No weights change [@shinn-reflexion]. The authors report 91% pass@1 on HumanEval against 80.1% for GPT-4, and 77.1% on MBPP in Python against GPT-4's 80.1%, so the gain is not uniform. Reflexion needs something to reflect on, such as unit tests, and it reruns whole attempts: its loop runs until the evaluator passes or a trial limit is reached. Each reflection therefore costs another full run, and the multiple depends on how often the first attempt fails.

No controlled benchmark that we found compares these patterns under identical models, as of November 2026, so the rule is ours. Start with ReAct, and add a plan or a reflection only for a failure you can name, such as steps that must happen in order or an attempt you can score by running tests. Then measure the change with the evals of [[ch:evals-observability-and-release]], because a pattern that adds calls has to show it adds passes.

## Code, a classifier or the model can pick the next specialist, and each pick costs a different number of calls

A support desk gets two kinds of message, "Where is my refund?" and "Why was I charged twice?", and each kind needs a specialist with its own prompt. [[ch:call-workflow-loop]] sorted the shapes by who decides the next step, and splitting the work among specialists asks that question again. There are three answers. In a workflow, your code fixes the order. In a router, your code or a classifier picks the branch. In a handoff, the model chooses to transfer the conversation.

A workflow fixes the order. Anthropic's simplest form is prompt chaining: each model call processes the output of the previous one, and programmatic checks in between keep the run on track [@anthropic-building-effective-agents]. [[lst:sequential-order-ours]] chains a writer and a reviewer in our SDK, where two `complete()` calls in order are the whole workflow and the code carries the draft from one to the other. [[lst:sequential-order]] chains them in ADK. The sequential agent runs its sub-agents in the order listed, and no model decides that order [@adk-sequential-agents]. As of November 2026, ADK 2.5.0 deprecates this class in favour of graph-based workflows and says so when you construct one. Read the ADK tab for the idea, which a graph keeps. The cost is countable before the run: two model calls.

::::tabs
:::listing[Our SDK]{#sequential-order-ours file="packages/sdk/examples/02-workflow.ts" region="sequential"}
::note[The writer's answer becomes `draft`, a plain variable in your code.]{#writer}
::note[The code pastes `draft` into the reviewer's instruction, and this call runs second because its line comes second.]{#reviewer}
:::
:::listing[Google ADK]{#sequential-order file="verify/google-adk/examples/02-workflow-agents.ts" region="sequential"}
::note[The writer's reply is saved in session state under the key draft.]{#writer}
::note[The reviewer's instruction holds a placeholder that ADK fills from that state key before the call.]{#reviewer}
::note[The list's order is the run's order, and no model chooses it.]{#order}
:::
::::

In both tabs, code fixes the order and a value carries the draft: a variable in ours, a state key in ADK.

A router adds a branch. Routing classifies an input and sends it to a specialised follow-up task, and it works when the categories are distinct and a classifier, whether a model or a plain algorithm, can tell them apart accurately [@anthropic-building-effective-agents]. In ADK's graph, a node emits a route value, and an edge map sends each value to a target node [@adk-graph-routes]. In [[lst:route-by-code]] a regular expression is the classifier: input with a digit takes one branch and any other input takes the other. Only the winning branch runs. The digit branch is a plain function and makes no model call, while the other makes one. Our SDK has no router class, so its tab uses an ordinary conditional that calls one function or the other, with no edge map to configure.

::::tabs
:::listing[Our SDK]{#route-by-code-ours file="packages/sdk/examples/11-route-by-code.ts" region="routing"}
::note[A regular expression picks the branch, so no model is asked, and a router that misreads an input misreads it the same way every time.]{#route}
:::
:::listing[Google ADK]{#route-by-code file="verify/google-adk/examples/03-graph-workflow.ts" region="routing"}
::note[A regular expression picks the route, so no model is asked, and a router that misreads an input misreads it the same way every time.]{#route}
::note[The edge map sends one route to a function node and the other to an agent node, because a graph treats an agent as one more node.]{#edges}
:::
::::

Both tabs send a digit to a branch that makes no model call, and any other input to a branch that makes one.

A handoff lets the model decide. In the OpenAI Agents SDK, handoffs are represented to the model as tools. Listing a specialist under `handoffs` makes the SDK offer a tool for it, and when the model calls that tool, the specialist becomes the active agent for the rest of the turn [@openai-agents-handoffs; @openai-agents-orchestration]. By default the specialist receives the whole conversation so far [@openai-agents-handoffs]. [[lst:handoff-tool]] runs one, and its replay shows two model calls. The first is the triage agent's, which ends in the transfer. The second is the billing agent's, whose request holds the question, the transfer and its result, and which gives the answer.

:::listing[A handoff: the model calls a transfer tool, and the specialist answers]{#handoff-tool file="verify/openai-agents-sdk/examples/03-handoff.ts" region="handoff" replay}
::note[Listing billing under handoffs makes the SDK offer the model a tool named `transfer_to_Billing_agent`, which keeps the agent name's case where the documentation's example shows lowercase.]{#handoffs}
::note[The run ends with the billing agent's answer, and the result names it as the last agent.]{#run}
:::

:::table[Three ways to pick a specialist, and what each costs before the specialist starts]{#pickers}
| Shape | Who picks | Model calls to pick | What the specialist receives |
| --- | --- | --- | --- |
| Workflow | Your code, in a fixed order | None | The previous step's output, which your code passes on |
| Router | Your code, or a classifier | None for code, one for a model | Whatever your code passes on |
| Handoff | The conversation's model | One: the call that asks for the transfer | The whole conversation so far, unless you filter it |
:::

Who picks decides what can go wrong. Code never sends input to a branch it was not given, but it cannot read a message it has no rule for. A classifier reads the message and can misread it, at the price of one call. The model in a handoff reads the whole conversation, and the `handoffs` list fixes which agents it can reach, while its prompt and the specialists' descriptions decide which one it picks. OpenAI separates the handoff from a neighbouring pattern. Use a handoff when routing is part of the workflow and the specialist should own the next part of the conversation. Use an agent as a tool when the specialist should help with a subtask without taking over [@openai-agents-orchestration]. Using an agent as a tool makes it a subagent. Our SDK has no handoff, so [[lst:handoff-tool]] has no tab of ours: the SDK offers no `handoffs` option and no transfer tool. You could build one by ending a run on a transfer tool's call and starting a second run in your own glue code, but the SDK has no feature of its own to show for it.

## A subagent keeps its reading out of its parent's context, and the tokens of every room still land on the bill

Your support agent is asked whether tool-call logging became more common between two surveys of teams. The answer is one sentence, but getting it means reading two sources, and the agent would carry both in its context for the rest of the conversation. A subagent can do the reading somewhere else. :analogy[Researchers sent to separate reading rooms who return with summaries]{#reading-rooms} is the picture. The lead asks a question, each researcher reads their sources in a room of their own, and only a summary comes back through the door. Anthropic describes its Research system the same way: its subagents work in parallel with their own context windows and condense the most important tokens for the lead agent [@anthropic-multi-agent-research-system]. The picture breaks at the bill. Each researcher is paid by the word read, so every room adds its own tokens, and the lead's saving is in context, not in cost.

:::figure[Researchers sent to separate reading rooms who return with summaries: only the summary leaves the room]{#reading-rooms analogy="reading-rooms"}
::svg{alt="A lead agent box on the left and two dashed reading rooms on the right. Each room holds a researcher, drawn in the accent, and two source boxes: A and B in room 1, C and D in room 2. A solid arrow carries the question from the lead into each room, and a dashed accent arrow carries a summary back out. Under the lead: reads summaries, never the sources. A line at the bottom, in the accent: each researcher is paid by the word read."}
:::

The OpenAI Agents SDK builds this with an agent that is also a tool. Calling `asTool()` on an agent makes a function tool with a single input parameter. When the model calls it, the SDK runs the subagent with that input in a nested run, then returns the subagent's last message or whatever an output extractor chooses [@openai-agents-tools]. [[lst:subagent]] reads two sources inside that nested run and hands back one sentence. Our SDK has no `asTool()`. [[lst:subagent-ours]] builds the same arrangement from the SDK's parts. A tool's `execute` starts a nested `run()` of its own and returns what the subagent said, and `nestedRunDepth(ctx)` counts the child as one level down [@buildanagent-sdk-readme].

::::tabs
:::listing[Our SDK]{#subagent-ours file="packages/sdk/examples/12-subagent-as-tool.ts" region="subagent"}
::note[The child's `result.usage` counts only its own model calls, so its tokens are read here, where the child's result is in hand.]{#own-usage}
::note[Only this string leaves the nested run, as the tool call's output.]{#summary}
:::
:::listing[OpenAI Agents SDK]{#subagent file="verify/openai-agents-sdk/examples/12-subagent-as-tool.ts" region="subagent"}
::note[The subagent's own tokens are the sum over its model responses, which this run keeps apart from its parent's.]{#own-usage}
::note[Read inside the nested run, the usage object holds the shared running total, not the subagent's own count.]{#shared-usage}
::note[Only this string leaves the nested run, as the tool call's output.]{#summary}
:::
::::

The orchestrator never sees the reading. [[lst:orchestrator]] gives it the research tool and asks its question, and the example's checks confirm what crosses the door: the orchestrator's second request holds the summary as the tool's output, and nothing from the subagent's tool calls or the sources it read.

::::tabs
:::listing[Our SDK]{#orchestrator-ours file="packages/sdk/examples/12-subagent-as-tool.ts" region="orchestrator" replay}
:::
:::listing[OpenAI Agents SDK]{#orchestrator file="verify/openai-agents-sdk/examples/12-subagent-as-tool.ts" region="orchestrator" replay}
:::
::::

The tokens do cross, though. In the script the subagent's calls grow more expensive as it reads, because each call carries everything read before it, as every call in a loop does. [[lst:usage]] adds them up.

::::tabs
:::listing[Our SDK]{#usage-ours file="packages/sdk/examples/12-subagent-as-tool.ts" region="usage"}
::note[The orchestrator's `result.usage` counts only its own calls, so the code adds the subagent's tokens itself to get the total.]{#run-usage}
:::
:::listing[OpenAI Agents SDK]{#usage file="verify/openai-agents-sdk/examples/12-subagent-as-tool.ts" region="usage"}
::note[The run's usage adds the subagent's tokens to the orchestrator's own, because the nested run shares the orchestrator's run context.]{#run-usage}
:::
::::

Both examples print `orchestrator 800, subagent 2400, run 3200 tokens`, so the run's total is four times the orchestrator's own. We wrote those counts into the script, and no model measured them, so the 4× shows how a subagent's tokens add up and says nothing about real cost. The measured figures are Anthropic's. In its data, agents typically use about four times the tokens of a chat, and multi-agent systems about fifteen times [@anthropic-multi-agent-research-system]. Those are two separate figures, each measured against a chat, and neither is this run's ratio. To read a subagent's own tokens from the nested run, sum its `rawResponses`, as the OpenAI Agents SDK tab does. The nested run's `state.usage` is the shared running total instead. It held 2,740 tokens when the extractor ran in this example, because the orchestrator's first call had already been added [@openai-agents-context; @openai-agents-results]. Our SDK keeps each run's count separate: `result.usage` covers only that run's own model calls, as does a parent's `budgetUsd`{checked=row-101}, so your code adds the two runs.

The README advises giving each child a budget of its own, which this unpriced scripted example leaves out [@buildanagent-sdk-readme].

Subagents pay when the work is wide, and they lose when it is narrow. Anthropic found that a lead Claude Opus 4 with Claude Sonnet 4 subagents beat a single Claude Opus 4 by 90.2% on its internal research eval. Token use alone explained 80% of the variance on a browsing benchmark, so much of the gain is more tokens spent. It sees the fit in "heavy parallelization, information that exceeds single context windows, and interfacing with numerous complex tools". It names the misfits too: tasks in which all agents must share one context or depend heavily on one another, and it adds that most coding tasks have fewer parallelizable parts than research. For the cost to make sense, the value of the task must be "high enough to pay for the increased performance" [@anthropic-multi-agent-research-system]. Our rule follows. Add a subagent when one context cannot hold the reading or the reading can run in parallel, and when the answer is worth several times the tokens of a chat.

## Exercises

1. **Replace the handoff with a router in code.** In `verify/openai-agents-sdk/examples/03-handoff.ts`, give the billing agent the question directly with `runner.run(billing, "Where is my refund?")`, as a router that sends every refund question to billing would. Predict how many scripted answers the run needs, change the script to match, and run `pnpm test` in `verify/openai-agents-sdk`. How many model calls did the router save compared with the handoff, and what must your code now know that the triage model knew?
2. **Turn the specialist into a subagent.** Make `billing` a tool of the triage agent with `asTool()`, a `toolName` and a `toolDescription`, and script the answers the triage agent needs: one that calls the tool and one that answers from its result. The billing agent needs an answer of its own. Predict the number of model calls in all, then check it with the script's completeness check. Who writes the final answer now, and where does the billing agent's text go?
3. **Compare the three shapes in tokens.** Give every scripted answer a token count of your choosing, as `answer()`{checked=row-88} does in `verify/openai-agents-sdk/examples/12-subagent-as-tool.ts`, and total the tokens of the handoff, the router and the subagent. Which is cheapest, and why does your ranking depend on numbers you chose? Then say which of Anthropic's two figures, about 4× or about 15× the tokens of a chat, your totals could support.
