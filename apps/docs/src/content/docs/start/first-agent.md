---
title: Your first agent
description: Build an agent that looks up an order with a tool, streams its answer and reports why it stopped.
---

You will build an agent that answers questions about orders. It looks an order up with a tool, streams its answer as the model writes it and tells you why it stopped. You need this to see the whole loop run once.

## Define the tool

A tool is a name, a description the model reads, an input schema and a function. This tool looks an order up in your own order store and returns its status:

```ts file="packages/sdk/examples/lookup-order-tool.ts" region="tool"
```

The schema checks the model's arguments before your function runs, so a bad order number never reaches your store.

## Make a model

The loop needs a model, which binds one adapter to one model id. You make the adapter with your own key, so the gateway never guesses a provider:

```ts
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";

declare const apiKey: string; // from your secret store
const model = createModel({ adapter: anthropic({ apiKey }), id: "claude-opus-5-5" });
```

## Run the agent

`run()` starts the loop. It sends your system prompt and the question, runs each tool the model calls and sends the results back. It goes on until the model answers without calling a tool. Iterate the run to read its events as they stream:

```ts file="packages/sdk/examples/order-agent.ts" region="run"
```

## Read why the run stopped

A run ends with a result, not an exception. Its stop reason says whether the model finished, hit the step limit or failed, and the agent turns each case into a message:

```ts file="packages/sdk/examples/order-agent.ts" region="result"
```

Next, learn [what the stream carries](/concepts/transcript-and-stream/).
