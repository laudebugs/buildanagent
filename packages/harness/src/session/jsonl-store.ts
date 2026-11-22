/**
 * `jsonlStore()`: a `SessionStore` that keeps each session in one JSONL file, one entry per line, under a folder per
 * user. It needs Node's file system, so it has its own entry, `@buildanagent/harness/session/jsonl`, and the portable
 * `./session` entry stays free of it.
 */
import { Buffer } from "node:buffer";
import { mkdir, open, readdir, readFile, rm, stat, truncate } from "node:fs/promises";
import { basename, join } from "node:path";
import { isProtocolError, parseEntry, type SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { SessionLock } from "./lock.js";
import {
  ARCHIVE_DIR,
  ARCHIVE_EXTENSION,
  archivePath,
  checkRetention,
  pruneSessions,
  type Retention,
  readArchive,
  restoreArchive,
} from "./retention.js";
import {
  type AppendOptions,
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  type EntryInput,
  encodeName,
  extendState,
  type LoadOptions,
  type LogState,
  planAppend,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
  stateOf,
  summaryOf,
} from "./store.js";

const EXTENSION = ".jsonl";

/** The options of `jsonlStore()`. */
export interface JsonlStoreOptions {
  /** The folder that holds the sessions. It is created on the first write. */
  readonly dir: string;
  /** The bound on one entry's JSON, in bytes. Default 64 KiB. */
  readonly maxEntryBytes?: number;
  /**
   * How long to keep a session. Without it the store never deletes or moves a file. With it, the first time the store
   * touches a user's sessions, it archives or purges that user's expired ones (see `pruneSessions()`), and it never does
   * so in the background. A pass that had an error runs again on the first touch at least a minute after it ended. An
   * archived session is still listed and loaded, and a write restores the file it writes to.
   */
  readonly retention?: Retention;
  /** The writer lock, so that expiry leaves a session whose writer is running. Only used with `retention`. */
  readonly lock?: SessionLock;
  /**
   * Called with each error of an expiry pass: one for each session that failed to expire, or the one that stopped the
   * pass. Expiry never stops the call that triggered it, and an error this callback throws is ignored.
   */
  readonly onRetentionError?: (error: unknown) => void;
  /** The clock expiry reads, for its cutoff and for when a failed pass may run again. Default `new Date()`. */
  readonly now?: () => Date;
}

interface ReadLog {
  readonly entries: SessionEntry[];
  /** The size of the file up to its last complete line. */
  readonly goodBytes: number;
  /** The bytes of an unterminated last line, or 0. */
  readonly tornBytes: number;
}

/** Reads a log: a line counts when it ends in a newline, and a last line that doesn't is torn. Sizes are bytes of the file. */
function parseLog(buffer: Buffer, path: string): ReadLog {
  const end = buffer.lastIndexOf(0x0a) + 1;
  const entries: SessionEntry[] = [];
  const lines = buffer.subarray(0, end).toString("utf8").split("\n");
  lines.pop();
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(parseEntry(line));
    } catch (cause) {
      // A header from another format isn't corruption: the file is whole and needs a migration or a newer harness.
      const format = isProtocolError(cause) && cause.code === "unsupported_format_version";
      throw new HarnessError(
        format ? "unsupported_format" : "session_corrupt",
        `${path} has ${format ? "a log in a format this harness doesn't read" : "a bad entry"} on line ${index + 1}`,
        { cause },
      );
    }
  }
  return { entries, goodBytes: end, tornBytes: buffer.length - end };
}

async function readLog(path: string): Promise<ReadLog | undefined> {
  try {
    return parseLog(await readFile(path), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Writes `data` at the end of the file and flushes it to disk before returning. */
async function appendDurably(path: string, data: string, isNew: boolean): Promise<void> {
  const file = await open(path, "a");
  try {
    await file.appendFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  if (isNew) await syncFolder(join(path, ".."));
}

// A new file is only durable once its folder entry is. Some platforms refuse to open a folder, and then there's nothing to do.
async function syncFolder(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* the platform can't flush a folder */
  }
}

interface Read {
  readonly state: LogState;
  /** The size of the file up to its last complete line. */
  readonly size: number;
  readonly torn: boolean;
  readonly exists: boolean;
}

// Enough for the sessions a process is working on; a log that falls out is read again from its file on the next append.
const MAX_CACHED_LOGS = 64;
// An archived file never changes in place, so its summary is kept by path, size and time; this bounds the memory.
const MAX_CACHED_SUMMARIES = 1024;
// How long a failed expiry pass waits before a touch of the same user runs it again.
const RETRY_AFTER_MS = 60_000;

interface Expiry {
  readonly done: Promise<void>;
  /** When a failed pass may run again, set once the pass has ended with an error. */
  retryAt?: number;
}

class JsonlStore implements SessionStore {
  readonly #dir: string;
  readonly #maxBytes: number;
  readonly #options: JsonlStoreOptions;
  readonly #expiry = new Map<string, Expiry>();
  readonly #archived = new Map<string, { size: number; mtimeMs: number; summary: SessionSummary | undefined }>();
  readonly #cache = new Map<string, { size: number; state: LogState }>();
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(options: JsonlStoreOptions) {
    this.#dir = options.dir;
    this.#maxBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    this.#options = options;
    if (options.retention !== undefined) checkRetention(options.retention);
  }

  #now(): number {
    return (this.#options.now?.() ?? new Date()).getTime();
  }

  /**
   * Expires a user's sessions the first time this store touches them, and again after a failed pass once its wait is
   * over. A failure is reported and never thrown, so the returned promise always resolves.
   */
  #expire(userId: string): Promise<void> {
    const { retention } = this.#options;
    if (retention === undefined) return Promise.resolve();
    const known = this.#expiry.get(userId);
    if (known !== undefined && (known.retryAt === undefined || this.#now() < known.retryAt)) return known.done;
    const expiry: Expiry = {
      done: this.#prune(userId, retention).then((failed) => {
        if (failed) expiry.retryAt = this.#now() + RETRY_AFTER_MS;
      }),
    };
    this.#expiry.set(userId, expiry);
    return expiry.done;
  }

  /** One expiry pass. Resolves to whether it had an error, and never rejects. */
  async #prune(userId: string, retention: Retention): Promise<boolean> {
    try {
      const result = await pruneSessions({
        dir: this.#dir,
        userId,
        retention,
        now: () => new Date(this.#now()),
        ...(this.#options.lock === undefined ? {} : { lock: this.#options.lock }),
      });
      for (const { error } of result.errors) this.#report(error);
      return result.errors.length > 0;
    } catch (error) {
      this.#report(error);
      return true;
    }
  }

  #report(error: unknown): void {
    try {
      this.#options.onRetentionError?.(error);
    } catch {
      /* the callback's own failure must not stop the session, nor every later call for the user */
    }
  }

  /** The log in the live file, or else in its archive. */
  async #readAny(key: SessionKey, path: string): Promise<ReadLog | undefined> {
    const live = await readLog(path);
    if (live !== undefined) return live;
    const archived = await readArchive(archivePath(this.#dir, key.userId, key.sessionId));
    return archived === undefined ? undefined : parseLog(archived, path);
  }

  #userDir(userId: string): string {
    return join(this.#dir, encodeName(userId));
  }

  #pathOf(key: SessionKey): string {
    return join(this.#userDir(key.userId), `${encodeName(key.sessionId)}${EXTENSION}`);
  }

  /** Runs `task` after every earlier task on this file, so one process's appends, deletes and loads never interleave. */
  #queued<T>(path: string, task: () => Promise<T>): Promise<T> {
    const turn = (this.#queues.get(path) ?? Promise.resolve()).then(task);
    const tail = turn.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(path, tail);
    // The entry is only needed while a task is waiting, so the map doesn't grow with every session ever touched.
    void tail.then(() => {
      if (this.#queues.get(path) === tail) this.#queues.delete(path);
    });
    return turn;
  }

  #remember(path: string, size: number, state: LogState): void {
    this.#cache.delete(path);
    this.#cache.set(path, { size, state });
    const oldest = this.#cache.keys().next().value;
    if (this.#cache.size > MAX_CACHED_LOGS && oldest !== undefined) this.#cache.delete(oldest);
  }

  /** The log's state, from the cache when the file is the size it was left at, and from the file otherwise. */
  async #read(path: string): Promise<Read> {
    const size = await stat(path).then(
      (info) => info.size,
      () => -1,
    );
    const cached = this.#cache.get(path);
    if (size >= 0 && cached?.size === size) return { state: cached.state, size, torn: false, exists: true };
    const log = size < 0 ? undefined : await readLog(path);
    if (log === undefined) return { state: stateOf([]), size: 0, torn: false, exists: false };
    return { state: stateOf(log.entries), size: log.goodBytes, torn: log.tornBytes > 0, exists: true };
  }

  async #appendNow(key: SessionKey, inputs: readonly EntryInput[], options: AppendOptions | undefined) {
    const path = this.#pathOf(key);
    let read = await this.#read(path);
    // Writing an archived session brings its file back, so the log grows where the store looks for it.
    if (!read.exists && (await restoreArchive(this.#dir, key.userId, key.sessionId, path)))
      read = await this.#read(path);
    const { state, size, torn, exists } = read;
    const plan = planAppend(state, inputs, options, this.#maxBytes);
    if (plan.fresh.length === 0) return structuredClone(plan.result);
    const created = await mkdir(this.#userDir(key.userId), { recursive: true });
    // A folder this call made is only durable once the folder above it is.
    if (created !== undefined) await Promise.all([syncFolder(join(created, "..")), syncFolder(this.#dir)]);
    // The unterminated tail was never acknowledged, so cutting it off loses nothing, and keeps the next line apart from it.
    if (torn) await truncate(path, size);
    const data = `${plan.fresh.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await appendDurably(path, data, !exists);
    this.#remember(path, size + Buffer.byteLength(data), extendState(state, plan.fresh));
    return structuredClone(plan.result);
  }

  async append(key: SessionKey, inputs: readonly EntryInput[], options?: AppendOptions): Promise<SessionEntry[]> {
    checkKey(key);
    const path = this.#pathOf(key);
    // Expiry waits inside the queue, so adding it never changes the order in which calls to one session run.
    return this.#queued(path, async () => {
      await this.#expire(key.userId);
      return this.#appendNow(key, inputs, options);
    });
  }

  load(key: SessionKey, options?: LoadOptions): AsyncGenerator<SessionEntry> {
    checkKey(key);
    return this.#entries(key, options);
  }

  async *#entries(key: SessionKey, options: LoadOptions | undefined): AsyncGenerator<SessionEntry> {
    const path = this.#pathOf(key);
    // A load waits for the appends already queued, so it never sees a line that is still being written.
    const log = await this.#queued(path, async () => {
      await this.#expire(key.userId);
      return this.#readAny(key, path);
    });
    if (log === undefined) return;
    if (log.tornBytes > 0) options?.onTornLine?.({ bytes: log.tornBytes });
    const from = options?.fromSeq ?? 0;
    for (const entry of log.entries) if (entry.seq >= from) yield entry;
  }

  loadRaw(key: SessionKey): AsyncGenerator<unknown> {
    checkKey(key);
    return this.#raw(key);
  }

  async *#raw(key: SessionKey): AsyncGenerator<unknown> {
    const path = this.#pathOf(key);
    const buffer = await this.#queued(path, async () => {
      await this.#expire(key.userId);
      return readFile(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return readArchive(archivePath(this.#dir, key.userId, key.sessionId));
      });
    });
    if (buffer === undefined) return;
    const complete = buffer
      .subarray(0, buffer.lastIndexOf(0x0a) + 1)
      .toString("utf8")
      .split("\n");
    complete.pop();
    for (const [index, line] of complete.entries()) {
      try {
        yield JSON.parse(line);
      } catch (cause) {
        throw new HarnessError("session_corrupt", `${path} has a bad entry on line ${index + 1}`, { cause });
      }
    }
  }

  list(userId: string): AsyncGenerator<SessionSummary> {
    checkKey({ userId, sessionId: "-" });
    return this.#summaries(userId);
  }

  async *#summaries(userId: string): AsyncGenerator<SessionSummary> {
    await this.#expire(userId);
    const dir = this.#userDir(userId);
    const archiveDir = join(this.#dir, ARCHIVE_DIR, encodeName(userId));
    const live = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const archived = await readdir(archiveDir, { withFileTypes: true }).catch(() => []);
    const found: SessionSummary[] = [];
    const seen = new Set<string>();
    for (const [folder, files, extension] of [
      [dir, live, EXTENSION],
      [archiveDir, archived, ARCHIVE_EXTENSION],
    ] as const) {
      for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith(extension))) {
        const summary = await this.#summary(join(folder, file.name), extension, seen);
        if (summary !== undefined) found.push(summary);
      }
    }
    yield* found.sort(byAge);
  }

  /**
   * One file's summary, or `undefined` for a file the store didn't write or can't read, so one bad file hides no other.
   * A session that is both live and archived is mid-move, and the live file, which is read first, is whole.
   */
  async #summary(path: string, extension: string, seen: Set<string>): Promise<SessionSummary | undefined> {
    try {
      const sessionId = decodeURIComponent(basename(path).slice(0, -extension.length));
      if (seen.has(sessionId)) return undefined;
      seen.add(sessionId);
      if (extension === EXTENSION) return summaryOf(sessionId, (await readLog(path))?.entries ?? []);
      return await this.#archivedSummary(sessionId, path);
    } catch {
      return undefined;
    }
  }

  /** An archived file's summary, unpacked once and then kept while the file keeps its size and modification time. */
  async #archivedSummary(sessionId: string, path: string): Promise<SessionSummary | undefined> {
    const info = await stat(path);
    const cached = this.#archived.get(path);
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      return structuredClone(cached.summary);
    }
    const bytes = await readArchive(path);
    if (bytes === undefined) return undefined;
    const summary = summaryOf(sessionId, parseLog(bytes, path).entries);
    this.#archived.delete(path);
    this.#archived.set(path, { size: info.size, mtimeMs: info.mtimeMs, summary });
    const oldest = this.#archived.keys().next().value;
    if (this.#archived.size > MAX_CACHED_SUMMARIES && oldest !== undefined) this.#archived.delete(oldest);
    return structuredClone(summary);
  }

  async delete(key: SessionKey): Promise<void> {
    checkKey(key);
    const path = this.#pathOf(key);
    await this.#queued(path, async () => {
      // A delete waits for expiry like every other call, so a pass that is moving this file can't bring it back.
      await this.#expire(key.userId);
      this.#cache.delete(path);
      await rm(path, { force: true });
      await rm(archivePath(this.#dir, key.userId, key.sessionId), { force: true });
    });
  }
}

/**
 * A store that keeps each session in `<dir>/<user>/<session>.jsonl`, one JSON entry per line. Each append is one write
 * of whole lines followed by an `fsync`, so a crash leaves at most one unterminated last line, which `load()` skips and
 * the next append cuts off before it writes. Names are percent-encoded, so no id can reach another user's folder. A
 * log's state is cached by file size, so one process appends without rereading the file, and another process's write
 * is seen on the next append. Appends to one session from one process run one at a time, and a second process needs the
 * writer lock. With `retention`, expired sessions are gzipped into `<dir>/.archive/<user>/` or deleted, and without it
 * no file is ever deleted or moved.
 */
export function jsonlStore(options: JsonlStoreOptions): SessionStore {
  return new JsonlStore(options);
}
