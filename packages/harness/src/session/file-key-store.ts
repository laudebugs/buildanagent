/**
 * `fileKeyStore()`: a `KeyStore` that keeps the approval key ring in one file, outside every sandbox and outside the
 * session log. The file is created with mode `0600`, in a new folder of mode `0700`, and a ring that group or others can read
 * is refused, because a key anyone can read signs nothing. A change is written to a temp file and renamed over the ring,
 * so a crash leaves the old ring or the new and never half of one.
 */

import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if (info.isSymbolicLink())
    throw invalid("the key file is a symbolic link, which could point at a ring someone else wrote");
  // The file must be ours: in a shared folder another user could put a ring of their own there.
  if (process.platform !== "win32" && info.uid !== process.getuid?.()) {
    throw invalid("the key file belongs to another user");
  }
  // Windows reports a file mode that has no group or other bits to read, so only POSIX systems check it.
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw invalid("the key file can be read by others; run chmod 600 on it, or rotate keys that may have leaked");
  }
  try {
    return parseKeyRing(await readFile(path, "utf8"));
  } catch (cause) {
    throw invalid("the key file is not a key ring", cause);
  }
}

const LOCK_TRIES = 100;
const LOCK_WAIT_MS = 50;
const LOCK_STALE_MS = 60_000;

/** Runs `change` while this process holds the ring's lock file, so two rotations or prunes can't lose each other's work. */
async function locked<T>(path: string, change: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await (await open(lock, "wx", 0o600)).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A lock left by a process that died is older than any change takes.
      const age =
        Date.now() -
        (await stat(lock).then(
          (info) => info.mtimeMs,
          () => Date.now(),
        ));
      if (age > LOCK_STALE_MS) await rm(lock, { force: true });
      else if (attempt >= LOCK_TRIES) throw invalid("another process is changing the key ring; try again");
      else await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  try {
    return await change();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * A key ring in the file at `path` (default `defaultKeyPath()`). `load()` creates a ring with one random 256-bit key
 * when the file does not exist yet. `rotate()` adds a new key and makes it current. `prune(inUse)` removes every key
 * not in `inUse` except the current one, and returns the removed ids. `rotate()` and `prune()` take a lock file beside
 * the ring, so two processes that change it together each keep the other's work.
 */
export function fileKeyStore(path: string = defaultKeyPath()): KeyStore {
  // Plain functions, not methods, so a store passed around as `setInterval(store.rotate, ...)` still works.
  const load = async (): Promise<KeyRing> => {
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
  };
  return {
    load,
    rotate: () =>
      locked(path, async () => {
        const ring = await load();
        const id = newKeyId(new Date());
        await write(path, { keys: { ...ring.keys, [id]: new Uint8Array(randomBytes(KEY_BYTES)) }, current: id }, false);
        return id;
      }),
    prune: (inUse) =>
      locked(path, async () => {
        const ring = await load();
        const removed = Object.keys(ring.keys).filter((id) => id !== ring.current && !inUse.has(id));
        if (removed.length === 0) return [];
        const kept = Object.fromEntries(Object.entries(ring.keys).filter(([id]) => !removed.includes(id)));
        await write(path, { keys: kept, current: ring.current }, false);
        return removed;
      }),
  };
}
