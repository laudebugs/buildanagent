/**
 * `buildanagent run <prompt>`: one turn, then exit. A call that needs a person is not asked about, because nobody may
 * be at the terminal: the turn ends waiting, the exit status is 3, and `resume` answers it later.
 */
import { CliError } from "../errors.js";
import { exitStatus, reportSettled, startLive, withLive } from "../live.js";
import type { CommandContext } from "../options.js";
import { runTurn } from "../watch.js";

/** Runs one turn of a new session with the prompt `words` make up, and returns the exit status. */
export async function runCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  const prompt = words.join(" ");
  if (prompt.trim() === "") throw new CliError("usage", "run needs a prompt: buildanagent run <prompt>");
  const live = await startLive(context, false);
  return withLive(live, async () => {
    const result = await runTurn(live.host.client, live.watch, prompt);
    reportSettled(live, result);
    return exitStatus(result);
  });
}
