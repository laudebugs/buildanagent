/**
 * The spill store that keeps each capped tool result in a file, one per call, in a folder per session. It uses Node's
 * file system, loaded with `process.getBuiltinModule()` when a result is written, so importing it costs a portable
 * bundle nothing. It has its own entry, `@buildanagent/harness/context/file`.
 */
import { HarnessError } from "../errors.js";
import { encodeName, type SessionKey } from "../session/store.js";
import type { SpillStore } from "./types.js";

/** A spill store that writes `<dir>/<user>/<session>/<callId>.txt` and returns that path. */
export function fileSpillStore(options: { readonly dir: string }): SpillStore {
  return {
    async write(key: SessionKey, callId: string, text: string): Promise<string> {
      if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
        throw new HarnessError(
          "spill_unavailable",
          "fileSpillStore needs Node's file system, which this runtime lacks",
        );
      }
      const fs = process.getBuiltinModule("node:fs/promises");
      const path = process.getBuiltinModule("node:path");
      const folder = path.join(options.dir, encodeName(key.userId), encodeName(key.sessionId));
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, `${encodeName(callId)}.txt`);
      await fs.writeFile(file, text, "utf8");
      return file;
    },
  };
}
