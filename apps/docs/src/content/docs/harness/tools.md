---
title: Tools live in one registry
description: How the harness registers tools from every source, offers some of them to a turn and gives a coding agent built-in tools that act through a sandbox.
---

You will register tools in one registry, choose which ones a turn offers and give a coding agent the built-in tools that act through a sandbox. You need this when your agent must act, not only answer.

A tool is a name, a description the model reads, an input schema and a function; [Tools](/concepts/tools/) explains the parts. The built-in tools are the tools the harness ships for files, commands and the web, and a sandbox is a confined place where commands run. The examples on this page also import the SDK and the gateway, so install them as [Install](/start/install/) shows.

## The registry holds every tool

The registry is the one place that names every tool, wherever it comes from. Permission rules, the session log and tool search, which lets the model look up tools that a request did not send, all read its description of each tool. This function registers two read-only tools over your own order store:

```ts file="packages/harness/examples/order-tools.ts" region="registry"
```

A registration names the tool's source. A tool you register yourself takes the source label `builtin`. The other sources are `extension`, `client` and `mcp:<server>`. The registry checks each name once, at registration: 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. A second tool with a taken name throws a `DuplicateToolError`. A tool from an extension or the client replaces a built-in of the same name only with `override: true`, and replaces nothing else.

## A turn offers only the tools you name

The registry holds every tool, and each turn's `tools` list picks the ones its requests send. This call offers `order_status` and hides `order_history`:

```ts file="packages/harness/examples/order-tools.ts" region="offer"
```

A name the registry lacks throws `invalid_turn_options` before the turn starts. If the model calls a registered tool that this turn did not offer, the call comes back as an error result. It says there is no tool by that name and lists the tools the model may use, and the loop goes on.

## The built-in tools act through a sandbox

A sandbox has a policy for the folders it may read and write and the hosts it may reach. `builtinTools()` returns the built-in tools for one sandbox, up to seven: `read`, `write`, `edit`, `bash`, `grep`, `glob` and `fetch`. The `fetch` tool needs an egress proxy, a program that sends the agent's web requests and keeps credentials out of the sandbox, so `builtinTools()` returns six without a proxy.

No built-in tool touches the host. Files go through the sandbox's file functions, commands through its `exec()`, and web requests through the proxy, so the backend and the list of allowed hosts decide what each call can reach. This code provisions a sandbox, registers its tools and builds the harness. The `spills` function lets `read` open the files that the [write cap](/harness/context/) saved, so the model can read a long command's whole output:

```ts file="packages/harness/examples/builtin-tools.ts" region="tools"
```

## MCP tools wait behind tool search

An MCP server is a program that offers tools over the Model Context Protocol, a standard way for an agent to reach them. The harness registers each MCP tool as `mcp__<server>__<tool>`, marks its output untrusted and sets its exposure to `deferred`. A deferred tool is absent from every request until the model calls `tool_search` and a query matches it. It is present in the requests after that.

Deferring keeps a server with many tools from filling every request with their definitions. Set `exposure: "direct"` on a server to send all of its tools every time.

Next, find a fix in [problems and fixes](/harness/problems-and-fixes/).
