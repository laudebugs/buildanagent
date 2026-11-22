---
title: Test with ScriptedModel
description: Play scripted model answers into a run, so a test is strict, fast and needs no API key.
---

`ScriptedModel` plays back the answers you script, one for each model call. You use it to test an agent on your own machine, with no API key, and to get the same result every run.

## Script the model's answers

This test runs the order agent against two scripted answers. The first calls `lookup_order` and the second replies. It checks that the script ran out, then returns the agent's answer:

```ts file="packages/sdk/examples/offline-order-agent.ts" region="offline"
```

## A strict model fails when your test drifts

- **Too many calls throw.** A call past the last scripted answer throws, and the gateway turns the throw into a failed call, so the run ends with the stop reason `error`.
- **`assertComplete()` catches both drifts.** It throws if an answer was never used, or if a call came after the last answer. Call it when the test ends.
- **Requests are snapshots.** The model's `calls` holds a frozen copy of each request, so later changes to your conversation never show up in it.
- **Streams look real.** Text and tool-call input arrive in small pieces, so your streaming code runs as it would against a provider.

A scripted answer can also be a function that builds the response from the request, which lets a test read the conversation the model was sent.

Next, [keep every test offline](/testing/offline/).
