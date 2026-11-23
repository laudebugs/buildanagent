---
title: "Testing offline, and a first complete agent"
summary: A mock model replaces the provider so a test needs no key and gives the same answer every run. This chapter shows where each of eight SDKs lets a mock in, what a check() on a mocked run can and cannot prove, and one small support-triage agent written eight ways, with a ninth version on our own SDK.
opening: scenario
sources: [ai-sdk-testing, openai-agents-testing, langchain-unit-testing, pi-ai-readme, abc-agentic-benchmark-checklist, tau-bench, buildanagent-sdk-readme]
glossary: [mock-model]
switchTo: [B18, B19]
---

It is ten to five on a Friday, and you have reworded one line of your agent's instructions. You run the tests. They call a real model, take a minute, cost a few cents and pass. You run them again before you merge, and one fails, though nothing changed between the runs. The AI SDK's testing guide names the cause: "Testing language models can be challenging, because they are non-deterministic and calling them is slow and expensive" [@ai-sdk-testing]. A test that fails now and then teaches your team to ignore failures, and a test you cannot afford to run on every push stops guarding anything.

A mock model removes the model from the test, so the same code gives the same answer on every run, with no key and no bill. That is the first half of the problem. The second half is knowing what a passing test then proves, which is less than it seems. This chapter shows where each of eight SDKs lets a mock in, what an assertion on a mocked run can and cannot show, and one small support-triage agent that the book writes on each SDK, so you can run a complete agent offline.

Every listing in this chapter comes in two or more tabs. The first tab runs on our own SDK, `@buildanagent/sdk`, and the other tabs show the same step on the other SDKs the chapter compares, so you can see what changes between SDKs and what stays. As of November 2026 our SDK is a `0.1.0` alpha release, so its names may still change.

## A mock replaces the provider at one of three seams, and the seam decides what a test exercises

Every mock does two jobs. It answers each model call with a turn someone scripted in advance, and it records the request that came in, so a test can check what the code sent. The SDKs differ in where the mock plugs in. [[fig:mock-seams]] shows the three places.

:::figure[Where each harness's mock sits: an object in your process, a shim inside workerd, or an HTTP API behind a real CLI]{#mock-seams}
::svg{alt="Three rows of three boxes joined by arrows, the last box in each row marked as the mock. Row one, in your process for the AI SDK, OpenAI, LangChain, Pi and ADK: your code, the SDK's loop, a mock model object. Row two, inside workerd for Cloudflare: your agent class, a provider shim, a mock model. Row three, over HTTP for the Claude Agent SDK and the Copilot SDK: your code, the real CLI or runtime, a mock API on 127.0.0.1."}
:::

Five of the eight harnesses swap the model object inside the process. The AI SDK's examples use `MockLanguageModelV4`{checked=row-6}, OpenAI's use `ScriptedModel`, LangChain's use `fakeModel`, Pi's use the faux provider from pi-ai, and ADK's use a `ScriptedLlm` that our harness wrote, because ADK 2.5.0, as of November 2026, ships no test model [@ai-sdk-testing; @openai-agents-testing; @langchain-unit-testing; @pi-ai-readme]. Cloudflare's agents run inside workerd, Cloudflare's local Workers runtime, so its harness cannot hand them an object. Instead the bundler resolves each provider package to a shim that returns the same AI SDK mock model. The Claude Agent SDK and the Copilot SDK have no model object to replace at all, because each spawns a program, the `claude`{checked=row-9} CLI or the Copilot runtime, that makes the model call. Their harnesses point that program at a mock Anthropic Messages API on `127.0.0.1`, so the program's real loop, permission checks and hooks run against scripted answers.

Five listings show how the in-process mocks are scripted. Ours and the OpenAI and LangChain ones play a turn that calls a tool and then a turn that answers in text, Pi's plays three tool-calling turns, and ADK's is the class that plays whatever script a test hands it. Our `ScriptedModel` keeps a frozen copy of each request in `calls`. Its `assertComplete()` fails a test whose run left a scripted turn unused or asked for a turn the script lacks.

::::tabs
:::listing[Our SDK]{#mock-ours file="packages/sdk/examples/11-scripted-turns.ts" region="turns"}
::note[One scripted step per model call. The first is a call to `lookup_order`.]{#first-turn}
::note[The second step is the answer, in text.]{#second-turn}
::note[The run made one model call for each step.]{#records}
::note[`assertComplete()` throws when a scripted step was never used or a call came after the last one.]{#complete}
:::
:::listing[OpenAI Agents SDK]{#mock-openai file="verify/openai-agents-sdk/examples/05-approval-resume.ts" region="scripted-model"}
::note[One scripted step per model call. The first is a function call, built with `functionCall()`.]{#first-turn}
::note[The second step is the answer, built with `assistantMessage()`.]{#second-turn}
:::
:::listing[LangChain]{#mock-langchain file="verify/langchain/examples/03-human-in-the-loop.ts" region="fake-model"}
::note[`respondWithTools` queues a turn that calls a tool.]{#first-turn}
::note[`respond` queues a plain message. A call after the last queued turn throws.]{#second-turn}
:::
:::listing[Pi]{#mock-pi file="verify/pi/examples/08-triage-agent.ts" region="faux-script"}
::note[Each step is an assistant message. This one calls `lookup_customer`, and the next two, below it in the file, call `escalate` and `submit_triage`.]{#first-turn}
:::
:::listing[ADK]{#mock-adk file="verify/google-adk/examples/lib/check.ts" region="scripted-llm"}
::note[The harness stores a copy of each request, so a later change to the request cannot alter the record.]{#record}
::note[The script is a function from the request to the next response, so a test can answer by what the request holds.]{#play}
:::
::::

The seam decides what a passing test covers. OpenAI's testing guide is explicit: use `ScriptedModel` "when the test should exercise the SDK run loop, tools, handoffs, guardrails, sessions, retries, or streaming without depending on a model provider", and do not use it to test "provider request conversion, HTTP or WebSocket payloads, authentication headers" [@openai-agents-testing]. A mock inside the process leaves the real provider adapter unexercised, and the HTTP seam brings more of the stack under test, up to the CLI's own loop. A test at either seam still proves only that your code handles the answers you scripted. Four of these mocks are strict in the same direction: the AI SDK helper, OpenAI's `ScriptedModel`, LangChain's `fakeModel` and our own `ScriptedModel` each fail a run that asks for more turns than the script holds, so a loop that wanders shows up as a failing test and not a quiet pass [@openai-agents-testing; @langchain-unit-testing; @buildanagent-sdk-readme].

## A check proves the rule you wrote, so write rules an empty answer cannot pass

A football referee blows :analogy[a whistle]{#referee-whistle} at each broken rule and stays silent through everything else. A `check()` in this book behaves the same way. It states one rule, throws when the rule breaks, and says nothing about the rest of the game. [[lst:check-helper-ours]] is the whole helper that our SDK's examples share, [[lst:check-helper]] is the one from the AI SDK harness, and the other harnesses carry the same few lines. Each throws when its condition is false and prints a line when it holds.

::::tabs
:::listing[Our SDK]{#check-helper-ours file="packages/sdk/examples/lib/check.ts" region="check"}
::note[A false condition throws, so the first failed check stops the example.]{#fail}
::note[A true condition prints `ok`{checked=row-43} with its message, which is how a passing run reads.]{#ok}
:::
:::listing[AI SDK]{#check-helper file="verify/vercel-ai-sdk/examples/lib/check.ts" region="check"}
::note[A false condition throws, so the first failed check stops the example and the checks after it never run.]{#fail}
::note[A true condition prints `ok`{checked=row-17} with its message, which is how a passing run reads.]{#ok}
:::
::::

What a check can show is how your code behaves when the model answers as scripted: which tools it offered, which calls it ran and in what order, whether a gated call waited, and how many model calls the loop made. It cannot show that a real model would give those answers. It also cannot show what its author forgot to ask, and that gap hides the worst bugs, because a check that holds for the right behaviour may hold for no behaviour as well. [[paper:abc-agentic-benchmark-checklist]] found this in a published benchmark. [[paper:tau-bench]] grades an agent by whether the database ends in the right state and, optionally, whether the reply holds required text. Some of its tasks are intentionally unsolvable, so the right end state is no change, and an agent that does nothing passes them. The authors report that these tasks make up 38% of the airline subset and 6% of the retail subset, and that a do-nothing agent therefore passes that share of each, a result that holds as of the paper's August 2025 version [@abc-agentic-benchmark-checklist].

[[lst:weak-check-ours]] and [[lst:weak-check]] reproduce the mistake at small scale, on our SDK's `run()` and on the AI SDK's `generateText`. The scripted agent answers with an empty string. One check asks whether the agent answered, and it passes. The other asks whether the answer names the city, and it fails.

::::tabs
:::listing[Our SDK]{#weak-check-ours file="packages/sdk/examples/12-weak-check.ts" region="weak-and-strong"}
::note[This check holds for any string, so it holds for an agent that did nothing.]{#weak}
::note[This check holds only when the answer carries the content the task needed.]{#strong}
:::
:::listing[AI SDK]{#weak-check file="verify/vercel-ai-sdk/examples/14-weak-check.ts" region="weak-and-strong"}
::note[This check holds for any string, so it holds for an agent that did nothing.]{#weak}
::note[This check holds only when the answer carries the content the task needed.]{#strong}
:::
::::

Before you trust a check, ask what a do-nothing agent would do to it. If the check still passes, the check is the problem, and it needs a condition on the answer's content, on a side effect, or on a count of calls. The capstone in the next section checks all three kinds, and each of its checks says what has to be true. A referee knows only the rules that someone wrote down, and a match can go wrong in ways no rule names.

## A complete agent is two tools, a gate, a typed result and a cap, and the checks say which of them holds

The book's capstone is a support-triage agent, small enough to read in one sitting. Given a ticket, it looks up the customer's order, asks a person before it refunds anything, returns a record that matches a schema, and stops after a fixed number of steps. [[lst:capstone-ours]] is the version on our SDK and [[lst:capstone-ai]] is the AI SDK's, each in full. Both run offline against a scripted model, and their six notes mark the script, the gate, the typed result, the cap and two of the checks.

::::tabs
:::listing[Our SDK]{#capstone-ours file="packages/sdk/examples/13-triage-agent.ts" replay}
::note[The script: three turns, in order. The model looks the customer up, asks to escalate, and submits the triage record. `scripted()` puts them behind a model.]{#script}
::note[The gate. `escalate` waits for a person, and `lookup_customer` runs freely.]{#gate}
::note[The typed result. The final answer is a call to `submit_triage`, checked against the `Triage` schema.]{#typed}
::note[The cap. Each run stops after eight model calls, whatever the model asks for, and the resumed run gets a fresh eight.]{#cap}
::note[A check on a side effect. The escalation list is still empty while the run waits.]{#side-effect}
::note[A check on a count. The run made exactly the three model calls the script holds.]{#count}
:::
:::listing[AI SDK]{#capstone-ai file="verify/vercel-ai-sdk/examples/09-triage-agent.ts" replay}
::note[The script: three turns, in order. The model looks up the order, asks for a refund, and answers with the triage record as JSON.]{#script}
::note[The gate. `issueRefund` waits for a person, and `lookupOrder` runs freely.]{#gate}
::note[The typed result. The final answer must match the `Triage` schema.]{#typed}
::note[The cap. The loop stops after eight steps, whatever the model asks for.]{#cap}
::note[A check on a side effect. The refund list is still empty while the call waits.]{#side-effect}
::note[A check on a count. The run made exactly the three model calls the script holds.]{#count}
:::
::::

The checks come in the three kinds the last section recommended. Some read the content: the instructions arrive as the system message, both tools are offered, the final call asks for JSON, and the typed record's category is `billing` and its action is `refunded`. Some read a side effect: the refund list is empty while the call waits and holds one refund after the approval. One reads a count: the run made exactly three model calls. One check would still hold for the do-nothing agent of [[lst:weak-check]]: an agent that never calls the refund tool also has an empty refund list. The example therefore pairs that check with the one that says the refund ran exactly once after the approval. Our capstone pairs its checks the same way: its escalation list is empty while the run waits and holds exactly one reason after the approval, and it also reads the system prompt and counts the three model calls. The replay shows the same run from outside. There are three model requests and the checks sit between them, and the refund runs only after the person's answer, between the second request and the third. Our replay shows the same order.

Seven more capstones build a close cousin of that agent on the other SDKs. They look up a customer and gate an escalation, as ours does, where the AI SDK's looks up an order and gates a refund, and their tool names differ because each follows its own SDK's documentation. They agree on the shape and differ in the gate. [[lst:gate-ours]] and its seven neighbours show the lines that stop the risky tool in each SDK, and [[tbl:capstone-differences]] sets all nine side by side.

::::tabs
:::listing[Our SDK]{#gate-ours file="packages/sdk/examples/13-triage-agent.ts" region="gate"}
::note[An interceptor sees each call before it runs. `beforeToolCall` returns `ask` for `escalate`, so the run pauses with a signed request until a person answers.]{#gate}
:::
:::listing[OpenAI Agents SDK]{#gate-openai file="verify/openai-agents-sdk/examples/09-triage-agent.ts" region="gate"}
::note[A function on the tool decides whether a call needs approval. This one says yes to every call.]{#gate}
:::
:::listing[LangChain]{#gate-langchain file="verify/langchain/examples/10-triage-agent.ts" region="gate"}
::note[Middleware interrupts the graph before `escalate` and allows two decisions. The checkpointer below it holds the paused run.]{#gate}
:::
:::listing[Google ADK]{#gate-adk file="verify/google-adk/examples/08-triage-agent.ts" region="gate"}
::note[A flag on the tool. ADK asks for confirmation before the tool runs.]{#gate}
:::
:::listing[Cloudflare Agents]{#gate-cloudflare file="verify/cloudflare-agents/examples/09-triage-agent.ts" region="gate"}
::note[The same kind of flag, on a tool defined with the AI SDK's `tool()`. A person answers over the chat protocol.]{#gate}
:::
:::listing[Copilot SDK]{#gate-copilot file="verify/copilot-sdk/examples/09-triage-agent.ts" region="gate"}
::note[The permission handler returns no result for the escalation, so the request stays pending until a reviewer answers it.]{#gate}
:::
:::listing[Claude Agent SDK]{#gate-claude file="verify/claude-agent-sdk/examples/07-triage-agent.ts" region="gate"}
::note[The permission callback denies the escalation, and the read-only lookup never reaches it.]{#gate}
:::
:::listing[Pi]{#gate-pi file="verify/pi/examples/08-triage-agent.ts" region="gate"}
::note[An extension sees every tool call before it runs and blocks `escalate` with a reason that goes back to the model.]{#gate}
:::
::::

Two of the other seven do not pause. The Claude and Pi capstones deny or block the escalation outright, so no person decides anything, while the other five and ours stop the run and wait for an answer. Ours ends with the stop reason `awaiting_approval`, and the run resumes through `continueRun()` once the person's answer arrives. That difference follows each SDK's design, and the choice matters for the agent you build: a pause needs somewhere to keep the paused run, which the previous chapter covered, and a denial needs none.

:::table[The capstone's gate, typed result and step cap on our SDK and eight others]{#capstone-differences}
| SDK | The gate on the risky tool | The typed result | The step cap |
| --- | --- | --- | --- |
| Our SDK | `beforeToolCall` returning `ask` | `outputTool` | `maxSteps` of 8 for each run |
| AI SDK | `toolApproval` with `"user-approval"` | `Output.object` | `stopWhen` with `isStepCount(8)` |
| OpenAI Agents SDK | `needsApproval` on the tool | `outputType`{checked=row-35} | not set in the file |
| LangChain | `humanInTheLoopMiddleware` | `responseFormat`{checked=row-35} | `recursionLimit`{checked=row-35} of 12 |
| Google ADK | `requireConfirmation` | `outputSchema`{checked=row-35} with `outputKey`{checked=row-35} | not set in the file |
| Cloudflare Agents | `needsApproval` set to `true` | `Output.object` from `beforeTurn`{checked=row-35} | not set in the file |
| Copilot SDK | `onPermissionRequest` returning `no-result`{checked=row-35} | `sendAndWait`{checked=row-35} with a schema | not set in the file |
| Claude Agent SDK | `canUseTool` denying the call | `outputFormat`{checked=row-35} | `maxTurns`{checked=row-35} of 6 |
| Pi | a `tool_call` handler that blocks | a `submit_triage` tool that ends the run | not set in the file |
:::

Five of the eight other capstones set no step cap in the file, so those runs end when the model answers or when something else stops them. OpenAI, ADK and Cloudflare have defaults that apply, and Pi and Copilot have no cap you can set, so your code must end a runaway run there, as [[ch:stopping-and-structured-output]] explains. Ours sets a cap of eight model calls for each run, so a run resumed after a pause gets a fresh eight. The cap is the part of a first agent that is easiest to forget, because a scripted model never loops and a real one can.

## Exercises

1. **Add one assertion to the capstone, make it fail, then make it pass.** In `verify/vercel-ai-sdk/examples/09-triage-agent.ts`, add `check(JSON.stringify(asks[0].toolCall.input).includes("A-1"), "the approval request names the order the customer mentioned");` after the check that no refund ran before approval. Run `pnpm test` in `verify/vercel-ai-sdk` and confirm that it passes. Then change the scripted refund call to `orderId: "A-2"` and run the tests again. Before you run them, predict which check fails first, and whether the check on the refund list would have caught the wrong order before the approval. Read the failure, restore the file, and run the tests a last time. Which of the file's existing checks would still have passed with the wrong order? Restore the folder with `git checkout -- examples results` when you are done.
2. **Ask what a do-nothing agent does to your check.** In `verify/vercel-ai-sdk/examples/14-weak-check.ts`, write a third check on the empty answer that holds for it and tells you nothing, and a fourth that fails for it. Then pick any check in the capstone and script the model to answer with nothing. Does the check still pass? If so, name the check that would have caught it.
3. **Place a mock for a new SDK.** An SDK you have not used starts a program of its own to call the model, and its docs offer a setting for the base URL. Using [[fig:mock-seams]], say which of the three seams you would use, what would run for real in your test, and which bug would pass your test unnoticed.
