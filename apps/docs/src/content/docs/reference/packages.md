---
title: Packages and entry points
description: The two packages, their entry points and what each one exports.
---

Two packages hold everything these docs describe. You need this to find which entry point to import from.

## The gateway

`@buildanagent/gateway` talks to model providers. Import from these entry points:

- **`@buildanagent/gateway`**: `createModel()`, the message and event types, and the helpers that price and replay a conversation.
- **`@buildanagent/gateway/anthropic`**: the adapter for Anthropic's Messages API.
- **`@buildanagent/gateway/openai-chat`**: the adapter for OpenAI's Chat Completions API and for servers that copy it.
- **`@buildanagent/gateway/testing`**: mock transports and the stream check.
- **`@buildanagent/gateway/testing/setup`**: the import that keeps a test file offline.

## The SDK

`@buildanagent/sdk` runs the loop. Import from these entry points:

- **`@buildanagent/sdk`**: `run()`, `continueRun()`, `defineTool()`, signers and the hook types.
- **`@buildanagent/sdk/otel`**: an observer that exports a run as OpenTelemetry spans.
- **`@buildanagent/sdk/testing`**: `ScriptedModel` and the doubles that stand in for an approver and a tool server.

## The six packages form one stack

The gateway and the SDK are two of the six `@buildanagent` packages. Each package imports only packages drawn below it, so the gateway, at the bottom, imports none of the others. The figure labels each package by its name without the `@buildanagent/` scope.

::figure[The six packages, each above the packages it imports]{id="package-map" alt="The six packages stack with the gateway at the bottom and the CLI at the top. Each package imports only packages below it. The arrows run from the CLI to the harness, from the harness to the protocol and agent-safety, from the protocol to the SDK, and from the SDK and agent-safety to the gateway."}

Each entry in this list names the packages that package imports. The gateway imports none:

- **`@buildanagent/sdk`**: the gateway.
- **`@buildanagent/agent-safety`**: the gateway.
- **`@buildanagent/protocol`**: the SDK and the gateway.
- **`@buildanagent/harness`**: the protocol, agent-safety, the SDK and the gateway.
- **`@buildanagent/cli`**: the harness, the protocol, the SDK and the gateway.

The figure draws an arrow only where no chain of arrows already leads. The arrow from the CLI to the harness also stands for the CLI's imports of the protocol, the SDK and the gateway.

## Every export has a reference page

The docs generate a page for each export from its TSDoc, so every page matches the code it describes. Browse a package's API reference to see its entry points and exports:

- [Gateway API](/reference/gateway/) (`@buildanagent/gateway`)
- [SDK API](/reference/sdk/) (`@buildanagent/sdk`)
- [Agent safety API](/reference/agent-safety/) (`@buildanagent/agent-safety`)
- [Protocol API](/reference/protocol/) (`@buildanagent/protocol`)
- [Harness API](/reference/harness/) (`@buildanagent/harness`)
- [CLI API](/reference/cli/) (`@buildanagent/cli`)

Start with [your first agent](/start/first-agent/) if you have not built one yet.
