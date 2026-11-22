/**
 * `buildanagent chat` and `buildanagent resume <session>`: a conversation, one line of input per turn. When a turn
 * pauses for a person, the requests are asked about at the terminal and the turn goes on once they are answered.
 * Resuming a session first asks about whatever it was left waiting on.
 */
import type { TurnResultSummary } from "@buildanagent/protocol";
import { askPerson } from "../ask.js";
import { CliError } from "../errors.js";
import { type Live, reportSettled, startLive } from "../live.js";
import type { CommandContext } from "../options.js";
import { runTurn, WAITING_REASONS } from "../watch.js";

const QUIT = new Set(["/exit", "/quit"]);

/**
 * Asks about each request the turn waits on and follows the resumes until the turn no longer waits, or until input
 * ends or no answer of ours is left to apply.
 */
async function settle(context: CommandContext, live: Live, first: TurnResultSummary): Promise<TurnResultSummary> {
  let result = first;
  while (WAITING_REASONS.has(result.stopReason)) {
    if (live.watch.asked.size > 0) {
      if (!(await askPerson(context.io, live.watch))) return result;
    } else if (!(await live.watch.answerPending())) return result;
    result = (await live.watch.nextSettled()).result;
  }
  return result;
}

async function converse(context: CommandContext, live: Live): Promise<void> {
  if (live.pending.length > 0) {
    await live.watch.whenAsked(live.pending);
    reportSettled(live, await settle(context, live, { stopReason: "awaiting_approval", steps: 0, costUsd: null }));
  }
  for (;;) {
    context.io.error("> ");
    const line = await context.io.readLine();
    if (line === undefined || QUIT.has(line.trim())) return;
    if (line.trim() === "") continue;
    const result = await runTurn(live.host.client, live.watch, line);
    reportSettled(live, await settle(context, live, result));
  }
}

/** Chats in a new session, or in the stored session `id`, until input ends or a line says `/exit`. */
export async function chatCommand(context: CommandContext, id?: string): Promise<number> {
  const live = await startLive(context, true, id);
  try {
    await converse(context, live);
    return 0;
  } finally {
    live.watch.stop();
    await live.host.close();
  }
}

/** `resume <session>`: chats in a stored session. */
export function resumeCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  const [id] = words;
  if (id === undefined || words.length > 1) throw new CliError("usage", "resume takes one session id");
  return chatCommand(context, id);
}
