/**
 * The spill store that keeps each capped tool result in a file, one per call, in a folder per session. It uses Node's
 * file system, loaded with `process.getBuiltinModule()` when a result is written or read, so importing it costs a
 * portable bundle nothing. It has its own entry, `@buildanagent/harness/context/file`.
 */
import { HarnessError } from "../errors.js";
import { encodeName, type SessionKey } from "../session/store.js";
import type { SpillStore } from "./types.js";

/** A spill store in files, which can also read back the spills of one session. */
export interface FileSpillStore extends SpillStore {
  /**
   * The text spilled to `path` for the session `key`, or `undefined` when `path` is not a spill file of that session.
   * A path outside the session's folder, including one that leads out through a symlink, is never read.
   */
  read(key: SessionKey, path: string): Promise<string | undefined>;
}

function nodeModules() {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new HarnessError("spill_unavailable", "fileSpillStore needs Node's file system, which this runtime lacks");
  }
  return { fs: process.getBuiltinModule("node:fs/promises"), path: process.getBuiltinModule("node:path") };
}

/** A spill store that writes `<dir>/<user>/<session>/<callId>.txt` and returns that path. */
export function fileSpillStore(options: { readonly dir: string }): FileSpillStore {
  const folderOf = (key: SessionKey) =>
    nodeModules().path.resolve(options.dir, encodeName(key.userId), encodeName(key.sessionId));
  return {
    async write(key: SessionKey, callId: string, text: string): Promise<string> {
      const { fs, path } = nodeModules();
      const folder = folderOf(key);
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, `${encodeName(callId)}.txt`);
      await fs.writeFile(file, text, "utf8");
      return file;
    },
    async read(key: SessionKey, file: string): Promise<string | undefined> {
      const { fs, path } = nodeModules();
      // Both sides are real paths, so a link inside the folder that points out of it is caught.
      const folder = await fs.realpath(folderOf(key)).catch(() => undefined);
      const real = await fs.realpath(path.resolve(folderOf(key), file)).catch(() => undefined);
      if (folder === undefined || real === undefined || path.dirname(real) !== folder) return undefined;
      return fs.readFile(real, "utf8").catch(() => undefined);
    },
  };
}
