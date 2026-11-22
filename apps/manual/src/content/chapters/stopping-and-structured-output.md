---
title: "Stopping: caps, stop conditions and structured output"
summary: An agent stops when the model answers, when a condition you wrote holds, or when a cap runs out, and each SDK counts and reports that end in its own way. A schema then turns the answer into a typed object, which fixes its shape but never its truth.
opening: question
sources: [ai-sdk-loop-control, langgraph-graph-api, claude-agent-sdk-agent-loop, claude-agent-sdk-tool-search, openai-agents-running-agents, ai-sdk-generating-structured-data, claude-agent-sdk-structured-outputs, anthropic-structured-outputs, ghosh-truthgate, buildanagent-sdk-readme]
glossary: [agent-loop, stop-condition, tool, stop-reason, structured-output]
switchTo: [B11, B14]
---

How many times may an agent call its model before something stops it? Put that question to the eight SDKs this book verifies and, as of November 2026, the answers run from one to five hundred. The Vercel AI SDK's `generateText` makes one model call unless you ask for more, and its `ToolLoopAgent` makes up to twenty. The OpenAI Agents SDK allows ten turns and Cloudflare's Think agent ten steps. LangChain allows twenty-five steps of a graph, which came to thirteen model calls when we counted, and Google's ADK allows five hundred. Pi and the Claude Agent SDK set no cap at all, so a model that keeps asking for tools keeps getting them. The GitHub Copilot SDK exposes no cap either. Whatever its runtime does, you cannot set a limit through the SDK, so to bound a run your own code has to end it with `session.abort()`{checked=row-76}.

The spread matters because a cap may be what ended your run, and the SDK may not tell you. An agent loop ends in one of three ways: the model answers without asking for a tool, a stop condition you wrote holds, or a cap runs out. The model decides the first, you decide the second, and the SDK's authors decide the third unless you override them. Once the loop has ended, your program usually wants more than prose: an object with known fields that it can store, route or show. This chapter answers three questions in that order: when does an agent stop, who decides, and how does your program get a typed answer out of it? You will come away able to set a cap in the unit your SDK counts, to read why a run ended before you trust its answer, and to check an answer against a schema without mistaking a well-formed answer for a true one.

## A cap ends the run wherever it is, and each SDK counts it in its own unit

Buy :analogy[a bus ticket good for three stops]{#bus-ticket}, and the driver puts you off after the third stop, whether or not it is the one you wanted. The ticket knows nothing about your destination. It counts stops, and when the count runs out, the ride is over. A step cap is just as blind: it ends the loop after a set number of steps, whatever the model was about to do next.

In the AI SDK, the cap is a stop condition passed as `stopWhen`, the option [[ch:call-workflow-loop]] used to lift `generateText` past its default of one step. The SDK checks it after each step whose model call asked for tools; the docs say `stopWhen` "controls when to stop execution when there are tool results in the last step" [@ai-sdk-loop-control]. A step is one model call and the tools it ran, and `isStepCount(3)` holds once the run has three steps. So the loop ends after the third model call even when that call asked for another tool, and the tool it ran gets no model call to read its result. [[lst:cap-ours]] and its three neighbours each cap a loop whose model never stops asking for a tool, one SDK to a tab. The first tab is our own SDK, whose `run()` counts the cap in model calls and calls it `maxSteps`.

::::tabs
:::listing[Our SDK]{#cap-ours file="packages/sdk/examples/07-stop-step-cap.ts" region="step-cap" replay}
::note[The scripted model answers with three calls to `ping` and never with text, so only the cap can end this run. A strict `ScriptedModel` fails a run that asks for a fourth response.]{#script}
::note[`maxSteps` counts model calls, so this run may make three. Leave it out, and a run may make 20.]{#cap}
::note[Besides its result, the run reports the cap as a `warning` event whose `code` is `"max_steps"`. A caller that never reads the result can still log it.]{#warning}
::note[`result.stopReason` is `"max_steps"`: the run returned a result instead of throwing, and it never reached `"done"`.]{#result}
:::
::listing[Vercel AI SDK]{#cap-ai file="verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts" region="step-cap"}
:::listing[LangChain]{#cap-langchain file="verify/langchain/examples/06-recursion-limit.ts" region="attempt"}
::note[`config` is the run's second argument, and `recursionLimit` sits at its top level. Call `attempt()` without it, and LangGraph uses its default of 25.]{#limit}
::note[At the limit LangGraph throws `GraphRecursionError`. `attempt` catches it and returns it with the number of model calls the run made.]{#thrown}
:::
:::listing[Claude Agent SDK]{#cap-claude file="verify/claude-agent-sdk/examples/04-max-turns.ts" region="max-turns" replay}
::note[The task needs three turns: one for a `ToolSearch` call that loads the search tool's definition, one to call the search, and one to answer with text.]{#task}
::note[`maxTurns: 1` leaves no turn for the answer, so the run ends in an `"error_max_turns"` result with no final answer.]{#max-turns}
:::
::::

The four listings cap the same kind of runaway loop, but their numbers count different things:

- **A step on our SDK** is one model call, and `maxSteps` counts them. In the recorded run of [[lst:cap-ours]], `maxSteps: 3` let exactly three requests reach the model, and the tool that the third response called still ran, so its result is in `result.messages`, though the transcript ends before a fourth request could carry it [@buildanagent-sdk-readme].
- **An AI SDK step** is one model call and the tools it ran. In the recorded run of [[lst:cap-ai]], `isStepCount(3)` let exactly three requests reach the model.
- **A Claude Agent SDK turn** is "one pass through the loop", and the final text-only answer counts as a turn of its own, so the docs ask you to count "each turn with tool calls, plus one for the final text-only response" [@claude-agent-sdk-agent-loop]. The recorded run of [[lst:cap-claude]] shows one more turn to count: the single turn `maxTurns: 1` allowed went to a `ToolSearch` call, which loads the search tool's definition, because the SDK defers a custom tool's definition behind that call by default [@claude-agent-sdk-tool-search]. The search itself never ran.
- **A LangGraph super-step** is one round in which the graph runs its active nodes [@langgraph-graph-api]. LangChain's agent runs the model and the tools as separate nodes, so one model call and its tool round take two super-steps. The default of 25 allowed 13 model calls in [[lst:cap-langchain]], and a limit of 5 allowed 3.
- **An OpenAI Agents SDK turn** is one model call, and ADK counts model calls directly.

A bus company at least counts every stop the same way. SDKs do not, so the same number means different things. A cap of 25 allows twenty-five model calls in OpenAI's unit and thirteen in LangChain's, while in Claude's it allows twenty-four tool-calling turns plus the answer. [[tbl:default-caps]] sets the defaults side by side, with what each SDK does when its cap fires.

:::table[Each SDK's default cap, the unit it counts, and what happens when it fires, as of November 2026]{#default-caps}
| SDK and entry point | Option | Default | Counts | At the cap |
| --- | --- | --- | --- | --- |
| Our SDK `run()` | `maxSteps` | 20 | Model calls | Returns a `max_steps` result and emits a `warning` event |
| AI SDK `generateText` | `stopWhen` | `isStepCount(1)` | Steps | Returns normally |
| AI SDK `ToolLoopAgent` | `stopWhen` | `isStepCount(20)` | Steps | Returns normally and logs a warning |
| OpenAI Agents SDK `run()`{checked=row-18} | `maxTurns` | 10 | Turns | Throws `MaxTurnsExceededError`{checked=row-18} |
| Cloudflare Think | `maxSteps`{checked=row-19} | 10 | AI SDK steps | Ends the turn, as the AI SDK does |
| Cloudflare `AIChatAgent`{checked=row-83} | None of its own: the `stopWhen` your code passes to `streamText` | `isStepCount(1)`, the AI SDK's | AI SDK steps | Ends the turn, as the AI SDK does |
| LangChain `createAgent` | `recursionLimit` | 25 | Graph super-steps | Throws `GraphRecursionError` |
| Google ADK `Runner`{checked=row-20} | `maxLlmCalls`{checked=row-20} | 500 | Model calls | Throws `LlmCallsLimitExceededError`{checked=row-20} |
| Claude Agent SDK `query()` | `maxTurns` | No limit | Turns | Yields an `"error_max_turns"` result, then throws |
| Pi | None | No limit | | |
| GitHub Copilot SDK | None exposed | None you can set | | Your code ends the run with `session.abort()`{checked=row-76} |
:::

[[fig:default-caps]] puts the same defaults on one scale, in model calls, the unit a bill counts. Because the defaults span more than two orders of magnitude, the scale is logarithmic: 1, 10 and 100 sit the same distance apart.

:::figure[The SDKs' default caps on one scale, from one model call to five hundred]{#default-caps}
::svg{alt="A horizontal logarithmic scale of model calls, marked 1, 10, 100 and 500. Eight default caps sit on it at five marks: at 1, the AI SDK's generateText and Cloudflare's AIChatAgent, whose cap of 1 is streamText's default; at 10, the OpenAI Agents SDK's run and Cloudflare Think; at 13, LangChain's createAgent; at 20, the AI SDK's ToolLoopAgent and our SDK's run; and at 500, Google ADK. A box below the scale says that Pi and the Claude Agent SDK set no default cap, and that the GitHub Copilot SDK exposes none."}
:::

Two entries hide a catch. The Copilot SDK's `sendAndWait`{checked=row-23} gives up waiting after 60 seconds by default, but its type declarations say the timeout "does not abort in-flight agent work", so it is no cap on the loop. And the AI SDK's own docs say what its twenty-step default is for: "a safety measure to prevent runaway loops that could result in excessive API calls and costs" [@ai-sdk-loop-control]. A safety net has to suit every task, so it is sized for none of yours.

We repeat the advice of [[ch:call-workflow-loop]]: every agent should set its own cap, in model calls, from the longest run its task legitimately needs. Count the steps of the worst honest case, then add a margin for a retry or two. The order-status request in that chapter needs a lookup, a customs lookup and an answer, so three model calls, and a cap of five or six leaves room for one failed call each. No source we found measures how often real agents hit a default cap, so that margin is our judgement.

A cap on model calls bounds cost only indirectly, because one call can be cheap or dear. Some SDKs cap spend directly: the Claude Agent SDK's `maxBudgetUsd`{checked=row-25} stops a run once its estimated cost passes a limit. Its docs warn that the check runs after each response, so "spend can therefore pass the cap by up to the cost of that one response" [@claude-agent-sdk-agent-loop]. Leave headroom under the amount you actually mean.

Our SDK's `budgetUsd`{checked=row-101} checks before the call instead. Before each model call, the run adds the most that call could cost, projected from the model's prices and output limit, to the spend so far, and when the sum could pass the cap it ends `budget`{checked=row-101} without sending the call [@buildanagent-sdk-readme]. On the SDK's scripted 30-step run, across 29 caps, that check overshot by $0 on every cap, where a check after each response overshot by $0.0105 on average, almost the whole call that crossed the cap [@buildanagent-sdk-readme]. The early stop has a price: the projection assumes the model writes its whole output allowance, so the run left $0.054 of the cap unspent on average. Both figures come from one scripted run, not from live traffic.

## A run has two stop reasons: why the model stopped writing, and why the loop stopped calling it

Ask the capped run in [[lst:cap-ai]] why it ended, and the AI SDK answers `"tool-calls"`. That answer is true and misleading at once. The model's last response did end by asking for a tool, so that is why the model stopped writing; the loop, though, stopped because the cap ran out, and the result carries no field that says so. A run has two stop reasons, and you need both: one for each model response, and one for the run as a whole.

The model's stop reason, which the AI SDK calls a finish reason, comes back with every response. In the AI SDK it is one of seven values, `"stop"`, `"length"`, `"content-filter"`, `"tool-calls"`, `"error"`, `"interrupted"` and `"other"`, and the result's `finishReason`{checked=row-30} is "taken from the final step". The Claude Agent SDK passes on Anthropic's names, whose common values are `"end_turn"` when the model finished, `"max_tokens"` when it hit the output limit and `"refusal"` when it declined [@claude-agent-sdk-agent-loop]. The loop reads this reason to decide whether to go on. In the AI SDK, any finish reason other than `"tool-calls"` ends the loop [@ai-sdk-loop-control], and Pi refuses to run the tool calls of a response that stopped on `"length"`, because a cut-off response "may carry truncated arguments".

The run's stop reason says why the loop ended, and here the SDKs part ways. The Claude Agent SDK writes both on one result message: a `subtype`{checked=row-32} for the run, such as `"success"`, `"error_max_turns"` or `"error_max_budget_usd"`, and a `stop_reason`{checked=row-32} for the model's last response. Its error results "still carry session_id and cost", as the example's checks confirm, so you can resume a capped run with a higher limit. The OpenAI Agents SDK, LangChain and ADK report a cap by throwing, and OpenAI's `errorHandlers`{checked=row-33} option can turn a `maxTurns` error into a final output instead [@openai-agents-running-agents]. The AI SDK reports nothing for a cap you set yourself; only its default cap logs a warning. A capped AI SDK run therefore looks like a finished one unless your code checks the last finish reason, or counts the steps against its cap.

Our SDK reports a cap in its result. The capped run in [[lst:cap-ours]] returns a `max_steps` result and emits a `warning` event, and `result.output` exists only on a `done` result, so TypeScript rejects a read of it until the code has checked `stopReason`{checked=row-104} [@buildanagent-sdk-readme]. The two stop reasons stay apart in the data as well: the capped run's last model response finished with `"tool_calls"`, while its result says `"max_steps"`. In our reading, this is a design choice and not a verdict on the others: it moves the check from the caller's discipline into the types.

Not every early stop is a failure. Sometimes you want the loop to end the moment the model has done one particular thing, and a stop condition can watch for it. Both tabs below give the model a tool called `finalAnswer` and end the loop as soon as the model calls it. The AI SDK's tab does so with a stop condition, `hasToolCall("finalAnswer")`. Ours builds `finalAnswer` with `outputTool()`, and an accepted call to it ends the run `done`.

::::tabs
:::listing[Our SDK]{#stop-on-done-ours file="packages/sdk/examples/08-stop-done-tool.ts" region="done-tool" replay}
::note[`outputTool()` builds a tool whose input is the run's answer. Passing it as `output` tells the run that an accepted call to it ends the run.]{#done-tool}
::note[`maxSteps: 10` is the second condition, as in the AI SDK tab's array: the run ends at the output call or at the tenth model call, whichever comes first.]{#either}
::note[The answer is `result.output`, typed by the schema. It exists only on a `done` result, so this line checks `stopReason` first.]{#answer}
:::
:::listing[Vercel AI SDK]{#stop-on-done file="verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts" region="stop-when" replay}
::note[`finalAnswer` is an ordinary tool. Calling it is how the model says it is done, and its argument carries the answer.]{#done-tool}
::note[An array of conditions stops at the first one that holds: a step that called `finalAnswer`, or ten steps, whichever comes first.]{#either}
:::
::::

In the AI SDK's replay, the first request offers the model two tools, `ping` and `finalAnswer`. The model calls `ping`, the tool returns "pong", and the second request carries that result back. The model then calls `finalAnswer` with the answer "42", the tool runs, and `hasToolCall("finalAnswer")` holds, so the loop ends after two steps. The script holds a third answer, "never reached", and the replay confirms that no request ever asked for it. The answer arrives as the tool's result, and the example's checks read "42" from it.

Our replay follows the same two steps. The first request offers `ping` and `finalAnswer`, because the output tool is sent like any other tool. The model calls `ping`, then calls `finalAnswer` with the answer "42". The answer passes the tool's schema, so the run ends `done` after two model calls, and `result.output` holds the answer. Our script holds no third response, because a strict `ScriptedModel` fails a run that asks for one [@buildanagent-sdk-readme].

Our SDK also has a stop condition of the AI SDK's kind. A `shouldStop`{checked=row-108} hook runs after each step, and when it returns `{ stop: "hook", reason }`{checked=row-108}, the run ends `stopped`{checked=row-108} and `stoppedBy`{checked=row-108} holds the reason you gave. The example's second run ends this way when the model calls a plain `finish` tool. We would choose the output tool when the model's last act is an answer, and the hook when your own code decides that the run is over.

A done tool hands you more than a clean stop. Its input schema, the same kind of schema every tool in [[ch:tools]] declares, shapes the answer, so the model's last act fills in typed fields instead of writing prose. Several SDKs build structured output on this very idea, as the next section shows. The rule this section leaves you with is ours: read the run's stop reason before you read its answer. A run that the model ended, a run that your condition ended and a run that a cap cut off can all return text, and only the first two are finished. Finished means that the model or your condition ended the loop, not that the task succeeded: whether the answer is right is a separate question, which the next section takes up.

## A schema fixes the shape of the answer, never its truth

Pour hot jelly into :analogy[a jelly mould]{#jelly-mould} shaped like a rabbit, and whatever you poured comes out a rabbit: lime or strawberry, sweet or far too sour. The mould decides the shape and has no say over the flavour. A schema shapes a model's answer and leaves its content just as open: it can make every answer an object with a `category` and an `urgent` flag, and it cannot make the category the right one.

Behind the mould sits structured output. Your code gives the SDK a schema; the SDK sends it with the request, asks for JSON, then parses the answer and checks it against the schema before your code sees it. The AI SDK's docs give the reason: "LLMs can produce incorrect or incomplete structured data", so the schema "is also used to validate the generated data" [@ai-sdk-generating-structured-data]. Both tabs below ask for a ticket's triage. The AI SDK's tab uses `Output.object` with the schema in [[lst:triage-schema]]. Ours writes the same schema into `outputTool()`, so the answer is a call to a tool whose input the schema checks.

::listing[The triage schema: a category from three values and an urgency flag]{#triage-schema file="verify/vercel-ai-sdk/examples/05-structured-output.ts" region="schema"}

::::tabs
:::listing[Our SDK]{#triage-output-ours file="packages/sdk/examples/09-stop-triage-output.ts" region="triage" replay}
::note[`outputTool()` sends the schema as the tool's input schema, and its `name` and `description` tell the model what the tool is for.]{#output}
::note[This scripted answer breaks the schema: `"refund"` is not a listed category, and `urgent` is missing. The run does not end. It sends the model the failure as an error result.]{#refund}
::note[`result.output` takes its type from the schema once the line has checked `stopReason`, so this assignment type-checks. The example also holds a line that fails to compile when it reads `result.output` unchecked.]{#typed}
:::
:::listing[Vercel AI SDK]{#triage-output file="verify/vercel-ai-sdk/examples/05-structured-output.ts" region="output-object" replay}
::note[`Output.object` sends the schema with the request and checks the answer against it. The `name` and `description` give some providers extra guidance.]{#output}
::note[`result.output` takes its type from the schema, so this assignment type-checks. Misspell a field, and the example fails to compile.]{#typed}
:::
::::

The AI SDK's replay is short, because the work happens around the model rather than in it. The request carries one message, "I was charged twice!", and offers no tools. The model answers with the text `{"category":"billing","urgent":true}` and finishes with `"stop"`. The SDK parses that text into an object, checks it, and hands it over as `result.output`. The example's checks confirm the rest: the request asked for JSON under the schema's name, "triage", and carried the JSON Schema, and the answer came back as the parsed, typed object.

Our replay has two model calls, because its first answer breaks the schema. The first request carries "I was charged twice!" and the one tool, `triage`. The model calls it with the category "refund", which the schema does not list, and no `urgent` field. The run sends the second request a failed tool result that names both fields. The model calls `triage` again with a valid answer, and the run ends `done` with the typed object as `result.output`. The failed answer spent one of the three model calls that `maxSteps` allowed, and the example's checks confirm it [@buildanagent-sdk-readme].

[[fig:jelly-mould]] shows what the check can and cannot catch. The AI SDK example sends a second request whose scripted answer is `{"category":"refund"}`, with a category the schema does not list and no `urgent` field. That jelly never set: `generateText` rejects with `NoObjectGeneratedError`. Our tab's first answer is the same one, and our run treats it differently: it hands the failure back to the model and lets it call again. A third answer would fare worse. For the same ticket, `{"category":"bug","urgent":false}` fits the mould exactly, passes every check, and is wrong. A measured case shows the same gap in a coding task. On the impossible variants of Impossible-LiveCodeBench, which cannot be solved without breaking their own specification, Claude Sonnet 5.5 still passed 39 of 180, every time by special-casing its code to fit the failing assertion [@ghosh-truthgate]. Across the study's runs of three models, every cheat named the special case when asked for a final report, but unasked, Sonnet's visible text named it in none of its 47 cheats [@ghosh-truthgate].

:::figure[A jelly mould: every answer that fits comes out the same shape, right or wrong]{#jelly-mould analogy="jelly-mould"}
::svg{alt="A box at the top, the mould, reads: the schema, category, urgent: true or false. Arrows lead down to three jellies. The first, billing, urgent: true, is marked right shape, right answer. The second, bug, urgent: false, is marked right shape, wrong answer. The third, drawn dashed, reads refund, no urgent field, and is marked did not set: rejected. Text under them names the ticket: I was charged twice!"}
:::

A structured answer also needs a step to arrive in, which ties this section to the first. The AI SDK counts "structured output generation" as a step, and its docs ask you to set `stopWhen` to "allow enough steps for both tool execution and output generation" [@ai-sdk-generating-structured-data]. The example's third case leaves no such step. With the default cap of one step, a model that calls a tool first uses its only step on the call, and reading `result.output` then throws `NoOutputGeneratedError`, because the last step ended in `"tool-calls"`.

Our SDK needs no step for the answer itself, because the answer is the model's call to the output tool. A failed answer still costs a model call, so give `maxSteps` room for a retry: with `maxSteps: 1`, a failed answer is the last call the run may make, and the run ends `max_steps` with no output. A model that ignores the output tool and answers in text ends the run `done` with `result.output` undefined, so a `done` result alone does not prove that the schema checked anything. Both cases are runs of the example's other two blocks.

Every SDK in this book has a route to structured output as of November 2026, and several build it on the done tool from the previous section. The Claude Agent SDK adds a tool called `StructuredOutput`{checked=row-48} that the agent calls with its answer [@claude-agent-sdk-structured-outputs]. Cloudflare Think adds a final-answer tool and stops on it with `hasToolCall`, our `outputTool()` is another such tool, and Pi ends a run after a batch of tool calls whose results all set `terminate: true`{checked=row-49}. The SDKs differ more in what they do when an answer breaks the schema, as [[tbl:schema-failures]] shows.

:::table[What each SDK does when the answer breaks the schema, as of November 2026]{#schema-failures}
| SDK and option | When the answer does not fit |
| --- | --- |
| Our SDK `outputTool()` | Sends the failed fields to the model as an error result, and the model can call again; each try spends one of `maxSteps`, and a failed try on the last allowed call ends the run `max_steps`. A text answer ends the run `done` with no `output` |
| AI SDK `Output.object` | Rejects with `NoObjectGeneratedError`, which keeps the model's text and the cause |
| OpenAI Agents SDK `outputType`{checked=row-50} | Throws `ModelBehaviorError`{checked=row-50}, unless an `invalidFinalOutput`{checked=row-50} handler returns a valid fallback |
| Claude Agent SDK `outputFormat`{checked=row-51} | Returns the error to the agent, which tries again; when no attempt passes, the run ends in `"error_max_structured_output_retries"` |
| Google ADK `outputSchema`{checked=row-52}, TypeScript | Logs the error and stores the answer anyway, as raw text when it is not JSON and as the invalid object when it breaks the schema |
:::

ADK's row is the warning in the table. Its TypeScript port, at version 2.5.0 as of November 2026, raises no error for an answer that breaks the schema, so the value it stores can be anything. Validate it again yourself before you use it.

Even constrained decoding, which shapes the answer while the model writes it, promises less than it seems to. Anthropic's API can constrain the model's output to a schema while the model writes, and its docs promise "schema-compliant responses through constrained decoding" [@anthropic-structured-outputs]. The same page lists three ways that promise gives out:

- **A refusal.** When the model declines, "the refusal message takes precedence over schema constraints", and the response ends with `"refusal"`.
- **A cut-off answer.** When the response hits the token limit, it ends with `"max_tokens"`, and "the output might be incomplete and not match your schema".
- **An enum value in the wrong case.** The model "might return a value that differs from your schema only in capitalization", with "no error and no special `stop_reason`{checked=row-58}".

The first two failures come back with a stop reason, `"refusal"` or `"max_tokens"`, which is one more reason to read it before the answer. The third comes back looking like success, so compare enum values without regard to case.

Some constraints never reach the model. Anthropic's constrained decoding does not support limits such as `minimum`{checked=row-59} or `maxLength`{checked=row-59}, and a request that sends one directly fails with a 400 error. Its SDK helpers instead move such a limit into the field's description, where the model reads it as a request, and check it afterwards when the helper validates [@anthropic-structured-outputs]. The Claude Agent SDK accepts a schema's `format`{checked=row-60} keyword, such as `"email"`, only "as an annotation", which its validator does not enforce [@claude-agent-sdk-structured-outputs].

A real mould shapes the jelly while it sets, and a schema rarely gets that chance. Most SDKs can only check the answer's shape after the model has written it, so an answer that does not fit is rejected or retried rather than reshaped. Even constrained decoding lets a refusal or a cut-off answer through. What the mould does get right is the part that matters most: a schema fixes the shape of an answer and says nothing about its truth.

So treat a validated object as well-formed and nothing more. We recommend three habits. First, read the run's stop reason, and use the object only when the run finished. Second, check what the schema could not: the enum's casing, the limits the provider dropped, and any rule that ties one field to another or to your data, such as a refund amount no larger than the order. Third, give the model an honest way out, such as the `"other"` category in [[lst:triage-schema]], so that a ticket that fits no category does not have to be forced into one.

An agent, then, stops for one of three reasons: the model finishes, a condition you wrote holds, or a cap runs out, and a default cap is set by people who never saw your task. Set the cap yourself, in the unit your SDK counts. Read why the run ended before you read what it said. And when the answer comes back as a typed object, trust its shape to the schema and its truth to your own checks. [[ch:evals-observability-and-release]] takes up checking an agent's claim against a record the agent cannot edit.

## Exercises

1. **Set a cap one step below what the task needs, and read the stop reason.** The run in [[lst:stop-on-done]] needs two steps: one to call `ping` and one to call `finalAnswer`. In `verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts`, change that agent's `isStepCount(10)` to `isStepCount(1)`. Before you run anything, predict three things: how many steps the run takes, the run's last finish reason, and the output of its last tool result. The example's two checks after that agent assume the old cap, and a failing `check()` stops the run at the first failure, so replace them with checks of your three predictions. Run `pnpm test` in `verify/vercel-ai-sdk`, then read the events for `model-3` in `results/transcripts/07-agent-stop-conditions.json`. How many requests reached the model, and which field of the result, if any, tells you that the cap ended the run rather than the model? `pnpm test` rewrites the transcripts and `results/run-examples.json`, so restore the example and its results with `git checkout verify/vercel-ai-sdk` when you are done.
2. **Give a structured answer room to arrive.** The last block of `verify/vercel-ai-sdk/examples/05-structured-output.ts` asks for `Output.object` with a tool and the default cap of one step, and reading `result.output` throws. Script a second model answer after the tool call, the JSON text of `{ category: "bug", urgent: false }`, and pass `stopWhen: isStepCount(2)` to `generateText`, importing `isStepCount` from "ai". Replace the block's `try` and its check with a check of what you predict `result.output` holds, then run `pnpm test` in `verify/vercel-ai-sdk` and find the second request in `results/transcripts/05-structured-output.json`. The prompt was only "?": the answer passed the schema, but what in the run tells you whether it is right? Restore the files with `git checkout verify/vercel-ai-sdk` when you are done.
3. **Write a stop policy on paper.** A support agent may refund an order: it looks up the order, checks the refund rules, and either issues a refund or hands the ticket to a person, and it reports a structured outcome with `"decision"`, `"amount"` and `"reason"` fields. For the SDK you know best, choose a cap and say which unit it counts and why that number; list every way a run can end and what your code tells the customer for each; and write the schema, then three checks your code must make that the schema cannot, one of them on `"amount"`.
