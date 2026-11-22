/**
 * The records and the extension's bookkeeping over one `MemoryFiles`: which tool calls wrote or returned each record,
 * and the purge list a delete adds them to. Every change runs in one queue, so two calls of one step never interleave
 * their read and write of the same bookkeeping file.
 */
import { HarnessError, isHarnessError } from "../errors.js";
import type { PurgeMark } from "../session/purge.js";
import type { MemoryFiles } from "./files.js";
import { isMemoryName } from "./paths.js";
import { isExpired, type MemoryRecord, parseRecord } from "./record.js";

/** The calls that wrote or returned each record, by its name. */
const CALLS_FILE = ".calls.json";
/** The marks of the records deleted so far, which a purge reads. */
const PURGE_FILE = ".purge.json";
/** Where a calls file the extension can't read is set aside, so memory keeps working without it. */
const UNREAD_CALLS_FILE = ".calls-unread.json";

/** The most calls kept for one record; older ones go to the purge list. */
const MAX_CALLS_PER_RECORD = 100;
/** The most bytes the calls file is written with; past it, each record keeps fewer of its newest calls. */
const MAX_CALLS_BYTES = 2 * 1024 * 1024;
/** How long a mark that no session held stays on the purge list, in days, once a full pass reports it unmatched. */
const STALE_MARK_DAYS = 30;
const DAY_MS = 86_400_000;

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
  return (
    typeof mark?.runId === "string" &&
    typeof mark.callId === "string" &&
    typeof mark.tool === "string" &&
    (mark.at === undefined || typeof mark.at === "string")
  );
};

/** The marks as they join the purge list: each dated `at`, unless it already carries a date. */
const dated = (marks: readonly PurgeMark[], at: Date): PurgeMark[] =>
  marks.map((mark) => (mark.at === undefined ? { ...mark, at: at.toISOString() } : mark));

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

const parseCalls = (files: MemoryFiles) =>
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
 * The calls file, or no calls when it can't be read: too long, not what the extension wrote, or not a regular file.
 * Such a file is moved to `UNREAD_CALLS_FILE` for a person to look at, replacing an earlier one, so memory keeps
 * working; a later delete of a record no longer purges the calls it held. When even the move fails, the error stands.
 */
async function readCalls(files: MemoryFiles): Promise<Record<string, PurgeMark[]>> {
  try {
    return await parseCalls(files);
  } catch (error) {
    if (!isHarnessError(error)) throw error;
    try {
      await files.remove(UNREAD_CALLS_FILE);
      await files.rename(CALLS_FILE, UNREAD_CALLS_FILE);
    } catch {
      throw error;
    }
    return {};
  }
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Bounds the calls before they are written: the calls of a record whose file is gone, other than `keep`, and each
 * record's oldest calls past `MAX_CALLS_PER_RECORD`, or past a smaller count while the file would exceed
 * `MAX_CALLS_BYTES`, leave the calls file. Returns them for the purge list, so no call that held a record is lost.
 */
function bounded(calls: Record<string, PurgeMark[]>, present: ReadonlySet<string>, keep: readonly string[]) {
  const spilled: PurgeMark[] = [];
  for (const [name, marks] of Object.entries(calls)) {
    if (present.has(name) || keep.includes(name)) continue;
    spilled.push(...marks);
    delete calls[name];
  }
  let text = "";
  for (let cap = MAX_CALLS_PER_RECORD; ; cap = Math.floor(cap / 2)) {
    for (const marks of Object.values(calls))
      if (marks.length > cap) spilled.push(...marks.splice(0, marks.length - cap));
    text = JSON.stringify(calls);
    if (cap <= 1 || byteLength(text) <= MAX_CALLS_BYTES) break;
  }
  return { text, spilled };
}

/**
 * The purge list: the marks of every call that wrote or returned a record deleted since the list was last cleared.
 * Pass it to `purgeSession()` and to `pruneSessions()`, then clear the marks they settled with `clearPurgeMarks()`.
 */
export function readPurgeMarks(files: MemoryFiles): Promise<PurgeMark[]> {
  return readJson<PurgeMark[]>(files, PURGE_FILE, [], (value) => Array.isArray(value) && value.every(isMark));
}

// One queue per file store, shared by every `RecordStore` over it and by `clearPurgeMarks()`, so a clear never
// interleaves its read and write of the purge list with a delete that adds to it.
const queues = new WeakMap<MemoryFiles, Promise<unknown>>();

/** Runs `task` after every task queued on `files` before it, whether they succeeded or not. */
function exclusiveOn<T>(files: MemoryFiles, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(files) ?? Promise.resolve()).then(task, task);
  queues.set(
    files,
    run.catch(() => undefined),
  );
  return run;
}

/** The options of `clearPurgeMarks()`. */
export interface ClearPurgeMarksOptions {
  /**
   * Marks that a pass looked for in every session that could hold them, live and archived, and found in none, such as
   * the mark of a call whose entries never reached the log. Each one leaves the purge list once it has been on it for
   * 30 days; one with no date is dated now and leaves 30 days later. A mark an archive still holds is not unmatched.
   */
  readonly unmatched?: readonly PurgeMark[];
  /** The clock the 30 days are counted on. Default the system clock; a test passes a fixed one. */
  readonly clock?: () => Date;
}

/**
 * Removes `marks`, and only those, from the purge list, once the purges have removed their entries from every session
 * that held them, and drops the `unmatched` marks that have waited 30 days. It waits for the memory calls of any
 * extension in this process over the same `files` object, so a delete that runs meanwhile keeps the marks it adds;
 * `fileMemoryFiles()` gives one object per root. Nothing coordinates two processes, so run it where no session over
 * the same folder is running in another process.
 */
export function clearPurgeMarks(
  files: MemoryFiles,
  marks: readonly PurgeMark[],
  options: ClearPurgeMarksOptions = {},
): Promise<void> {
  return exclusiveOn(files, async () => {
    const now = (options.clock ?? (() => new Date()))();
    const unmatched = options.unmatched ?? [];
    const held = await readPurgeMarks(files);
    let changed = false;
    const left = held.flatMap((mark): PurgeMark[] => {
      if (marks.some((done) => sameMark(done, mark))) {
        changed = true;
        return [];
      }
      if (!unmatched.some((stale) => sameMark(stale, mark))) return [mark];
      changed = true;
      if (mark.at === undefined) return dated([mark], now);
      // A date that doesn't parse can't be aged, so the mark stays until a purge settles it.
      const since = Date.parse(mark.at);
      return Number.isNaN(since) || now.getTime() - since < STALE_MARK_DAYS * DAY_MS ? [mark] : [];
    });
    if (changed) await files.write(PURGE_FILE, JSON.stringify(left));
  });
}

/** The records of one memory folder, with the calls that touched them. */
export class RecordStore {
  readonly files: MemoryFiles;
  readonly #now: () => Date;

  /** `now` dates each mark as it joins the purge list. */
  constructor(files: MemoryFiles, now: () => Date = () => new Date()) {
    this.files = files;
    this.#now = now;
  }

  /** Adds `marks` to the purge list, each dated now. */
  async #toPurgeList(marks: readonly PurgeMark[]): Promise<void> {
    await this.files.write(
      PURGE_FILE,
      JSON.stringify(addTo(await readPurgeMarks(this.files), dated(marks, this.#now()))),
    );
  }

  /** Runs `task` after every task queued on the same file store before it, whether they succeeded or not. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    return exclusiveOn(this.files, task);
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

  /**
   * Writes the calls file within its bounds. The calls that leave it go to the purge list first, so a crash between
   * the two writes leaves a mark in both and never in neither. `keep` names records about to be written.
   */
  async #saveCalls(calls: Record<string, PurgeMark[]>, keep: readonly string[] = []): Promise<void> {
    const { text, spilled } = bounded(calls, new Set(await this.names()), keep);
    if (spilled.length > 0) await this.#toPurgeList(spilled);
    await this.files.write(CALLS_FILE, text);
  }

  /** Records that `mark`'s call wrote or returned the records at `names`. */
  async touched(names: readonly string[], mark: PurgeMark): Promise<void> {
    if (names.length === 0) return;
    const calls = await readCalls(this.files);
    for (const name of names) calls[name] = addTo(calls[name] ?? [], [mark]);
    await this.#saveCalls(calls, names);
  }

  /** Moves the calls that touched `from` to `to`, for a rename. */
  async moved(from: string, to: string): Promise<void> {
    const calls = await readCalls(this.files);
    if (calls[from] === undefined) return;
    calls[to] = addTo(calls[to] ?? [], calls[from]);
    delete calls[from];
    await this.#saveCalls(calls, [to]);
  }

  /**
   * Adds the calls that touched `name`, and `extra`, to the purge list, and forgets them for `name`. The purge list is
   * written before the calls file, so a crash between the two leaves a mark in both and never in neither.
   */
  async forget(name: string, extra: readonly PurgeMark[] = []): Promise<void> {
    const calls = await readCalls(this.files);
    const marks = [...(calls[name] ?? []), ...extra];
    if (marks.length > 0) await this.#toPurgeList(marks);
    if (calls[name] === undefined) return;
    delete calls[name];
    await this.#saveCalls(calls);
  }
}
