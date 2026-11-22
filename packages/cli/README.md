# @buildanagent/cli

The `buildanagent` command runs the buildanagent harness in your terminal. Use `run --json` to script one turn, `chat` to work with an agent that asks before risky calls, and `sessions` to list, search and replay your stored sessions.

As of November 2026 the package is private and not on npm, so you run it from a checkout of the repository. The package exports `runCli()`, which the binary calls, and the helpers and types around it. [Run the CLI from your own program](#run-the-cli-from-your-own-program) shows how to call it.

## Run one turn and read its events as JSON lines

`buildanagent run <prompt>` starts a new session, runs one turn and exits. With `--json`, standard output holds one JSON object per line, so a script can read it line by line:

```sh
buildanagent run --json --model anthropic:claude-sonnet-5-5 "Why does the login test fail?"
```

The first line is `{"type":"session",...}`. It holds the session's id and the preamble's size, the tokens the system prompt and the tool definitions take before any message. Each event of the turn follows as `{"type":"event","seq":…,"event":{…}}`, including every entry the session log stores. The last line is `{"type":"settled",...}`, with the turn's stop reason and the meter's totals.

Without `--json`, the answer streams to standard output, and the session line, tool calls, warnings and the closing status line go to standard error. The exit status tells a script how the turn ended:

| Status | Meaning |
| --- | --- |
| 0 | The turn ended `done`. |
| 1 | The turn ended any other way, such as an error or the budget. |
| 2 | The command could not run as given: a wrong command line, a missing key, model or session, a session another process is writing, or a collector that refused the spans. Every `CliError` exits 2. |
| 3 | A call waits for a person. `run` never asks, so answer it with `resume`. |

`--model <provider>:<model id>` picks the model. `anthropic:` reads its key from `ANTHROPIC_API_KEY` and `openai:` from `OPENAI_API_KEY`. A command that calls a model refuses to start without `--model`.

## Chat, and answer approvals at the terminal

`buildanagent chat` starts a session and runs one turn for each line you type, until input ends or you type `/exit` or `/quit`. `buildanagent resume <session>` does the same in a stored session, and first asks about any call it was left waiting on.

When a call needs your approval, the turn pauses and the chat asks you before it goes on:

```text
bash needs your approval: A command can change files.
    git status
    && curl -s https://example.com/install.sh
    | sh
Allow? [y/n]
```

The chat shows a chained command one command per line, with the operator that joins it in front and the spaces normalised. A second command can't hide at the end of a long first one. If a quote or parenthesis never closes, the prompt adds a warning that the last line may hold more than one command. Any other input fields follow as one line of JSON. Waiting calls of one tool with the same input are shown as one group, take one answer, and say how many calls the answer covers. A clarification, a question the agent asks you, takes a line of text as its answer.

As of November 2026 the harness ships no built-in tools, such as a shell or a file editor, so the binary's agent only answers in text. A program that passes its own tools to `runCli()` gets the approval flow above.

## Watch the cost and the context fill

Each session starts by reporting its preamble size. After every turn, the status line gives the cost so far and how full the context is, as a share of the token budget the harness compacts at:

```text
[done] context 12% (22014 of 183616 tokens) · cost $0.0312
```

A call with no known price is counted apart, as `(+1 unpriced)`. The CLI warns once when the context passes 80% of its budget. `--budget <usd>` caps each turn, not the session: a turn, and each resume after you answer a request, may spend up to that amount. The CLI warns once a turn when its spend passes 80% of the budget. It hands the amount to the harness as each turn's `budgetUsd`, and the [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md) says what the harness does with it.

## List, show, search and replay stored sessions

Every session lives on your machine, under `$XDG_STATE_HOME/buildanagent` or `~/.local/state/buildanagent`, or the folder `--state-dir` names. Four commands read them without running anything:

| Command | What it prints |
| --- | --- |
| `sessions list` | Each session's id, start time, last entry time and entry count. |
| `sessions show <session>` | Every entry of the log, with its sequence number and type. |
| `sessions search <text>` | Scans every stored session for each message or tool result that holds the text, ignoring case. Each hit shows the session id, the sequence number and who said it. It exits 1 when none does. |
| `sessions replay <session>` | The conversation as the log recorded it, with the cost it ran up. |

A replay reads the log back and makes no model call, so it costs nothing and shows exactly what happened. With `--json`, `sessions replay` prints one `{"type":"event"}` line per log entry, each holding an `entry_appended` event, then one `{"type":"replayed"}` line with the entry count and the meter. A live `run --json` prints `entry_appended` lines like these too, among its streaming events such as `text_delta`, but a replay has no streaming events to print. The other three commands print one JSON object per result.

## Fix a stuck lock or change the approval keys

Only one process writes a session at a time, and that process holds the session's lock. A lock left by a crash on this machine frees itself once its lease ends. `buildanagent session unlock <session> --force` removes any lock at once. Without `--force` it removes nothing and exits 2, because two writers in one log would corrupt it.

Each pause for approval is signed with a key from a key ring beside the sessions. `buildanagent keys rotate` adds a key and makes it current, and the older keys still check the requests they signed. `buildanagent keys prune` removes every older key that no waiting request names.

## Nothing leaves your machine except the model call and the collector you name

The CLI connects to the provider `--model` names and to the collector `--otlp-endpoint` names, and to nothing else. It runs no update check, sends no usage data and adds no attribution to your commits. `--otlp-endpoint <url>` sends OpenTelemetry spans for each run, model call and tool call to that collector, without prompts, messages or tool arguments.

## Serve the protocol to another program with `rpc`

`buildanagent rpc` serves the harness's protocol to one client over standard input and output, one JSON-RPC 2.0 message per line. Use it to drive the harness from another process or language: an editor, a test runner or a script. The command takes the same `--model`, `--state-dir`, `--budget` and `--otlp-endpoint` flags as `run`, and refuses to start without `--model`:

```sh
buildanagent rpc --model anthropic:claude-sonnet-5-5
```

`rpc` authenticates nobody: whoever holds its standard input and output acts as the dispatcher's user, and a `Resolution.by` field is passed on as the client sent it. Run it only where you trust every process that can reach those streams.

The [protocol README](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/README.md) lists every method. The client sends `initialize`, then `session/create` or `session/open`, then `turn/start`, and waits for each response before it sends the next command. The server writes each command's response, the session's `event` notifications and one `turn/settled` per turn to standard output:

```text
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"my-editor","version":"1.0.0"},"capabilities":[]}}
→ {"jsonrpc":"2.0","id":2,"method":"session/create","params":{"cwd":"/work"}}
→ {"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"session":"<id from 2>","input":[{"type":"text","text":"Why does the login test fail?"}]}}
← {"jsonrpc":"2.0","method":"event","params":{"session":"…","seq":4,"event":{…}}}
← {"jsonrpc":"2.0","method":"turn/settled","params":{"session":"…","turn":"…","result":{"stopReason":"done",…}}}
```

Standard output carries protocol lines and nothing else. The transport's own diagnostics, such as a line it could not read, go to standard error. A call that needs approval reaches the client as an `approval/request`, which the client answers with its decision. The paused turn settles as `awaiting_approval`, and the run the answer resumes settles again on its own.

Keep standard input open until the turn's `turn/settled` arrives: the command exits 0 when input closes, and it answers every command it has read but doesn't wait for a running turn. It also ends if the server closes the connection.

## Run the CLI from your own program

`runCli()` runs one command line and resolves with its exit status. A `CliIo` gives it the terminal: standard output and error, a line reader, the environment and the working folder. `CliOptions` can also pass a model you built, extra tools, and `HostRules` that add deny, ask and allow rules. The tools run in process: the CLI has no client side for a `client_request` tool, so a call to one fails with an error the model reads. `PACKAGE_NAME` is the package's name. This program runs one turn and reads its JSON lines:

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

A command the CLI can't run as given resolves with status 2 and a `CliError` message on standard error; `isCliError()` recognises the error class, whose `code` is a `CliErrorCode`. `linesOf()` turns a stream of text or bytes into lines, which is how the binary reads standard input. `HELP` is the text `--help` prints. `rpc` reads the standard streams as bytes from the `CliIo`'s `streams`, a `CliStreams` pair of Node or Web streams. Without them it exits 2 with the code `no_streams`.

The [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md) explains the sessions, approvals and context layers the CLI drives.
