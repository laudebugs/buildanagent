/**
 * `fileKeyStore()`: a `KeyStore` that keeps the approval key ring in one file, outside every sandbox and outside the
 * session log. The file is created with mode `0600` in a folder of mode `0700`, and a ring that group or others can read
 * is refused, because a key anyone can read signs nothing. A change is written to a temp file and renamed over the ring,
 * so a crash leaves the old ring or the new and never half of one.
 */

import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { type KeyRing, type KeyStore, parseKeyRing } from "@buildanagent/agent-safety";
import { HarnessError } from "../errors.js";

const KEY_BYTES = 32;

/** Where the ring is when no path is given: `$XDG_STATE_HOME/buildanagent/keys.json`, or under `~/.local/state`. */
export function defaultKeyPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const state =
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== ""
      ? env.XDG_STATE_HOME
      : join(homedir(), ".local", "state");
  return join(state, "buildanagent", "keys.json");
}

const invalid = (message: string, cause?: unknown) =>
  new HarnessError("invalid_key_store", message, cause === undefined ? undefined : { cause });

/** A new key id: the date, then random letters, so two rotations on one day differ and an id reveals no key bytes. */
function newKeyId(now: Date): string {
  return `${now.toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`;
}

const encodeRing = (ring: KeyRing): string =>
  JSON.stringify({
    current: ring.current,
    keys: Object.fromEntries(
      Object.entries(ring.keys).map(([id, bytes]) => [id, Buffer.from(bytes).toString("base64url")]),
    ),
  });

async function write(path: string, ring: KeyRing, exclusive: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(encodeRing(ring));
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (exclusive) {
      // A ring another process created in the meantime wins: the link fails and ours is dropped.
      await link(temp, path);
      await rm(temp, { force: true });
    } else {
      await rename(temp, path);
    }
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function read(path: string): Promise<KeyRing | undefined> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if ((info.mode & 0o077) !== 0) {
    throw invalid("the key file can be read by others; run chmod 600 on it, or rotate keys that may have leaked");
  }
  try {
    return parseKeyRing(await readFile(path, "utf8"));
  } catch (cause) {
    throw invalid("the key file is not a key ring", cause);
  }
}

/**
 * A key ring in the file at `path` (default `defaultKeyPath()`). `load()` creates a ring with one random 256-bit key
 * when the file does not exist yet. `rotate()` adds a new key and makes it current. `prune(inUse)` removes every key
 * not in `inUse` except the current one, and returns the removed ids. `rotate()` and `prune()` are for one process at a
 * time, such as a host's key command; two that run together may lose one of the changes.
 */
export function fileKeyStore(path: string = defaultKeyPath()): KeyStore {
  return {
    async load() {
      const existing = await read(path);
      if (existing !== undefined) return existing;
      const id = newKeyId(new Date());
      const ring: KeyRing = { keys: { [id]: new Uint8Array(randomBytes(KEY_BYTES)) }, current: id };
      try {
        await write(path, ring, true);
        return ring;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return (await read(path)) as KeyRing;
      }
    },
    async rotate() {
      const ring = await this.load();
      const id = newKeyId(new Date());
      await write(path, { keys: { ...ring.keys, [id]: new Uint8Array(randomBytes(KEY_BYTES)) }, current: id }, false);
      return id;
    },
    async prune(inUse) {
      const ring = await this.load();
      const removed = Object.keys(ring.keys).filter((id) => id !== ring.current && !inUse.has(id));
      if (removed.length === 0) return [];
      const kept = Object.fromEntries(Object.entries(ring.keys).filter(([id]) => !removed.includes(id)));
      await write(path, { keys: kept, current: ring.current }, false);
      return removed;
    },
  };
}
