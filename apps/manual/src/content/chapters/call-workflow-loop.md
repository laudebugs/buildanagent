---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: Three support requests need three shapes of program, one model call, a fixed workflow and an agent loop, and one question picks between them. Who decides the next step, your code or the model?
opening: scenario
sources: [anthropic-building-effective-agents, ai-sdk-generate-text]
glossary: [agent]
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

## Exercises

1. Exercises follow once the chapter's sections are written.
