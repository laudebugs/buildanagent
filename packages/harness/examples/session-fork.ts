// Trying another question from an earlier point of a conversation. `fork()` starts a new session from one entry of the
// log: the new session shares every entry up to that point with the old one and writes its own after it. The old
// session stays as it was, so you can compare the two answers.
import { type Harness } from "@buildanagent/harness/server";
import { runTurn, type Session } from "@buildanagent/harness/session";

/** What a fork shares with its parent and what it wrote itself. */
export interface ForkReport {
  /** The id of the new session. Open it with the same user to read it again. */
  readonly forkId: string;
  /** How many entries the fork shares with the session it came from. */
  readonly shared: number;
  /** How many entries the fork's turn added. */
  readonly added: number;
}

/** Forks `session` at `entryId`, asks `input` in the fork and reports what the fork shares and adds. */
export async function askFrom(session: Session, harness: Harness, entryId: string, input: string): Promise<ForkReport> {
  // #region fork
  const branch = await session.fork(entryId);
  try {
    const shared = (await branch.path()).length;
    await runTurn(branch, harness, { input });
    const added = (await branch.path()).length - shared;
    return { forkId: branch.key.sessionId, shared, added };
  } finally {
    await branch.close();
  }
  // #endregion
}
