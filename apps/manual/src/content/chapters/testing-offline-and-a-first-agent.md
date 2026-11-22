---
title: "Testing offline, and a first complete agent"
summary: A mock model replaces the provider so a test needs no key and gives the same answer every run. This chapter shows where each of eight SDKs lets a mock in, what a check() on a mocked run can and cannot prove, and one small support-triage agent written eight ways.
opening: scenario
sources: [ai-sdk-testing, openai-agents-testing, langchain-unit-testing, pi-ai-readme, abc-agentic-benchmark-checklist]
glossary: [mock-model]
switchTo: [B18, B19]
---

It is ten to five on a Friday, and you have reworded one line of your agent's instructions. You run the tests. They call a real model, take a minute, cost a few cents and pass. You run them again before you merge, and one fails, though nothing changed between the runs. The AI SDK's testing guide names the cause: "Testing language models can be challenging, because they are non-deterministic and calling them is slow and expensive" [@ai-sdk-testing]. A test that fails one run in ten teaches your team to ignore failures, and a test you cannot afford to run on every push stops guarding anything.

A mock model removes the model from the test, so the same code gives the same answer on every run, with no key and no bill. That is the first half of the problem. The second half is knowing what a passing test then proves, which is less than it seems. This chapter shows where each of eight SDKs lets a mock in, what an assertion on a mocked run can and cannot show, and one small support-triage agent that the book writes on each SDK, so you can run a complete agent offline.

## A mock replaces the provider at one of three seams, and the seam decides what a test exercises

Every mock does two jobs. It answers each model call with a turn someone scripted in advance, and it records the request that came in, so a test can check what the code sent. The SDKs differ in where the mock plugs in. [[fig:mock-seams]] shows the three places.

:::figure[Where each harness's mock sits: an object in your process, a shim inside workerd, or an HTTP API behind a real CLI]{#mock-seams}
::svg{alt="Three rows of three boxes joined by arrows, the last box in each row marked as the mock. Row one, in your process for the AI SDK, OpenAI, LangChain, Pi and ADK: your code, the SDK's loop, a mock model object. Row two, inside workerd for Cloudflare: your agent class, a provider shim, a mock model. Row three, over HTTP for the Claude Agent SDK and the Copilot SDK: your code, the real CLI or runtime, a mock API on 127.0.0.1."}
:::

Five of the eight harnesses swap the model object inside the process. The AI SDK's examples use `MockLanguageModelV4`{checked=row-6}, OpenAI's use `ScriptedModel`, LangChain's use `fakeModel`, Pi's use the faux provider from pi-ai, and ADK's use a `ScriptedLlm` that our harness wrote, because ADK 2.5.0 ships no test model [@ai-sdk-testing; @openai-agents-testing; @langchain-unit-testing; @pi-ai-readme]. Cloudflare's agents run inside workerd, Cloudflare's local Workers runtime, so its harness cannot hand them an object. Instead the bundler resolves each provider package to a shim that returns the same AI SDK mock model. The Claude Agent SDK and the Copilot SDK have no model object to replace at all, because each spawns a program, the `claude`{checked=row-9} CLI or the Copilot runtime, that makes the model call. Their harnesses point that program at a mock Anthropic Messages API on `127.0.0.1`, so the program's real loop, permission checks and hooks run against scripted answers.

The four listings that follow show how the in-process mocks are scripted. Each plays one turn that calls a tool and one that answers in text.

::::tabs
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
::note[The harness copies each request before the script sees it, so a later change to the request cannot alter the record.]{#record}
::note[The script is a function from the request to the next response, so a test can answer by what the request holds.]{#play}
:::
::::

The seam decides what a passing test covers. OpenAI's testing guide is explicit: use `ScriptedModel` "when the test should exercise the SDK run loop, tools, handoffs, guardrails, sessions, retries, or streaming without depending on a model provider", and do not use it to test "provider request conversion, HTTP or WebSocket payloads, authentication headers" [@openai-agents-testing]. A mock inside the process leaves the real provider adapter unexercised, and the HTTP seam brings more of the stack under test, up to the CLI's own loop. A test at either seam still proves only that your code handles the answers you scripted. Three of these mocks are strict in the same direction: the AI SDK helper, OpenAI's `ScriptedModel` and LangChain's `fakeModel` each fail a run that asks for more turns than the script holds, so a loop that wanders shows up as a failing test and not a quiet pass [@openai-agents-testing; @langchain-unit-testing].

## A check proves the rule you wrote, so write rules an empty answer cannot pass

A football referee blows :analogy[a whistle]{#referee-whistle} at each broken rule and stays silent through everything else. A `check()` in this book behaves the same way. It states one rule, throws when the rule breaks, and says nothing about the rest of the game. [[lst:check-helper]] is the whole helper from the AI SDK harness, and the other harnesses carry the same few lines.

:::listing[`check()` throws when its condition is false and prints a line when it holds]{#check-helper file="verify/vercel-ai-sdk/examples/lib/check.ts" region="check"}
::note[A false condition throws, so the first failed check stops the example and the checks after it never run.]{#fail}
::note[A true condition prints `ok`{checked=row-17} with its message, which is how a passing run reads.]{#ok}
:::

What a check can show is how your code behaves when the model answers as scripted: which tools it offered, which calls it ran and in what order, whether a gated call waited, and how many model calls the loop made. It cannot show that a real model would give those answers. It also cannot show what its author forgot to ask, and that gap hides the worst bugs, because a check that holds for the right behaviour may hold for no behaviour as well. The Agentic Benchmark Checklist paper found this in a published benchmark. τ-bench grades an agent by whether the database ends in the right state and, optionally, whether the reply holds required text. Some of its tasks are intentionally unsolvable, so the right end state is no change, and an agent that does nothing passes them. The authors report that these tasks make up 38% of the airline subset and 6% of the retail subset, and that a do-nothing agent therefore passes that share of each, a result that holds as of the paper's August 2025 version [@abc-agentic-benchmark-checklist].

[[lst:weak-check]] reproduces the mistake at small scale. The scripted agent answers with an empty string. One check asks whether the agent answered, and it passes. The other asks whether the answer names the city, and it fails.

:::listing[A weak check passes on an empty answer, and a strong check does not]{#weak-check file="verify/vercel-ai-sdk/examples/14-weak-check.ts" region="weak-and-strong"}
::note[This check holds for any string, so it holds for an agent that did nothing.]{#weak}
::note[This check holds only when the answer carries the content the task needed.]{#strong}
:::

Before you trust a check, ask what a do-nothing agent would do to it. If the check still passes, the check is the problem, and it needs a condition on the answer's content, on a side effect, or on a count of calls. The capstone in the next section checks all three kinds, and each of its checks says what has to be true. A referee knows only the rules that someone wrote down, and a match can go wrong in ways no rule names.

## Exercises

1. Placeholder.
