---
title: Commands and exit statuses
description: What each buildanagent command does, how a script reads its exit status and where sessions are stored.
---

You will learn what each `buildanagent` command does and how a script reads its exit status. You need this to script the CLI, to chat with an agent or to find a stored session.

## Read the exit status

The exit status tells a script how a command ended:

- **0:** the turn ended `done`.
- **1:** the turn ended any other way, such as an error or the budget.
- **2:** the command could not run as given: a wrong command line, a missing key, model or session, or a session another process is writing.
- **3:** a call waits for a person. `run` never asks, so answer it with `resume`.

## Run, chat and resume

`buildanagent run <prompt>` starts a session, runs one turn and exits. `buildanagent chat` runs one turn for each line you type, until input ends or you type `/exit` or `/quit`. `buildanagent resume <session>` chats in a stored session and first asks about any call it was left waiting on. When a call needs your approval, the chat pauses and asks before it goes on.

## Read stored sessions

Sessions live on your machine, in the folder `--state-dir` names or in `$XDG_STATE_HOME/buildanagent`, or `~/.local/state/buildanagent`. Four commands read them without a model call:

- **`sessions list`** prints each session's id, start time, last entry time and entry count.
- **`sessions show <session>`** prints every entry of the log, with its sequence number and type.
- **`sessions search <text>`** prints each message or tool result that holds the text, and exits 1 when none does.
- **`sessions replay <session>`** prints the conversation as the log recorded it, with its cost.

On a machine with no sessions, `sessions list` says so on standard error and exits 0:

```console file="packages/cli/transcripts/sessions-empty.txt"
```

## Serve the protocol with rpc

`buildanagent rpc` serves the harness's protocol to one client over standard input and output, one JSON-RPC message per line. It authenticates nobody, so run it only where you trust every process that can reach those streams. The [protocol quick start](/protocol/quick-start/) writes a client for it.

Next, look up every export in the [CLI API reference](/reference/cli/).
