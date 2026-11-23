---
title: What the SDK is
description: The SDK runs an agent's loop over the gateway, so you write the tools and the prompt.
---

The SDK runs the loop of an agent. It calls a model, runs the tools the model asks for and stops when the work is done. You need this to decide whether it fits the agent you want to build.

## Two packages share one version

The gateway, `@buildanagent/gateway`, talks to model providers. It has adapters for Anthropic's Messages API and for servers that copy OpenAI's Chat Completions API. It streams every answer as one set of events and prices every call.

The SDK, `@buildanagent/sdk`, runs the loop over the gateway. Both packages always share one version.

## A run repeats model calls and tool calls until it ends

A run sends your input to the model. When the model's response asks for tools, the run calls them and sends their results back in the next model call. The run repeats that cycle until the model answers in text without calling a tool, and the run ends with the stop reason `done`.

::figure[One run, from your input to its stop reason]{id="run-loop" alt="The run calls the model and runs the tools it asks for, then returns the results to the model. When the model answers in text, the run ends done; any other stop reason ends it early."}

Five things can end a run sooner: a guard such as the step limit or the budget, a hook, a failed model call, an abort, or a tool call that waits for approval or asks you a question. [Stop reasons](/concepts/stop-reasons/) lists all nine.

## What a run gives you

- **A stream of events.** You print the model's text as it arrives and log each tool call.
- **A stop reason.** A failed model call or a broken tool never makes a run throw. The result says why the run ended.
- **Usage and cost.** Every result sums the tokens and the price of the run's model calls.
- **Guards.** A budget, a progress policy and a depth cap stop a runaway run.
- **Pauses for approval.** A gate can stop a tool call until a person answers, even in another process.
- **A test model.** `ScriptedModel`, from `@buildanagent/sdk/testing`, plays scripted answers, so your tests need no API key.

## What you bring

You bring the model adapter, made with your own API key, a system prompt and your tools. The tools call your own systems, such as an order store or a payment provider.

Next, [install the packages](/start/install/).
