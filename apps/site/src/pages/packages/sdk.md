---
layout: ../../layouts/Page.astro
title: The SDK, the agent loop with tools and guards
description: The SDK runs an agent's loop over the gateway, with tools, guards, signed approvals and a scripted test model.
---

The SDK, `@buildanagent/sdk`, runs your agent's loop over the gateway. It calls the model, runs the tools the model asks for and stops when the work is done. Its testing entry point gives you a scripted model, so you can test the agent offline.

## What it does

- **A stream of events.** You print the model's text as it arrives and log each tool call.
- **A stop reason for every run.** A failed model call or a failing tool ends the run with a result that says why, and never throws.
- **Tools with checked inputs.** The loop validates the model's arguments against your schema, and a bad call returns an error the model can fix.
- **Guards.** A dollar budget, a progress policy and a depth cap stop a runaway run.
- **Signed approvals.** A gate can pause a tool call, and a signed request lets any process that holds the key resume it.
- **A scripted model.** `ScriptedModel` plays back the answers you script and fails when your test drifts from the script.

## Install it

Install the SDK and the gateway under the alpha tag, and use Node 22.19 or later:

```bash
pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha
```

Next, build your first agent with the [docs](https://docs.buildanagent.fyi), or read about the [gateway](/packages/gateway/) that the SDK runs on.
