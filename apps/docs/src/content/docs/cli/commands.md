---
title: Commands and exit statuses
description: What each buildanagent command does, how a script reads its exit status and where sessions are stored.
---

You will learn what each `buildanagent` command does and how a script reads its exit status. You need this to script the CLI, to chat with an agent or to find a stored session.

## Read the exit status

The exit status tells a script how a command ended. `run` reports how its turn stopped, and the stop reason is the reason a turn ended, such as `done`, an error or the budget:

- **0:** the turn ended `done`.
- **1:** the turn ended with any other stop reason.
- **3:** a call waits for a person. `run` never asks, so answer it with `resume`.

Every command uses status 2 for a command that could not run as given: a wrong command line, a missing key, model or session, or a session another process is writing. `chat` and `resume` exit 0 when input ends, whatever their last turn did, so a script reads their turns from the session instead.

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

## Fix a stuck lock or change the approval keys

Only one process writes a session at a time, and it holds the session's lock. `buildanagent session unlock <session> --force` removes the lock when you know its writer is gone. Without `--force` it removes nothing and exits 2, because two writers in one log would corrupt it.

Each pause for approval is signed with a key from a key ring, the set of signing keys the CLI keeps beside the sessions. `buildanagent keys rotate` adds a key and makes it current, and the older keys still check the requests they signed. `buildanagent keys prune` removes every older key that no waiting request names.

## Read the full help

`buildanagent --help` lists every command and option:

```console file="packages/cli/transcripts/help.txt"
```

## Serve the protocol with rpc

`buildanagent rpc` serves the harness's protocol to one client over standard input and output, one JSON-RPC message per line. It authenticates nobody, so run it only where you trust every process that can reach those streams. The [protocol quick start](/protocol/quick-start/) writes a client for it.

Next, look up every export in the [CLI API reference](/reference/cli/).
