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
const MAX_NAME_BYTES = 200;

/** The options of `jsonlStore()`. */
export interface JsonlStoreOptions {
  /** The folder that holds the sessions. It is created on the first write. */
  readonly dir: string;
  /** The bound on one entry's JSON, in bytes. Default 64 KiB. */
  readonly maxEntryBytes?: number;
}

// Every byte outside [A-Za-z0-9_-] becomes %XX, dots included, so no id can name `..` or climb out of its folder.
function encodePart(part: string): string {
  const name = [...new TextEncoder().encode(part)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9_-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  if (name.length > MAX_NAME_BYTES) {
    throw new HarnessError("invalid_session_key", `a session name encodes to over ${MAX_NAME_BYTES} bytes`);
  }
  return name;
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
    return join(this.#dir, encodePart(userId));
  }

  #pathOf(key: SessionKey): string {
    return join(this.#userDir(key.userId), `${encodePart(key.sessionId)}${EXTENSION}`);
  }

  /** The log's state, from the cache when the file is the size it was left at, and from the file otherwise. */
  async #read(path: string): Promise<Read> {
    const size = await stat(path).then(
      (info) => info.size,
      () => -1,
    );
    if (size < 0) return { state: stateOf([]), size: 0, torn: false, exists: false };
    const cached = this.#cache.get(path);
    if (cached?.size === size) return { state: cached.state, size, torn: false, exists: true };
    const log = (await readLog(path)) as ReadLog;
    return { state: stateOf(log.entries), size: log.goodBytes, torn: log.tornBytes > 0, exists: true };
  }

  async #appendNow(key: SessionKey, inputs: readonly EntryInput[], options: AppendOptions | undefined) {
    const path = this.#pathOf(key);
    const { state, size, torn, exists } = await this.#read(path);
    const plan = planAppend(state, inputs, options, this.#maxBytes);
    if (plan.fresh.length === 0) return plan.result;
    await mkdir(this.#userDir(key.userId), { recursive: true });
    // The unterminated tail was never acknowledged, so cutting it off loses nothing, and keeps the next line apart from it.
    if (torn) await truncate(path, size);
    const data = `${plan.fresh.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await appendDurably(path, data, !exists);
    const state2 = stateOf([...state.byId.values(), ...plan.fresh]);
    this.#cache.set(path, { size: size + new TextEncoder().encode(data).length, state: state2 });
    return plan.result;
  }

  append(key: SessionKey, inputs: readonly EntryInput[], options?: AppendOptions): Promise<SessionEntry[]> {
    checkKey(key);
    const path = this.#pathOf(key);
    const turn = (this.#queues.get(path) ?? Promise.resolve()).then(() => this.#appendNow(key, inputs, options));
    this.#queues.set(
      path,
      turn.catch(() => undefined),
    );
    return turn;
  }

  async *load(key: SessionKey, options?: LoadOptions): AsyncGenerator<SessionEntry> {
    checkKey(key);
    const log = await readLog(this.#pathOf(key));
    if (log === undefined) return;
    if (log.tornBytes > 0) options?.onTornLine?.({ bytes: log.tornBytes });
    const from = options?.fromSeq ?? 0;
    for (const entry of log.entries) if (entry.seq >= from) yield entry;
  }

  async *list(userId: string): AsyncGenerator<SessionSummary> {
    checkKey({ userId, sessionId: "-" });
    const dir = this.#userDir(userId);
    const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = files.filter((file) => file.isFile()).map((file) => file.name);
    const found: SessionSummary[] = [];
    for (const name of names.filter((file) => file.endsWith(EXTENSION))) {
      const sessionId = decodeURIComponent(name.slice(0, -EXTENSION.length));
      const summary = summaryOf(sessionId, (await readLog(join(dir, name)))?.entries ?? []);
      if (summary !== undefined) found.push(summary);
    }
    yield* found.sort(byAge);
  }

  async delete(key: SessionKey): Promise<void> {
    checkKey(key);
    const path = this.#pathOf(key);
    this.#cache.delete(path);
    await rm(path, { force: true });
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
