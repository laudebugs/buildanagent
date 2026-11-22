---
layout: ../../layouts/Page.astro
title: The gateway, one transcript for any model
description: The gateway calls any model through one transcript and one stream format, and puts a cost on every message.
---

The gateway, `@buildanagent/gateway`, lets your agent call a model through one transcript and one stream format, so switching providers never changes your agent code. Use it directly to call a model, or through the SDK.

## What it does

- **Two adapters.** One speaks Anthropic's Messages API. The other speaks the Chat Completions API, to OpenAI and to servers that copy it.
- **A cost on every message.** The gateway prices each response from a catalog that you can replace, and an unknown price is `null`, never a guessed zero.
- **Retries before the stream starts.** A failed request is retried only before the model streams any output, so a retry never repeats text you already showed.
- **Your key and no other.** You pass an API key to each adapter. The gateway never reads one from the environment.
- **Transcripts that move between models.** A transcript recorded on one model replays on another, even from another provider.

## Install it

Install the alpha, and use Node 22 or later:

```bash
pnpm add @buildanagent/gateway@alpha
```

Next, follow the [docs](https://docs.buildanagent.fyi) to make a model, or see the [SDK](/packages/sdk/), which runs an agent's loop over the gateway.
