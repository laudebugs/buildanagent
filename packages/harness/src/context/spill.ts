import type { SessionKey } from "../session/store.js";
import type { SpillStore } from "./types.js";

/** A spill store in memory, for tests and for a process that keeps its sessions in `memoryStore()`. */
export function memorySpillStore(): SpillStore & { read(path: string): string | undefined } {
  const files = new Map<string, string>();
  return {
    async write(key: SessionKey, callId: string, text: string): Promise<string> {
      const path = `spill/${encodeURIComponent(key.userId)}/${encodeURIComponent(key.sessionId)}/${encodeURIComponent(callId)}.txt`;
      files.set(path, text);
      return path;
    },
    read: (path) => files.get(path),
  };
}
