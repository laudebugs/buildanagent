/**
 * `fileIndex()`: a `SessionIndex` that keeps each pointer in a small JSON file beside the session files, replaced by
 * writing a temp file and renaming it over the old one, so a crash leaves the old pointer or the new and never half of one.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../errors.js";
import type { SessionIndex } from "./pointer.js";
import { checkKey, encodeName, type SessionKey } from "./store.js";

const EXTENSION = ".pointer.json";

/** The options of `fileIndex()`. */
export interface FileIndexOptions {
  /** The folder that holds the pointers, one folder per user. It can be the session store's folder. */
  readonly dir: string;
}

const pathOf = (dir: string, key: SessionKey): string =>
  join(dir, encodeName(key.userId), `${encodeName(key.sessionId)}${EXTENSION}`);

async function flush(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A pointer index in files under `options.dir`. */
export function fileIndex(options: FileIndexOptions): SessionIndex {
  return {
    async get(key) {
      checkKey(key);
      const text = await readFile(pathOf(options.dir, key), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (text === undefined) return undefined;
      const file = (JSON.parse(text) as { file?: unknown }).file;
      if (typeof file !== "string") throw new HarnessError("session_corrupt", "a session pointer holds no file name");
      return file;
    },
    async set(key, file) {
      checkKey(key);
      const target = pathOf(options.dir, key);
      await mkdir(join(target, ".."), { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx");
      try {
        await handle.writeFile(JSON.stringify({ file }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
      // The rename is only durable once the folder is.
      await flush(join(target, "..")).catch(() => undefined);
    },
  };
}
