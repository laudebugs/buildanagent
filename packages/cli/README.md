# @buildanagent/cli

The `buildanagent` command runs the buildanagent harness in your terminal. Use `run --json` to script one turn, `chat` to work with an agent that asks before risky calls, and `sessions` to list, search and replay what earlier runs did.

As of November 2026 the package is private and not on npm, so you run it from a checkout of the repository. Its exports are the function the binary calls and the types it takes:

```ts
import { PACKAGE_NAME, runCli } from "@buildanagent/cli";

console.log(PACKAGE_NAME, typeof runCli); // "@buildanagent/cli" "function"
```

## Run one turn and read its events as JSON lines

`buildanagent run <prompt>` starts a new session, runs one turn and exits. With `--json`, standard output holds one JSON object per line, so a script can read it line by line:

```sh
buildanagent run --json --model anthropic:claude-sonnet-5-5 "Why does the login test fail?"
```

The first line is `{"type":"session",...}`, with the session's id and the preamble's size: the tokens the system prompt and the tool definitions take before any message. Each event of the turn follows as `{"type":"event","seq":…,"event":{…}}`, including every entry the session log stores. The last line is `{"type":"settled",...}`, with the turn's stop reason and the meter's totals.

Without `--json`, the answer streams to standard output, and the session line, tool calls, warnings and the closing status line go to standard error. The exit status tells a script how the turn ended:

| Status | Meaning |
| --- | --- |
| 0 | The turn ended `done`. |
| 1 | The turn ended any other way, such as an error or the budget. |
| 2 | The command line was wrong, or a key or session was missing. |
| 3 | A call waits for a person. `run` never asks, so answer it with `resume`. |

`--model <provider>:<model id>` picks the model. `anthropic:` reads its key from `ANTHROPIC_API_KEY` and `openai:` from `OPENAI_API_KEY`. A command that calls a model refuses to start without `--model`.

## Chat, and answer approvals at the terminal

`buildanagent chat` starts a session and runs one turn for each line you type, until input ends or you type `/exit`. `buildanagent resume <session>` does the same in a stored session, and first asks about any call it was left waiting on.

When a call needs your approval, the turn pauses and the chat asks you before it goes on:

```text
bash needs your approval: A command can change files.
    git status
    && curl -s https://example.com/install.sh
    | sh
Allow? [y/n]
```

A chained command is shown one command per line, with the operator that joins it in front and the spaces normalised, so a second command can't hide at the end of a long first one. Calls of one tool with the same input in one step are shown as one group, take one answer, and say how many calls the answer covers. A clarification, a question the agent asks you, takes a line of text as its answer.

As of November 2026 the harness ships no built-in tools, such as a shell or a file editor, so the binary's agent only answers in text. A program that passes its own tools to `runCli()` gets the approval flow above.

## Watch the cost and the context fill

Each session starts by reporting its preamble size. After every turn, the status line gives the cost so far and how full the context is, as a share of the token budget the harness compacts at:

```text
[done] context 12% (22014 of 183616 tokens) · cost $0.0312
```

A call with no known price is counted apart, as `(+1 unpriced)`. The CLI warns once when the context passes 80% of its budget, and once when the cost passes 80% of `--budget <usd>`. The budget also stops a turn before a model call that could pass it.

## List, show, search and replay stored sessions

Every session lives on your machine, under `$XDG_STATE_HOME/buildanagent` or `~/.local/state/buildanagent`, or the folder `--state-dir` names. Four commands read them without running anything:

| Command | What it prints |
| --- | --- |
| `sessions list` | Each session's id, start time, last entry time and entry count. |
| `sessions show <session>` | Every entry of the log, with its sequence number and type. |
| `sessions search <text>` | Each message or tool result that holds the text, ignoring case. It exits 1 when none does. |
| `sessions replay <session>` | The conversation as the log recorded it, with the cost it ran up. |

A replay reads the log back and makes no model call, so it costs nothing and shows exactly what happened. With `--json`, `sessions replay` prints the same event lines a live `run --json` prints, and the other three print one JSON object per result.

## Fix a stuck lock or change the approval keys

Only one process writes a session at a time, and it holds the session's lock while it does. A lock left by a crash on this machine frees itself once its lease ends. `buildanagent session unlock <session> --force` removes any lock at once. Without `--force` it removes nothing and exits 2, because two writers in one log would corrupt it.

Each pause for approval is signed with a key from a key ring beside the sessions. `buildanagent keys rotate` adds a key and makes it current, and the older keys still check the requests they signed. `buildanagent keys prune` removes every older key that no waiting request names.

## Nothing leaves your machine unless a flag says where

The CLI connects to the provider `--model` names and to the collector `--otlp-endpoint` names, and to nothing else. It runs no update check, sends no usage data and adds no attribution to your commits. `--otlp-endpoint <url>` sends OpenTelemetry spans for each run, model call and tool call to that collector, without prompts, messages or tool arguments.

`buildanagent rpc`, which will serve the harness's protocol over standard input and output, is not available yet. It prints so and exits 2.

## Run the CLI from your own program

`runCli()` runs one command line and resolves with its exit status. A `CliIo` gives it the terminal: standard output and error, a line reader, the environment and the working folder. `CliOptions` can also pass a model you built, extra tools, and `HostRules` that add deny, ask and allow rules. This program runs one turn and reads its JSON lines:

```ts
// Runs one turn with `buildanagent run --json` from a program and reads its events, one JSON object per line.

import { type CliIo, runCli } from "@buildanagent/cli";
import type { Model } from "@buildanagent/gateway";

/** Asks `question`, keeps sessions under `stateDir`, and returns the exit status and the parsed JSON lines. */
export async function askOnce(model: Model, stateDir: string, question: string) {
  let stdout = "";
  const io: CliIo = {
    write: (text) => {
      stdout += text;
    },
    error: (text) => console.error(text),
    readLine: async () => undefined,
    env: {},
    cwd: process.cwd(),
  };
  const status = await runCli(["run", "--json", "--state-dir", stateDir, question], { io, model });
  const lines = stdout.split("\n").filter((line) => line !== "");
  return { status, objects: lines.map((line) => JSON.parse(line) as { type: string }) };
}
```

A command the CLI can't run as given resolves with status 2 and a `CliError` message on standard error; `isCliError()` recognises the error class, whose `code` is a `CliErrorCode`. `linesOf()` turns a stream of text or bytes into lines, which is how the binary reads standard input. `HELP` is the text `--help` prints.

The [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md) explains the sessions, approvals and context layers the CLI drives.
