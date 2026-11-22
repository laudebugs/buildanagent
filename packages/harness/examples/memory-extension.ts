// Long-term memory: the memory extension over a project's `.agents/memory/`, loaded for one session, and a pass that
// removes the deleted records' text from the sessions that held it.

import type { Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { composeExtensions, registerExtensionTools } from "@buildanagent/harness/extensions";
import { clearPurgeMarks, memoryExtension, readPurgeMarks } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { createHarness } from "@buildanagent/harness/server";
import {
  type PurgeMark,
  purgeSession,
  type SessionIndex,
  type SessionLock,
  type SessionStore,
} from "@buildanagent/harness/session";
import type { ToolRegistry } from "@buildanagent/harness/tools";

const SYSTEM = "You are a careful coding agent.";

/** A harness with long-term memory for the session `sessionId` of the project at `root`. */
export function memoryHarness(registry: ToolRegistry, model: Model, root: string, sessionId: string) {
  const memory = memoryExtension({ root, files: fileMemoryFiles(root), registry, sessionId });
  const { interceptors, observers } = composeExtensions([memory]);
  registerExtensionTools(registry, [memory]);
  const harness = createHarness({ registry, model, system: SYSTEM, interceptors, observers });
  return { harness, memory };
}

/** The session log a purge rewrites. */
export interface Log {
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly lock: SessionLock;
}

/**
 * Purges every deleted record from each of the user's sessions, then clears only the marks those purges applied. A
 * session that a fork continues waits until the fork is purged, so the order of `sessionIds` does not matter.
 */
export async function purgeDeleted(root: string, log: Log, userId: string, sessionIds: readonly string[]) {
  const files = fileMemoryFiles(root);
  const marks = await readPurgeMarks(files);
  const applied: PurgeMark[] = [];
  for (let pending = [...sessionIds]; pending.length > 0; ) {
    const waiting: string[] = [];
    let conflict: unknown;
    for (const sessionId of pending) {
      try {
        const result = await purgeSession({ ...log, key: { userId, sessionId }, marks });
        if (result.purged) applied.push(...result.marks);
      } catch (error) {
        if (!isHarnessError(error) || error.code !== "session_conflict") throw error;
        waiting.push(sessionId);
        conflict = error;
      }
    }
    // No session was purged this round, so the forks they wait for are not among `sessionIds`.
    if (waiting.length === pending.length) throw conflict;
    pending = waiting;
  }
  await clearPurgeMarks(files, applied);
}
