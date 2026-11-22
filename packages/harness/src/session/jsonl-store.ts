/**
 * `jsonlStore()`: a `SessionStore` that keeps each session in one JSONL file, one entry per line, under a folder per
 * user. It needs Node's file system, so it has its own entry, `@buildanagent/harness/session/jsonl`, and the portable
 * `./session` entry stays free of it.
 */
import { mkdir, open, readdir, readFile, rm, stat, truncate } from "node:fs/promises";
import { join } from "node:path";
import { parseEntry, type SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import {
  type AppendOptions,
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  type EntryInput,
  encodeName,
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
}

interface ReadLog {
  readonly entries: SessionEntry[];
  /** The size of the file up to its last complete line. */
  readonly goodBytes: number;
  /** The bytes of an unterminated last line, or 0. */
  readonly tornBytes: number;
}

/** Reads a log: a line counts when it ends in a newline, and a last line that doesn't is torn. */
function parseLog(text: string, path: string): ReadLog {
  const end = text.lastIndexOf("\n") + 1;
  const entries: SessionEntry[] = [];
  const lines = text.slice(0, end).split("\n");
  lines.pop();
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(parseEntry(line));
    } catch (cause) {
      throw new HarnessError("session_corrupt", `${path} has a bad entry on line ${index + 1}`, { cause });
    }
  }
  const encoder = new TextEncoder();
  return {
    entries,
    goodBytes: encoder.encode(text.slice(0, end)).length,
    tornBytes: encoder.encode(text.slice(end)).length,
  };
}

async function readLog(path: string): Promise<ReadLog | undefined> {
  try {
    return parseLog(await readFile(path, "utf8"), path);
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

class JsonlStore implements SessionStore {
  readonly #dir: string;
  readonly #maxBytes: number;
  readonly #cache = new Map<string, { size: number; state: LogState }>();
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(options: JsonlStoreOptions) {
    this.#dir = options.dir;
    this.#maxBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
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
    const { state, size, torn, exists } = await this.#read(path);
    const plan = planAppend(state, inputs, options, this.#maxBytes);
    if (plan.fresh.length === 0) return structuredClone(plan.result);
    const created = await mkdir(this.#userDir(key.userId), { recursive: true });
    // A folder this call made is only durable once the folder above it is.
    if (created !== undefined) await Promise.all([syncFolder(join(created, "..")), syncFolder(this.#dir)]);
    // The unterminated tail was never acknowledged, so cutting it off loses nothing, and keeps the next line apart from it.
    if (torn) await truncate(path, size);
    const data = `${plan.fresh.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await appendDurably(path, data, !exists);
    this.#remember(
      path,
      size + new TextEncoder().encode(data).length,
      stateOf([...state.byId.values(), ...plan.fresh]),
    );
    return structuredClone(plan.result);
  }

  async append(key: SessionKey, inputs: readonly EntryInput[], options?: AppendOptions): Promise<SessionEntry[]> {
    checkKey(key);
    const path = this.#pathOf(key);
    return this.#queued(path, () => this.#appendNow(key, inputs, options));
  }

  async *load(key: SessionKey, options?: LoadOptions): AsyncGenerator<SessionEntry> {
    checkKey(key);
    const path = this.#pathOf(key);
    // A load waits for the appends already queued, so it never sees a line that is still being written.
    const log = await this.#queued(path, () => readLog(path));
    if (log === undefined) return;
    if (log.tornBytes > 0) options?.onTornLine?.({ bytes: log.tornBytes });
    const from = options?.fromSeq ?? 0;
    for (const entry of log.entries) if (entry.seq >= from) yield entry;
  }

  async *list(userId: string): AsyncGenerator<SessionSummary> {
    checkKey({ userId, sessionId: "-" });
    const dir = this.#userDir(userId);
    const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const found: SessionSummary[] = [];
    for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith(EXTENSION))) {
      const summary = await this.#summary(dir, file.name);
      if (summary !== undefined) found.push(summary);
    }
    yield* found.sort(byAge);
  }

  /** One file's summary, or `undefined` for a file the store didn't write or can't read, so one bad file hides no other. */
  async #summary(dir: string, name: string): Promise<SessionSummary | undefined> {
    try {
      const sessionId = decodeURIComponent(name.slice(0, -EXTENSION.length));
      return summaryOf(sessionId, (await readLog(join(dir, name)))?.entries ?? []);
    } catch {
      return undefined;
    }
  }

  async delete(key: SessionKey): Promise<void> {
    checkKey(key);
    const path = this.#pathOf(key);
    await this.#queued(path, async () => {
      this.#cache.delete(path);
      await rm(path, { force: true });
    });
  }
}

/**
 * A store that keeps each session in `<dir>/<user>/<session>.jsonl`, one JSON entry per line. Each append is one write
 * of whole lines followed by an `fsync`, so a crash leaves at most one unterminated last line, which `load()` skips and
 * the next append cuts off before it writes. Names are percent-encoded, so no id can reach another user's folder. A
 * log's state is cached by file size, so one process appends without rereading the file, and another process's write
 * is seen on the next append. Appends to one session from one process run one at a time, and a second process needs the
 * writer lock.
 */
export function jsonlStore(options: JsonlStoreOptions): SessionStore {
  return new JsonlStore(options);
}
