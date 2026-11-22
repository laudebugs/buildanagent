/**
 * `runCli()`: reads the command line, runs one command and returns its exit status. A mistake in the command line is
 * reported with the help and exits 2; any other `CliError` is reported on one line and exits 2 as well, because each
 * is something the caller can fix before running again.
 */
import { parseArgs } from "./args.js";
import { chatCommand, resumeCommand } from "./commands/chat.js";
import { keysCommand } from "./commands/keys.js";
import { rpcCommand } from "./commands/rpc.js";
import { runCommand } from "./commands/run.js";
import { sessionsCommand } from "./commands/sessions.js";
import { unlockCommand } from "./commands/unlock.js";
import { CliError, isCliError } from "./errors.js";
import { statePaths, stateRoot } from "./host.js";
import type { CliOptions, CommandContext } from "./options.js";

/** The help `--help` prints. */
export const HELP = `Usage: buildanagent <command> [options]

Runs the buildanagent harness in a terminal. Nothing leaves this machine unless
--model names a provider or --otlp-endpoint names a collector.

Commands:
  run <prompt>                Run one turn and exit: 0 when done, 3 when it waits
                              for a person, 1 otherwise.
  chat                        Start a session and chat, one line per turn.
  resume <session>            Chat in a stored session, answering what it waits on.
  sessions list               List the stored sessions.
  sessions show <session>     Print every entry of a session's log.
  sessions search <text>      Find the messages that hold a text.
  sessions replay <session>   Play a session back from its log, with no model call.
  session unlock <session> --force
                              Remove a session's writer lock.
  keys rotate                 Add a new approval key and make it current.
  keys prune                  Remove the approval keys no waiting request names.
  rpc                         Serve the protocol as JSON-RPC lines over standard
                              input and output, until input ends.

Options:
  --model <provider>:<id>     The model to run, such as anthropic:claude-sonnet-5-5
                              (key from ANTHROPIC_API_KEY) or openai:<id>
                              (key from OPENAI_API_KEY).
  --json                      Print one JSON object per line on standard output.
  --budget <usd>              Stop each turn, and each resume after an answer,
                              before it spends more; warn at 80%. It caps each
                              turn, not the session.
  --state-dir <folder>        Where sessions, locks and keys live. Default
                              $XDG_STATE_HOME/buildanagent or
                              ~/.local/state/buildanagent.
  --otlp-endpoint <url>       Send OpenTelemetry spans, without content, here.
  --force                     Confirm session unlock.
  -h, --help                  Print this help and exit.
`;

type Command = (context: CommandContext, words: readonly string[]) => Promise<number> | number;

const COMMANDS: Readonly<Record<string, Command>> = {
  run: runCommand,
  chat: (context, words) => {
    if (words.length > 0) throw new CliError("usage", "chat takes no arguments; use resume <session> for a stored one");
    return chatCommand(context);
  },
  resume: resumeCommand,
  sessions: sessionsCommand,
  session: unlockCommand,
  keys: keysCommand,
  rpc: rpcCommand,
};

async function dispatch(argv: readonly string[], options: CliOptions): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  const [name, ...words] = positionals;
  if (name === undefined || flags.help) {
    options.io.write(HELP);
    return 0;
  }
  const command = COMMANDS[name];
  if (command === undefined || !Object.hasOwn(COMMANDS, name)) {
    throw new CliError("usage", `unknown command ${JSON.stringify(name)}`);
  }
  const paths = statePaths(stateRoot(flags.stateDir, options.io.env));
  const context: CommandContext = {
    io: options.io,
    flags,
    options,
    hostOptions: {
      paths,
      cwd: options.io.cwd,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
      ...(options.rules === undefined ? {} : { rules: options.rules }),
      ...(flags.budgetUsd === undefined ? {} : { budgetUsd: flags.budgetUsd }),
      ...(flags.otlpEndpoint === undefined ? {} : { otlpEndpoint: flags.otlpEndpoint }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    },
  };
  return await command(context, words);
}

/**
 * Runs the `buildanagent` command line `argv`, the arguments after the program's name, and resolves with the exit
 * status. It writes only through `options.io`, and it opens a connection only to the provider `--model` names and to
 * the collector `--otlp-endpoint` names. An error that is not a `CliError` rejects.
 */
export async function runCli(argv: readonly string[], options: CliOptions): Promise<number> {
  try {
    return await dispatch(argv, options);
  } catch (error) {
    if (!isCliError(error)) throw error;
    options.io.error(`buildanagent: ${error.message}\n${error.code === "usage" ? `\n${HELP}` : ""}`);
    return 2;
  }
}
