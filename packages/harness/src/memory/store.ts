/**
 * The records and the extension's bookkeeping over one `MemoryFiles`: which tool calls wrote or returned each record,
 * and the purge list a delete adds them to. Every change runs in one queue, so two calls of one step never interleave
 * their read and write of the same bookkeeping file.
 */
import { HarnessError } from "../errors.js";
import type { PurgeMark } from "../session/purge.js";
import type { MemoryFiles } from "./files.js";
import { isMemoryName } from "./paths.js";
import { isExpired, type MemoryRecord, parseRecord } from "./record.js";

/** The calls that wrote or returned each record, by its name. */
const CALLS_FILE = ".calls.json";
/** The marks of the records deleted so far, which a purge reads. */
const PURGE_FILE = ".purge.json";

/** A record that parsed, with its name. */
export interface NamedRecord {
  readonly name: string;
  readonly record: MemoryRecord;
}

const sameMark = (a: PurgeMark, b: PurgeMark): boolean =>
  a.callId === b.callId && a.tool === b.tool && a.runId === b.runId;

function addTo(list: PurgeMark[], marks: readonly PurgeMark[]): PurgeMark[] {
  for (const mark of marks) if (!list.some((held) => sameMark(held, mark))) list.push(mark);
  return list;
}

const isMark = (value: unknown): value is PurgeMark => {
  const mark = value as PurgeMark;
  return typeof mark?.runId === "string" && typeof mark.callId === "string" && typeof mark.tool === "string";
};

/**
 * A bookkeeping file's JSON, or `fallback` when it is missing. A file that is not what the extension wrote throws, so
 * a damaged purge list stops a delete instead of losing the marks it held.
 */
async function readJson<T>(files: MemoryFiles, name: string, fallback: T, check: (value: unknown) => boolean) {
  const text = await files.read(name);
  if (text === undefined) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (!check(value)) throw new HarnessError("memory_corrupt", `${name} is not a file the memory extension wrote`);
  return value as T;
}

const readCalls = (files: MemoryFiles) =>
  readJson<Record<string, PurgeMark[]>>(
    files,
    CALLS_FILE,
    {},
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((marks) => Array.isArray(marks) && marks.every(isMark)),
  );

/**
 * The purge list: the marks of every call that wrote or returned a record deleted since the list was last cleared.
 * Pass it to `purgeSession()` and to `pruneSessions()`, then clear the marks they settled with `clearPurgeMarks()`.
 */
export function readPurgeMarks(files: MemoryFiles): Promise<PurgeMark[]> {
  return readJson<PurgeMark[]>(files, PURGE_FILE, [], (value) => Array.isArray(value) && value.every(isMark));
}

/** Removes `marks` from the purge list, once the purges have removed their entries from every session that held them. */
export async function clearPurgeMarks(files: MemoryFiles, marks: readonly PurgeMark[]): Promise<void> {
  const held = await readPurgeMarks(files);
  const left = held.filter((mark) => !marks.some((done) => sameMark(done, mark)));
  if (left.length !== held.length) await files.write(PURGE_FILE, JSON.stringify(left));
}

/** The records of one memory folder, with the calls that touched them. */
export class RecordStore {
  readonly files: MemoryFiles;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(files: MemoryFiles) {
    this.files = files;
  }

  /** Runs `task` after every task queued before it, whether they succeeded or not. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** The record files: names under the folder that the tool may name and that end in `.md`. */
  async names(): Promise<string[]> {
    return (await this.files.list()).filter((name) => name.endsWith(".md") && isMemoryName(name)).sort();
  }

  /** The record at `name`: `undefined` when there is no file, `"invalid"` when the file is not a record. */
  async get(name: string): Promise<MemoryRecord | "invalid" | undefined> {
    const text = await this.files.read(name);
    if (text === undefined) return undefined;
    return parseRecord(text) ?? "invalid";
  }

  /**
   * Every record on disk, expired or not, which a call can still read until a `create` or a `delete` replaces it. A
   * file that is not a record, or can't be read, is left out.
   */
  async present(): Promise<NamedRecord[]> {
    const found: NamedRecord[] = [];
    for (const name of await this.names()) {
      const record = await this.get(name).catch(() => undefined);
      if (record !== undefined && record !== "invalid") found.push({ name, record });
    }
    return found;
  }

  /** Every record that holds at `now`. */
  async live(now: Date): Promise<NamedRecord[]> {
    return (await this.present()).filter(({ record }) => !isExpired(record, now));
  }

  /** Records that `mark`'s call wrote or returned the records at `names`. */
  async touched(names: readonly string[], mark: PurgeMark): Promise<void> {
    if (names.length === 0) return;
    const calls = await readCalls(this.files);
    for (const name of names) calls[name] = addTo(calls[name] ?? [], [mark]);
    await this.files.write(CALLS_FILE, JSON.stringify(calls));
  }

  /** Moves the calls that touched `from` to `to`, for a rename. */
  async moved(from: string, to: string): Promise<void> {
    const calls = await readCalls(this.files);
    if (calls[from] === undefined) return;
    calls[to] = addTo(calls[to] ?? [], calls[from]);
    delete calls[from];
    await this.files.write(CALLS_FILE, JSON.stringify(calls));
  }

  /**
   * Adds the calls that touched `name`, and `extra`, to the purge list, and forgets them for `name`. The purge list is
   * written before the calls file, so a crash between the two leaves a mark in both and never in neither.
   */
  async forget(name: string, extra: readonly PurgeMark[] = []): Promise<void> {
    const calls = await readCalls(this.files);
    const marks = [...(calls[name] ?? []), ...extra];
    if (marks.length > 0)
      await this.files.write(PURGE_FILE, JSON.stringify(addTo(await readPurgeMarks(this.files), marks)));
    if (calls[name] === undefined) return;
    delete calls[name];
    await this.files.write(CALLS_FILE, JSON.stringify(calls));
  }
}
