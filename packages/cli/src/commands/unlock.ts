/**
 * `buildanagent session unlock <session> --force`: remove a session's writer lock. A lock outlives a crash only by
 * its lease, and one from another host is never taken over, so this is the way out when you know its writer is gone.
 * Removing the lock of a writer that still runs lets two writers into one log, so the command needs `--force`.
 */
import { unlockSession } from "@buildanagent/harness/session/jsonl";
import { CliError } from "../errors.js";
import { USER_ID } from "../host.js";
import type { CommandContext } from "../options.js";
import { Output } from "../output.js";

/** Runs `session unlock` and returns the exit status: 0 once no lock remains, 2 without `--force`. */
export async function unlockCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  const [verb, session, ...rest] = words;
  if (verb !== "unlock" || session === undefined || rest.length > 0) {
    throw new CliError("usage", "session takes unlock <session> --force");
  }
  if (!context.flags.force) {
    context.io.error(
      `buildanagent: unlocking lets a second writer into ${session}; check that no other buildanagent runs it, then pass --force\n`,
    );
    return 2;
  }
  const removed = await unlockSession(
    { dir: context.hostOptions.paths.locks },
    { userId: USER_ID, sessionId: session },
  );
  const out = new Output(context.io, context.flags.json);
  if (removed === undefined) out.result(`${session} had no lock`, { session, removed: null });
  else if (removed === "unreadable") out.result(`removed an unreadable lock from ${session}`, { session, removed });
  else {
    out.result(`removed the lock of process ${removed.pid} on ${removed.host} from ${session}`, { session, removed });
  }
  return 0;
}
