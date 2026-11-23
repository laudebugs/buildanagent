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

## Six packages build on the gateway

The gateway and the SDK are two of the six `@buildanagent` packages. Each package imports only packages drawn below it, so the gateway, at the bottom, imports none of the others.

::figure[The six packages, each above the packages it imports]{id="package-map" alt="The CLI imports the harness, the harness imports the protocol and agent-safety, the protocol imports the SDK, and the SDK and agent-safety import the gateway."}

Each package imports these others:

- **`@buildanagent/sdk`**: the gateway.
- **`@buildanagent/agent-safety`**: the gateway.
- **`@buildanagent/protocol`**: the SDK and the gateway.
- **`@buildanagent/harness`**: the protocol, agent-safety, the SDK and the gateway.
- **`@buildanagent/cli`**: the harness, the protocol, the SDK and the gateway.

The figure draws an arrow only where no chain of arrows already leads. The arrow from the CLI to the harness therefore also stands for the CLI's imports of the protocol, the SDK and the gateway.

## Every export has a reference page

The docs generate a page for each export from its TSDoc, so a page always matches the code it describes. Browse the [gateway API](/reference/gateway/) or the [SDK API](/reference/sdk/), which list each entry point's functions, classes, interfaces and types.

Start with [your first agent](/start/first-agent/) if you have not built one yet.
