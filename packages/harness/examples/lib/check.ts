// Shared helpers for the book's examples on the harness: an assertion helper, a scripted model behind createModel(),
// and a session lock that lives in memory. The book lists these examples beside the third-party ones (apps/manual),
// and scripts/transcripts/book-examples.ts runs each one offline and records its transcript.
//
// The offline setup comes first, as in every test under packages/: a set provider key stops the example, and no
// request can leave this machine.
import "@buildanagent/gateway/testing/setup";
import { createModel, type Model } from "@buildanagent/gateway";
import type { LockHandle, SessionKey, SessionLock } from "@buildanagent/harness/session";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
// Attaches the transcript recorder to ScriptedModel when the test preloads it (scripts/transcripts/).
import { lendCallerLine, recordedSteps, SCRIPTED_MODEL_ID } from "./transcript.js";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

/** A `ScriptedModel` that plays back `steps`, one per model call, behind createModel() as a run receives it. */
export function scripted(steps: ScriptStep[]): { adapter: ScriptedModel; model: Model } {
  const script = recordedSteps(steps);
  const adapter = new ScriptedModel(script.steps);
  script.belongsTo(adapter);
  const model = createModel({ adapter, id: SCRIPTED_MODEL_ID });
  return { adapter, model: lendCallerLine(model) };
}

/**
 * A `SessionLock` that holds its locks in this process's memory. The harness ships only a file-backed lock, and a book
 * example writes no file, so this stands in for it: one writer per user and session, released by `session.close()`.
 * Each hold has its own token, and a release frees the lock only while that token still holds it, so a second release
 * never frees another writer's lock.
 */
export function memoryLock(): SessionLock {
  const held = new Map<string, string>();
  return {
    async acquire(key: SessionKey): Promise<LockHandle | "would_block"> {
      const name = JSON.stringify([key.userId, key.sessionId]);
      if (held.has(name)) return "would_block";
      const token = globalThis.crypto.randomUUID();
      held.set(name, token);
      return {
        token,
        held: () => held.get(name) === token,
        async release() {
          if (held.get(name) === token) held.delete(name);
        },
      };
    },
  };
}
