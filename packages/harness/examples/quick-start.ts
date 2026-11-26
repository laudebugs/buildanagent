// A first harness: it runs two turns of one conversation and keeps both in a session log on disk. The second turn
// reads the first from the log, so a new process could open the same session and go on from there.
import { join } from "node:path";
import type { Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionKey, type TurnResult } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";

/** What the two turns said, and what the log holds afterwards. */
export interface QuickStartRun {
  /** The text of each turn's answer. */
  readonly answers: readonly string[];
  /** The type of every entry in the log, in order. */
  readonly entryTypes: readonly string[];
}

/** The text the model wrote in a turn's last message. */
function answerOf(result: TurnResult): string {
  const last = result.messages.at(-1);
  return last?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
}

/** Asks two questions in one session and reads the log the harness wrote. Files go under `folder`. */
export async function askTwice(model: Model, folder: string, key: SessionKey): Promise<QuickStartRun> {
  // #region harness
  const harness = createHarness({
    registry: createToolRegistry(),
    model,
    system: "You keep short notes for the user.",
  });
  // #endregion

  // #region session
  const session = await openSession({
    store: jsonlStore({ dir: join(folder, "sessions") }),
    index: fileIndex({ dir: join(folder, "pointers") }),
    lock: fileLock({ dir: join(folder, "locks") }),
    key,
  });
  // #endregion

  try {
    // #region turns
    const first = await runTurn(session, harness, { input: "Remember the codeword PELICAN." });
    const second = await runTurn(session, harness, { input: "What was the codeword?" });
    // #endregion

    // #region read
    const entryTypes: string[] = [];
    for await (const entry of session.playback()) entryTypes.push(entry.type);
    // #endregion
    return { answers: [answerOf(first), answerOf(second)], entryTypes };
  } finally {
    // #region close
    await session.close();
    // #endregion
  }
}
