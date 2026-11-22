/**
 * `fileLock()`: a `SessionLock` that keeps each lock in a file beside the sessions, created with the exclusive-create
 * flag and renewed on a lease. It needs Node's file system and a local disk: an exclusive create is not reliable on a
 * network file system, so those are unsupported.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { HarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "./lock.js";
import { checkKey, encodeName, type SessionKey } from "./store.js";

const EXTENSION = ".lock";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
// A takeover guard older than this was left by a process that died during a takeover, so it is cleared.
const GUARD_STALE_MS = 10_000;

/** What a lock file holds. */
export interface LockRecord {
  readonly pid: number;
  readonly host: string;
  readonly token: string;
  /** When the lease ends, in milliseconds since the epoch. */
  readonly leaseUntil: number;
}

/** The options of `fileLock()` and `unlockSession()`. */
export interface FileLockOptions {
  /** The folder that holds the lock files, one folder per user. Use the session store's folder or a sibling of it. */
  readonly dir: string;
  /** How long a lock lasts without a renewal. Default 30 seconds. */
  readonly leaseMs?: number;
  /** How often the holder renews. Default 10 seconds, and it must be shorter than the lease. */
  readonly renewMs?: number;
  /** The clock, in milliseconds. A test sets it. */
  readonly now?: () => number;
  /** Whether a process exists on this host. The default signals it with `process.kill(pid, 0)`. */
  readonly isAlive?: (pid: number) => boolean;
  /** This host's name, which a lock from another host is compared with. Default `os.hostname()`. */
  readonly host?: string;
  /** This process's id. Default `process.pid`. */
  readonly pid?: number;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseRecord(text: string): LockRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<LockRecord>;
    const ok =
      typeof value.pid === "number" &&
      typeof value.host === "string" &&
      typeof value.token === "string" &&
      typeof value.leaseUntil === "number";
    return ok ? (value as LockRecord) : undefined;
  } catch {
    return undefined;
  }
}

class FileLock implements SessionLock {
  readonly #dir: string;
  readonly #leaseMs: number;
  readonly #renewMs: number;
  readonly #now: () => number;
  readonly #isAlive: (pid: number) => boolean;
  readonly #host: string;
  readonly #pid: number;

  constructor(options: FileLockOptions) {
    this.#dir = options.dir;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#renewMs = options.renewMs ?? DEFAULT_RENEW_MS;
    this.#now = options.now ?? Date.now;
    this.#isAlive = options.isAlive ?? processExists;
    this.#host = options.host ?? hostname();
    this.#pid = options.pid ?? process.pid;
    if (!(this.#leaseMs > 0) || !(this.#renewMs > 0) || this.#renewMs >= this.#leaseMs) {
      throw new HarnessError(
        "invalid_session_key",
        "fileLock() needs a renewMs shorter than its leaseMs, both above 0",
      );
    }
  }

  #pathOf(key: SessionKey): string {
    return lockPath(this.#dir, key);
  }

  #record(token: string): LockRecord {
    return { pid: this.#pid, host: this.#host, token, leaseUntil: this.#now() + this.#leaseMs };
  }

  /** Whether a lock's holder is gone: its lease has lapsed and, on this host, its process no longer exists. */
  #isStale(record: LockRecord): boolean {
    if (record.leaseUntil >= this.#now()) return false;
    return record.host === this.#host && !this.#isAlive(record.pid);
  }

  async #create(path: string, record: LockRecord): Promise<boolean> {
    const file = await open(path, "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined;
      throw error;
    });
    if (file === undefined) return false;
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    return true;
  }

  /** A lock file with no readable record is one whose creator died, or is still writing it, so only its age says which. */
  async #unreadableIsStale(path: string): Promise<boolean> {
    const info = await stat(path).catch(() => undefined);
    return info !== undefined && this.#now() - info.mtimeMs > this.#leaseMs;
  }

  /** Takes over a stale lock under a short-lived guard, so two reclaimers can't each delete the other's new lock. */
  async #reclaim(path: string, staleToken: string | undefined, record: LockRecord): Promise<boolean> {
    const guard = `${path}.reclaim`;
    if (!(await this.#create(guard, record))) {
      const info = await stat(guard).catch(() => undefined);
      if (info === undefined || this.#now() - info.mtimeMs <= GUARD_STALE_MS) return false;
      await rm(guard, { force: true });
      if (!(await this.#create(guard, record))) return false;
    }
    try {
      const current = parseRecord(await readFile(path, "utf8").catch(() => ""));
      // Someone renewed or replaced the lock since it was read as stale.
      if (current?.token !== staleToken) return false;
      await rm(path, { force: true });
      return await this.#create(path, record);
    } finally {
      await rm(guard, { force: true });
    }
  }

  async acquire(key: SessionKey): Promise<LockHandle | "would_block"> {
    checkKey(key);
    const path = this.#pathOf(key);
    await mkdir(join(path, ".."), { recursive: true });
    const token = randomUUID();
    const record = this.#record(token);
    if (!(await this.#create(path, record)) && !(await this.#takeOver(path, record))) return "would_block";
    return new Hold(path, token, this.#leaseMs, this.#renewMs, this.#now, this.#host, this.#pid);
  }

  async #takeOver(path: string, record: LockRecord): Promise<boolean> {
    const text = await readFile(path, "utf8").catch(() => undefined);
    // The lock was released between the failed create and this read, so try the plain create again.
    if (text === undefined) return this.#create(path, record);
    const existing = parseRecord(text);
    if (existing === undefined) {
      return (await this.#unreadableIsStale(path)) && this.#reclaim(path, undefined, record);
    }
    return this.#isStale(existing) && this.#reclaim(path, existing.token, record);
  }
}

class Hold implements LockHandle {
  readonly token: string;
  #held = true;
  readonly #path: string;
  readonly #timer: ReturnType<typeof setInterval>;
  readonly #leaseMs: number;
  readonly #now: () => number;
  readonly #host: string;
  readonly #pid: number;

  constructor(
    path: string,
    token: string,
    leaseMs: number,
    renewMs: number,
    now: () => number,
    host: string,
    pid: number,
  ) {
    this.token = token;
    this.#path = path;
    this.#leaseMs = leaseMs;
    this.#now = now;
    this.#host = host;
    this.#pid = pid;
    // A renewal must not keep a process alive that has nothing else to do.
    this.#timer = setInterval(() => void this.#renew(), renewMs);
    this.#timer.unref();
  }

  held(): boolean {
    return this.#held;
  }

  async #renew(): Promise<void> {
    if (!this.#held) return;
    try {
      const current = parseRecord(await readFile(this.#path, "utf8").catch(() => ""));
      if (current?.token !== this.token) return this.#lose();
      const next: LockRecord = {
        pid: this.#pid,
        host: this.#host,
        token: this.token,
        leaseUntil: this.#now() + this.#leaseMs,
      };
      // Written beside the lock and renamed over it, so a reader never sees half a record.
      const temp = `${this.#path}.${this.token}.tmp`;
      await writeFile(temp, JSON.stringify(next));
      await rename(temp, this.#path);
    } catch {
      // A failed renewal is retried on the next tick. A lease that lapses meanwhile is lost to a takeover, which the
      // next renewal then sees.
    }
  }

  #lose(): void {
    this.#held = false;
    clearInterval(this.#timer);
  }

  async release(): Promise<void> {
    if (!this.#held) return;
    this.#lose();
    const current = parseRecord(await readFile(this.#path, "utf8").catch(() => ""));
    if (current?.token === this.token) await rm(this.#path, { force: true });
  }
}

function lockPath(dir: string, key: SessionKey): string {
  return join(dir, encodeName(key.userId), `${encodeName(key.sessionId)}${EXTENSION}`);
}

/** A lock file that held a record when it was removed. */
export type RemovedLock = LockRecord | "unreadable";

/**
 * Removes a session's lock whatever its state: the library behind `buildanagent session unlock --force`. A lock from
 * another host is never reclaimed by `acquire()`, because this host can't tell whether its process lives, so this is the
 * way to clear one. It returns what it removed, or `undefined` when there was no lock. The caller decides it is safe.
 */
export async function unlockSession(
  options: Pick<FileLockOptions, "dir">,
  key: SessionKey,
): Promise<RemovedLock | undefined> {
  checkKey(key);
  const path = lockPath(options.dir, key);
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  await rm(path, { force: true });
  return parseRecord(text) ?? "unreadable";
}

/**
 * A `SessionLock` over lock files in `options.dir`. `acquire()` creates `<user>/<session>.lock` with the exclusive-create
 * flag and writes `{ pid, host, token, leaseUntil }`, and the holder renews the lease every `renewMs`. A second
 * `acquire()` returns `"would_block"` at once. A lock is stale only when its lease has lapsed and, on the same host, its
 * process no longer exists, so a lock whose holder is alive is never taken, and one from another host only by
 * `unlockSession()`. Readers never lock.
 */
export function fileLock(options: FileLockOptions): SessionLock {
  return new FileLock(options);
}
