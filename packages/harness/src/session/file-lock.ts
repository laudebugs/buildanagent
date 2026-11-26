/**
 * `fileLock()`: a `SessionLock` that keeps each lock in a file beside the sessions, created with the exclusive-create
 * flag and renewed on a lease. It needs Node's file system and a local disk: an exclusive create is not reliable on a
 * network file system, so those are unsupported.
 */
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { HarnessError } from "../errors.js";
import { LeaseRenewals, leaseId } from "./lease-renewals.js";
import type { LockHandle, SessionLock } from "./lock.js";
import { type ProcessScheduler, processScheduler } from "./scheduler.js";
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
  /**
   * How often the holder renews. Default 10 seconds or a third of the lease, whichever is less. It must be shorter
   * than the lease.
   */
  readonly renewMs?: number;
  /** The clock, in milliseconds. A test sets it. */
  readonly now?: () => number;
  /** Whether a process exists on this host. The default signals it with `process.kill(pid, 0)`. */
  readonly isAlive?: (pid: number) => boolean;
  /** This host's name, which a lock from another host is compared with. Default `os.hostname()`. */
  readonly host?: string;
  /** This process's id. Default `process.pid`. */
  readonly pid?: number;
  /**
   * What wakes a hold to renew its lease. Default: a scheduler of this lock's own, which uses timers. A host that shares
   * a scheduler across locks passes it here; each renewal's id starts with `lease:`, so the host's own wakes don't clash.
   */
  readonly scheduler?: ProcessScheduler;
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
    const value = JSON.parse(text.trim()) as Partial<LockRecord>;
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

// Every lock record is padded to this many bytes, so a renewal overwrites the record in place with one write.
const RECORD_BYTES = 1024;
const MAX_TIMER_MS = 2 ** 31 - 1;

function encode(record: LockRecord): string {
  const text = JSON.stringify(record);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > RECORD_BYTES) {
    throw new HarnessError("invalid_lock_options", "a lock record is over 1 KiB, so the host name is too long");
  }
  return text + " ".repeat(RECORD_BYTES - bytes);
}

/** What a takeover guard holds: who made it, and when by the wall clock, which file ages are measured against. */
interface GuardRecord {
  readonly token: string;
  readonly createdAt: number;
}

function parseGuard(text: string): GuardRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<GuardRecord>;
    return typeof value.token === "string" && typeof value.createdAt === "number" ? (value as GuardRecord) : undefined;
  } catch {
    return undefined;
  }
}

async function createExclusive(path: string, text: string): Promise<boolean> {
  const file = await open(path, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") return undefined;
    throw error;
  });
  if (file === undefined) return false;
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  return true;
}

const readText = (path: string): Promise<string | undefined> => readFile(path, "utf8").catch(() => undefined);

class FileLock implements SessionLock {
  readonly #dir: string;
  readonly #leaseMs: number;
  readonly #renewMs: number;
  readonly #now: () => number;
  readonly #isAlive: (pid: number) => boolean;
  readonly #host: string;
  readonly #pid: number;
  readonly #scheduler: ProcessScheduler;

  constructor(options: FileLockOptions) {
    this.#dir = options.dir;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#renewMs = options.renewMs ?? Math.min(DEFAULT_RENEW_MS, this.#leaseMs / 3);
    this.#now = options.now ?? Date.now;
    this.#isAlive = options.isAlive ?? processExists;
    this.#host = options.host ?? hostname();
    this.#pid = options.pid ?? process.pid;
    this.#scheduler = options.scheduler ?? processScheduler();
    const ok =
      Number.isFinite(this.#leaseMs) && this.#leaseMs > 0 && this.#renewMs > 0 && this.#renewMs < this.#leaseMs;
    if (!ok || this.#renewMs > MAX_TIMER_MS) {
      throw new HarnessError(
        "invalid_lock_options",
        `fileLock() needs a finite leaseMs above 0 and a renewMs above 0, below the lease and at most ${MAX_TIMER_MS}`,
      );
    }
  }

  #record(token: string): LockRecord {
    return { pid: this.#pid, host: this.#host, token, leaseUntil: this.#now() + this.#leaseMs };
  }

  /** Whether a lock's holder is gone: its lease has lapsed and, on this host, its process no longer exists. */
  #isStale(record: LockRecord): boolean {
    if (record.leaseUntil >= this.#now()) return false;
    return record.host === this.#host && !this.#isAlive(record.pid);
  }

  /** A lock file with no readable record is one whose creator died, or is still writing it, so only its age says which. */
  async #unreadableIsStale(path: string): Promise<boolean> {
    const info = await stat(path).catch(() => undefined);
    // A file's age is measured on the wall clock, because that is what its modification time is.
    return info !== undefined && Date.now() - info.mtimeMs > this.#leaseMs;
  }

  /** Clears a takeover guard that its maker left behind, and says whether this call did. */
  async #clearStaleGuard(guard: string): Promise<boolean> {
    const text = await readText(guard);
    if (text === undefined) return true;
    const record = parseGuard(text);
    const info = await stat(guard).catch(() => undefined);
    const age = record === undefined ? Date.now() - (info?.mtimeMs ?? Date.now()) : Date.now() - record.createdAt;
    if (age <= GUARD_STALE_MS) return false;
    // Moved aside under a name no one else uses, so only one cleaner gets it, and checked before it is deleted.
    const aside = `${guard}.${randomUUID()}.stale`;
    if (
      !(await rename(guard, aside).then(
        () => true,
        () => false,
      ))
    )
      return false;
    const moved = parseGuard((await readText(aside)) ?? "");
    if (moved?.token === record?.token) {
      await rm(aside, { force: true });
      return true;
    }
    // A fresh guard was grabbed by mistake, so it goes back, unless another has been made since, and this call gives up.
    await link(aside, guard).catch(() => undefined);
    await rm(aside, { force: true });
    return false;
  }

  async #takeGuard(guard: string, mine: GuardRecord): Promise<boolean> {
    const text = JSON.stringify(mine);
    if (await createExclusive(guard, text)) return true;
    return (await this.#clearStaleGuard(guard)) && (await createExclusive(guard, text));
  }

  /** Takes over a stale lock under a short-lived guard, so two reclaimers can't each delete the other's new lock. */
  async #reclaim(path: string, staleToken: string | undefined, record: LockRecord): Promise<boolean> {
    const guard = `${path}.reclaim`;
    const mine: GuardRecord = { token: record.token, createdAt: Date.now() };
    if (!(await this.#takeGuard(guard, mine))) return false;
    try {
      const current = parseRecord((await readText(path)) ?? "");
      // Someone renewed or replaced the lock since it was read as stale.
      if (current?.token !== staleToken) return false;
      // A lock with no record may be one that another writer has just created and not finished writing, so it must
      // still be old now that the guard is held.
      if (staleToken === undefined && !(await this.#unreadableIsStale(path))) return false;
      await rm(path, { force: true });
      if (!(await createExclusive(path, encode(record)))) return false;
      // A guard that was cleared while this ran could have let a second reclaimer in, so the lock is read back.
      return parseRecord((await readText(path)) ?? "")?.token === record.token;
    } finally {
      const left = parseGuard((await readText(guard)) ?? "");
      if (left?.token === record.token) await rm(guard, { force: true });
    }
  }

  async acquire(key: SessionKey): Promise<LockHandle | "would_block"> {
    checkKey(key);
    const path = lockPath(this.#dir, key);
    await mkdir(join(path, ".."), { recursive: true });
    const token = randomUUID();
    const record = this.#record(token);
    const text = encode(record);
    if (!(await createExclusive(path, text)) && !(await this.#takeOver(path, record))) return "would_block";
    return new Hold(path, token, {
      leaseMs: this.#leaseMs,
      renewMs: this.#renewMs,
      now: this.#now,
      host: this.#host,
      pid: this.#pid,
      scheduler: this.#scheduler,
      leaseId: leaseId(key),
    });
  }

  async #takeOver(path: string, record: LockRecord): Promise<boolean> {
    const text = await readText(path);
    // The lock was released between the failed create and this read, so try the plain create again.
    if (text === undefined) return createExclusive(path, encode(record));
    const existing = parseRecord(text);
    if (existing === undefined) {
      return (await this.#unreadableIsStale(path)) && this.#reclaim(path, undefined, record);
    }
    return this.#isStale(existing) && this.#reclaim(path, existing.token, record);
  }
}

interface HoldOptions {
  readonly leaseMs: number;
  readonly renewMs: number;
  readonly now: () => number;
  readonly host: string;
  readonly pid: number;
  readonly scheduler: ProcessScheduler;
  readonly leaseId: string;
}

class Hold implements LockHandle {
  readonly token: string;
  #held = true;
  readonly #path: string;
  readonly #options: HoldOptions;
  readonly #renewals: LeaseRenewals;

  constructor(path: string, token: string, options: HoldOptions) {
    this.token = token;
    this.#path = path;
    this.#options = options;
    this.#renewals = new LeaseRenewals({
      scheduler: options.scheduler,
      renewMs: options.renewMs,
      wakeId: `${options.leaseId}/${token}`,
      held: () => this.#held,
      renew: () => this.#renew(),
      lose: () => this.#lose(),
    });
  }

  held(): boolean {
    return this.#held;
  }

  /**
   * Renews the lease by overwriting the lock's record in place through an open handle, never by replacing the file. A
   * lock that was removed can't come back, because the open fails, and a successor's lock is a different file, so a
   * stale renewal can't overwrite it. Only a missing lock or another holder's token ends the hold; any other error is
   * retried on the next tick.
   */
  async #renew(): Promise<void> {
    const file = await open(this.#path, "r+").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") this.#lose();
      return undefined;
    });
    if (file === undefined) return;
    try {
      const current = parseRecord(await file.readFile({ encoding: "utf8" }));
      if (current?.token !== this.token) return this.#lose();
      const { host, pid, now, leaseMs } = this.#options;
      await file.write(encode({ pid, host, token: this.token, leaseUntil: now() + leaseMs }), 0);
    } catch {
      // Retried on the next tick. A lease that lapses meanwhile can be taken over, which the next renewal then sees.
    } finally {
      await file.close().catch(() => undefined);
    }
  }

  #lose(): void {
    this.#held = false;
    this.#renewals.stop();
  }

  async release(): Promise<void> {
    this.#lose();
    // A renewal in progress finishes first, so it can't touch the lock after it is gone.
    await this.#renewals.idle();
    const current = parseRecord((await readText(this.#path)) ?? "");
    if (current?.token === this.token) await rm(this.#path, { force: true });
  }
}

function lockPath(dir: string, key: SessionKey): string {
  return join(dir, encodeName(key.userId), `${encodeName(key.sessionId)}${EXTENSION}`);
}

/** What `unlockSession()` removed: the lock's record, or `"unreadable"` when the file held no valid record. */
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
 * process no longer exists, so `acquire()` never takes a lock whose holder is alive or one from another host; only
 * `unlockSession()` removes those. Readers never lock.
 */
export function fileLock(options: FileLockOptions): SessionLock {
  return new FileLock(options);
}
