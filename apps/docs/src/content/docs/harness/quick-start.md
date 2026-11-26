---
title: Harness quick start
description: Run two turns of one conversation on a harness that writes each turn to a log on disk, then read the log back.
---

You will run two turns of one conversation on a harness that writes every turn to a log on disk. You need this when your agent must remember a conversation between turns, and between processes.

## Install the packages

The packages need Node 22.19 or later. The example imports a type from the gateway, so install both packages with the `alpha` tag, which npm serves for every release until the first stable one:

```bash
pnpm add @buildanagent/harness@alpha @buildanagent/gateway@alpha
```

The harness also needs a model to call. [Your first agent](/start/first-agent/) shows how to make one from your own key. The example takes the model as an argument, so it never reads a key itself.

## Build the harness

A harness wraps the SDK's loop. You give it a registry of the tools the model may call, the model, and a system prompt, the standing instruction that starts every request. This harness has no tools yet:

```ts file="packages/harness/examples/quick-start.ts" region="harness"
```

## Open a session

A session is the log of one conversation. Its key is a user id and a session id together, so two users can each have a session named `chat-1`. Three parts hold the log. A store writes the entries to files, an index remembers which file is current, and a lock lets one process write at a time. This code puts all three in one folder:

```ts file="packages/harness/examples/quick-start.ts" region="session"
```

The store writes one JSON line for each entry, to `sessions/ada/chat-1.jsonl` when the key is `ada` and `chat-1`. Every line carries its own id and the id of the entry it follows, so the lines form a chain.

## Run two turns

A turn is one input and everything the agent does until it stops: the model calls, the tool calls and the answer. `runTurn()` runs one turn and writes it into the log. The second turn sends only its question, and the harness rebuilds the earlier conversation from the log:

```ts file="packages/harness/examples/quick-start.ts" region="turns"
```

The second request to the model carries three messages: the first question, its answer and the new question. The example closes the session in a `finally` block, which releases the lock.

## Read the log

`session.playback()` yields the entries in order and reads the log without calling a model:

```ts file="packages/harness/examples/quick-start.ts" region="read"
```

After two turns the log holds 15 entries. The first turn starts with three entries that the second turn does not repeat: `session_header` records the versions that ran, `env_stamp` records the environment, and `loadout` records the model and the tools. Each turn then writes the same six entries:

- `message_block`: the input you sent, written before the model runs.
- `turn_start`: the system prompt the turn used.
- `message_block`: the model's answer.
- `message_end`: the close of that message, with its model and stop reason.
- `usage`: the tokens and the cost of the model call.
- `turn_end`: the turn's stop reason and its step count.

A new process can open the same key with the same folder and run a third turn. The harness rebuilds the conversation from these 15 entries, so the model answers as if the process had never stopped.

Next, see [what the harness adds to the loop](/harness/overview/).
