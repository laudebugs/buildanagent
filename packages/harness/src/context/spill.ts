import { encodeName, type SessionKey } from "../session/store.js";
import type { SpillStore } from "./types.js";

/** A spill store in memory, for tests and for a process that keeps its sessions in `memoryStore()`. */
export function memorySpillStore(): SpillStore & {
  /** The full text spilled to `path`, or `undefined` when nothing was. */
  read(path: string): string | undefined;
} {
  const files = new Map<string, string>();
  return {
    async write(key: SessionKey, callId: string, text: string): Promise<string> {
      const path = `spill/${encodeName(key.userId)}/${encodeName(key.sessionId)}/${encodeName(callId)}.txt`;
      files.set(path, text);
      return path;
    },
    read: (path) => files.get(path),
  };
}
