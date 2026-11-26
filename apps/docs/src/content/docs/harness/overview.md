---
title: What the harness adds to the loop
description: The parts the harness wraps around the SDK's loop, the import path of each part and the page to read for it.
---

You will learn what the harness adds around the SDK's loop, which import path holds each part and which page to read next. You need this before you pick parts for an agent that must keep its sessions, handle long conversations and act on files.

The SDK's loop runs an agent until it stops and hands back the result. The harness wraps that loop with a session log, a context policy, a registry of tools, permissions, a sandbox and credentials kept outside it. An import path is the name you import a part from, such as `@buildanagent/harness/session`.

## A turn is one run, written into the log

`runTurn()` runs one turn: it passes one input to the SDK's `run()` and writes each event of the run into the session log as an entry. The input is written before the run starts, so a turn that stops before its first model call still leaves the question in the log.

The log is the harness's only state. Every later turn rebuilds its conversation from it, so a new process goes on where the last one stopped, and a person can read the log to see what the agent did. [Sessions](/harness/sessions/) explains the log.

## Each part has its own import path

Each part of the harness lives under its own import path, so you import only the parts you use. `createHarness()` comes from the `server` path and joins the parts you choose into one harness.

- **Sessions**, `@buildanagent/harness/session`: the log, its stores and locks, and `runTurn()`. See [Sessions](/harness/sessions/).
- **Context**, `@buildanagent/harness/context`: cuts long tool results, hides old ones and summarizes what outgrows the window. See [Context](/harness/context/).
- **Tools**, `@buildanagent/harness/tools` and `/mcp`: one registry of tools, the built-in tools and the clients for MCP servers. See [Tools](/harness/tools/).
- **Permissions**, `@buildanagent/harness/permissions`: decides each tool call with rules, modes and hooks.
- **Sandbox and credentials**, `@buildanagent/harness/sandbox` and `/credentials`: run commands in a confined workspace and keep credentials out of it.
- **Server**, `@buildanagent/harness/server`: builds the harness with `createHarness()` and serves clients over the protocol.
- **Extensions, memory and telemetry**, `@buildanagent/harness/extensions`, `/memory` and `/telemetry`: add hooks and tools, keep long-term memory and project the log to OpenTelemetry spans.

The `cloudflare`, `aws` and `vercel` paths hold the adapters that keep sessions on those platforms. The [API reference](/reference/harness/) documents every path, including the parts these guides do not cover yet.

## Turn a part off to see what it adds

Each removable part has a switch under `@buildanagent/harness/ablation`. Pass the switches to `createHarness()` and it turns the parts off, then records a hash of them in the session header. The log therefore shows which parts a session ran without. The session log, the permissions and the protocol have no switch, because they form the harness's fixed core.

Next, learn how [sessions](/harness/sessions/) keep a conversation.
