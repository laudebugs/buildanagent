---
title: Packages and entry points
description: The two packages, their entry points and what each one exports.
---

Two packages hold everything these docs describe. Read this page to find which entry point to import from.

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

Start with [your first agent](/start/first-agent/) if you have not built one yet.
