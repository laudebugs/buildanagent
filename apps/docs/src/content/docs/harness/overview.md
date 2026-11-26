---
title: What the harness adds to the loop
description: The parts the harness wraps around the SDK's loop, the import path of each part and the page to read for it.
---

You will learn what the harness adds around the SDK's loop and which import path, the package name you import a part from, holds each part. You need this before you pick parts for an agent that must keep its sessions, handle long conversations and act on files.

The SDK's loop runs an agent until it stops and hands back the result. The harness wraps that loop with a session log, which records each conversation, and a context policy, the rules that cut or summarize what the model reads. It adds a registry of tools and permissions that decide each tool call. It also adds a sandbox, a confined place where commands run, and keeps credentials such as API keys outside it.

## A turn is one run, written into the log

`runTurn()` runs one turn: it passes one input to the SDK's `run()` and writes each event of the run into the session log as an entry. The input is written before the run starts, so a turn that stops before its first model call still leaves the question in the log.

The log holds the conversation, and every later turn rebuilds it from the log. A new process therefore goes on where the last one stopped, and a person can read the log to see what the agent did. [Sessions](/harness/sessions/) explains the log.

## Each part has its own import path

Each part of the harness lives under its own import path, so you import only the parts you use. `createHarness()` comes from the `server` import path and joins the parts you choose into one harness.

- **Sessions**, `@buildanagent/harness/session`: the log, its stores and locks, and `runTurn()`. See [Sessions](/harness/sessions/).
- **Context**, `@buildanagent/harness/context`: cuts long tool results, hides old ones and summarizes what outgrows the window. See [Context](/harness/context/).
- **Tools**, `@buildanagent/harness/tools` and `/mcp`: one registry of tools, the built-in tools and the clients for MCP servers, programs that offer tools over the Model Context Protocol. See [Tools](/harness/tools/).
- **Permissions**, `@buildanagent/harness/permissions`: decides each tool call with rules, modes and hooks. See [Permissions](/harness/permissions/).
- **Sandbox and credentials**, `@buildanagent/harness/sandbox` and `/credentials`: run commands in a confined workspace and keep credentials out of it. See [Sandbox and credentials](/harness/sandbox/).
- **The `server` import path**, `@buildanagent/harness/server`: builds the harness with `createHarness()` and serves clients over the protocol, the messages that a client, such as an editor or the CLI, uses to drive a harness. See [Server and clients](/harness/server/) and [Protocol](/protocol/quick-start/).
- **Extensions, memory and telemetry**, `@buildanagent/harness/extensions`, `/memory` and `/telemetry`: add hooks and tools, keep long-term memory and project the log to OpenTelemetry spans. See [Extensions](/harness/extensions/) for the extensions.

The `cloudflare` and `vercel` paths and the `aws/dynamodb`, `aws/scheduler` and `aws/secrets-manager` paths hold the adapters that run the harness on those platforms, such as session stores, locks and secret storage. The [API reference](/reference/harness/) documents every path, including the parts these guides do not cover yet.

## Turn a part off to see what it adds

An ablation switch turns a part on or off, so you can measure what the part adds. Each removable part has one under `@buildanagent/harness/ablation`. Pass the switches to `createHarness()` and it records a hash of them in the session header, so the log shows which parts a session ran without. It also turns off the matching parts, from MCP tools to completion checks. The [API reference](/reference/harness/buildanagent/harness/ablation/) lists the switches.

The context layers are the exception, because `createHarness()` cannot reach into a policy you built. Pass `layers: ablation.context` to `createContextPolicy()` as well. Without that option the header's hash says the layers were off while they ran. The session log, the permissions and the protocol have no switch, because they form the harness's fixed core.

Next, learn how [sessions](/harness/sessions/) keep a conversation.
