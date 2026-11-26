---
title: CLI quick start
description: Install the buildanagent command, check that it runs and run one turn from your own program.
---

You will install the `buildanagent` command, check that it runs and run one turn from a program of your own. You need this to script the harness from a terminal or a test.

## Install the command

The CLI needs Node 22.19 or later. Install it with the `alpha` tag, which npm serves for every release until the first stable one:

```bash
pnpm add @buildanagent/cli@alpha
```

The package installs the `buildanagent` command, which `pnpm exec buildanagent` runs from your project. This is what `--help` prints:

```console file="packages/cli/transcripts/help.txt"
```

## Run one turn from a program

`runCli()` runs one command line and resolves with its exit status. A `CliIo` gives it a terminal: where output goes, a line reader, the environment and the working folder. This function runs `run --json` on a model you pass in and parses the output, one JSON object per line:

```ts file="packages/cli/examples/run-json.ts"
```

Make the model the way [your first agent](/start/first-agent/) does. The command line always names a model with `--model`, but a program can hand `runCli()` a model it built.

## Read the result

The first line is `{"type":"session",...}` with the session's id. Each event of the turn follows, and the last line is `{"type":"settled",...}` with the stop reason and the cost. The exit status says how the turn ended: 0 for `done`, 1 for any other stop reason and 3 when a call waits for a person.

## See why a command refuses to run

A command that calls a model refuses to start without `--model`. Exit status 2 means the command could not run as given, and the message says why:

```console file="packages/cli/transcripts/no-model.txt"
```

A model needs its provider's key, read from `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Without the key, the command exits 2 again:

```console file="packages/cli/transcripts/no-key.txt"
```

Next, see every [command and exit status](/cli/commands/).
