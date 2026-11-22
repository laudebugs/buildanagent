---
layout: ../layouts/Page.astro
title: Build agents you can test offline
description: buildanagent is a TypeScript gateway and SDK for building agents, with a scripted model that tests them without an API key.
---

buildanagent is two TypeScript packages for building an agent. A gateway talks to model providers, and an SDK runs the agent's loop over it. You write the tools and the prompt, and you test the agent offline, with no API key.

## Install the alpha

Both packages are alphas, so install them under the `alpha` tag:

```bash
pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha
```

## What you get

- **One transcript and one stream.** Your agent code stays the same when you switch providers.
- **A loop that ends with a stop reason.** A failed model call or a broken tool never makes a run throw.
- **Guards.** A dollar budget, a progress policy and a depth cap stop a runaway run.
- **Signed pauses for approval.** A gate can hold a tool call until a person answers, even in another process.
- **A scripted model.** Your tests play the model's answers back, so they need no API key and give the same result every run.

## Where to go next

Read about the [gateway](/packages/gateway/) or the [SDK](/packages/sdk/). Follow the [docs](https://docs.buildanagent.fyi) to build your first agent, or read the code on [GitHub](https://github.com/laudebugs/buildanagent).
