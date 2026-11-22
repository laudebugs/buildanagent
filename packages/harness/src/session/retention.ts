/**
 * Retention for a `jsonlStore()` folder. Nothing is ever deleted unless the caller sets a retention period: an expired
 * session is then gzipped into `.archive/`, where the store still lists and loads it, or deleted with its pointer. The
 * code only runs when a caller asks, either through `pruneSessions()` or when the store first touches a user, and never
 * on a timer. Every doubt resolves to keeping a file: a file the run cannot read, a session it cannot date and a session
 * that a surviving one continues are all left where they are.
 */
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { type FileHandle, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import type { SessionEntry } from "@buildanagent/protocol";
import { HarnessError, isHarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "./lock.js";
import { marksIn, ownsContinued, type PurgeMark } from "./purge.js";
import { isDerivedFile } from "./session.js";
import { checkKey, encodeName } from "./store.js";

const gunzip = promisify(gunzipCallback);
const gzip = promisify(gzipCallback);

/**
 * The folder under the store's folder that holds archived sessions, one folder per user. `encodeName()` encodes every
 * `.`, so no user's folder can have this name.
 */
export const ARCHIVE_DIR = ".archive";
/** The extension of an archived file: the session file's `.jsonl`, gzipped. */
export const ARCHIVE_EXTENSION = ".jsonl.gz";
const LIVE_EXTENSION = ".jsonl";
const POINTER_EXTENSION = ".pointer.json";
const DAY_MS = 86_400_000;
// How much of a live file one read takes, while the run looks for its first and last lines.
const CHUNK_BYTES = 64 * 1024;
// An archive never changes in place, so what it holds is kept by path, size, time and inode; this bounds the memory.
const MAX_CACHED_ARCHIVES = 1024;

/** How long to keep a session after its last entry, and what to do with it then. */
export interface Retention {
  /** Days since the session's last entry. A positive number. */
  readonly days: number;
  /** `archive` gzips the session's files into `.archive/`, where the store still reads them. `purge` deletes them. */
  readonly action: "archive" | "purge";
}

/** The options of `pruneSessions()`. */
export interface PruneOptions {
  /** The store's folder. */
  readonly dir: string;
  readonly userId: string;
  /** Without it nothing is touched, so a caller that has no retention period can pass its setting through unchecked. */
  readonly retention?: Retention;
  /** The clock. Default `new Date()`. */
  readonly now?: () => Date;
  /**
   * The writer lock. A session whose lock is held is kept, and the run holds each lock it takes until that session is
   * archived, purged or kept.
   */
  readonly lock?: SessionLock;
  /**
   * The purge list, such as the memory extension's `readPurgeMarks()` gives it. With it, the result says which marks a
   * purge removed with their sessions, in `purgedMarks`, and which archived sessions still hold marked entries, in
   * `markedArchives`, for a targeted purge. An archive keeps a marked entry as it is: only a purge removes it.
   */
  readonly marks?: readonly PurgeMark[];
}

/**
 * Why an expired session was left alone. `locked`: a writer holds its lock. `continued`: a surviving session continues
 * its log. `unreadable`: a file of it, its pointer or, for a purge, any file in the user's folder could not be read, so
 * the run can't tell whether it is expired or continued. `error`: expiring it failed, and the error is in `errors`.
 */
export type KeptReason = "locked" | "continued" | "unreadable" | "error";

/** What `pruneSessions()` did, by session id. */
export interface PruneResult {
  readonly archived: string[];
  readonly purged: string[];
  /** Expired sessions left alone, and why. */
  readonly kept: Array<{ readonly sessionId: string; readonly reason: KeptReason }>;
  /**
   * Files the run left untouched because it could not read them or tell which session they belong to, by name under the
   * user's folder or the user's archive folder. A file with no complete line holds nothing and is not listed.
   */
  readonly skipped: string[];
  /** What stopped each session in `kept` with reason `error`. The run went on with the other sessions. */
  readonly errors: Array<{ readonly sessionId: string; readonly error: unknown }>;
  /** With `marks`: the marks with an entry in a session this run purged, so the host can drop them from its list. */
  readonly purgedMarks?: PurgeMark[];
  /** With `marks`: the sessions this run archived that hold a marked entry, which `purgeSession()` can still clean. */
  readonly markedArchives?: string[];
}

/** Throws a `HarnessError` with code `invalid_retention` unless `days` is a positive finite number and `action` is known. */
export function checkRetention(retention: Retention): void {
  if (!Number.isFinite(retention?.days) || retention.days <= 0) {
    throw new HarnessError("invalid_retention", "retention.days must be a positive number");
  }
  if (retention.action !== "archive" && retention.action !== "purge") {
    throw new HarnessError("invalid_retention", 'retention.action must be "archive" or "purge"');
  }
}

/** Where a session file's archive is. */
export const archivePath = (dir: string, userId: string, file: string): string =>
  join(dir, ARCHIVE_DIR, encodeName(userId), `${encodeName(file)}${ARCHIVE_EXTENSION}`);

/** The bytes of an archived file, or `undefined` when there is none. */
export async function readArchive(path: string): Promise<Buffer | undefined> {
  let packed: Buffer;
  try {
    packed = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return await gunzip(packed);
  } catch (error) {
    throw new HarnessError("session_corrupt", `${path} is not a readable archive`, { cause: error });
  }
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** A file's bytes, or `undefined` when it is gone, so a file deleted while the run goes on is simply not there. */
async function readIfThere(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function flushFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Writes `data` to `path` through a temp file and a rename, flushed, so a crash leaves the old file or the new. */
async function writeAtomically(path: string, data: Uint8Array): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await flushFile(join(path, "..")).catch(() => undefined);
}

/** Moves a file's archive back to its place, for a session that is written again. Returns whether there was one. */
export async function restoreArchive(dir: string, userId: string, file: string, live: string): Promise<boolean> {
  const archived = archivePath(dir, userId, file);
  const bytes = await readArchive(archived);
  if (bytes === undefined) return false;
  await writeAtomically(live, bytes);
  await rm(archived, { force: true });
  return true;
}

/** What a file holds, as far as retention needs to know. */
type Contents =
  /** A session log. `lastAt` is `undefined` when its last line can't be read, so the file can't be dated. */
  | { readonly kind: "log"; readonly lastAt: number | undefined; readonly continues: string | undefined }
  /** A file whose first line is not a session header, so nothing is known of it. */
  | { readonly kind: "opaque" };

/** A file's first and last complete lines, which may be the same line. A last line without a newline doesn't count. */
interface Edges {
  readonly first: Buffer;
  readonly last: Buffer;
}

/** The edges of a whole file's bytes, or `undefined` for a file with no complete line, which was never acknowledged. */
function edgesOf(bytes: Buffer): Edges | undefined {
  const firstEnd = bytes.indexOf(0x0a);
  if (firstEnd < 0) return undefined;
  const end = bytes.lastIndexOf(0x0a);
  const start = end === firstEnd ? 0 : bytes.lastIndexOf(0x0a, end - 1) + 1;
  return { first: bytes.subarray(0, firstEnd), last: bytes.subarray(start, end) };
}

/** Reads up to `length` bytes at `position`, fewer when the file is shorter. */
async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** The position of the last newline before `before`, or -1, read backwards a chunk at a time. */
async function newlineBefore(handle: FileHandle, before: number): Promise<number> {
  for (let end = before; end > 0; end -= CHUNK_BYTES) {
    const start = Math.max(0, end - CHUNK_BYTES);
    const at = (await readAt(handle, start, end - start)).lastIndexOf(0x0a);
    if (at >= 0) return start + at;
  }
  return -1;
}

/**
 * A live file's edges, read from its two ends, so a long log costs two short reads; `"empty"` for a file with no complete
 * line, and `"gone"` for a file that is not there. The bytes past the size the file had when it was opened don't count.
 */
async function liveEdges(path: string): Promise<Edges | "empty" | "gone"> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return "gone";
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const head: Buffer[] = [];
    let firstEnd = -1;
    for (let at = 0; at < size && firstEnd < 0; ) {
      const chunk = await readAt(handle, at, Math.min(CHUNK_BYTES, size - at));
      if (chunk.length === 0) break;
      const newline = chunk.indexOf(0x0a);
      head.push(newline < 0 ? chunk : chunk.subarray(0, newline));
      if (newline >= 0) firstEnd = at + newline;
      at += chunk.length;
    }
    if (firstEnd < 0) return "empty";
    const first = Buffer.concat(head);
    const end = await newlineBefore(handle, size);
    if (end <= firstEnd) return { first, last: first };
    const start = (await newlineBefore(handle, end)) + 1;
    return { first, last: await readAt(handle, start, end - start) };
  } finally {
    await handle.close();
  }
}

/** What a file's first and last complete lines say about it. */
function contentsOf(edges: Edges): Contents {
  let header: { type?: unknown; parent?: { session?: unknown } | null; spawn?: unknown } | null;
  try {
    header = JSON.parse(edges.first.toString("utf8"));
  } catch {
    return { kind: "opaque" };
  }
  if (header?.type !== "session_header") return { kind: "opaque" };
  // A spawned child's header names the session that started it, but its log does not continue that session's.
  const parent = header.spawn === undefined ? header.parent?.session : undefined;
  let lastAt: number | undefined;
  try {
    const at = Date.parse(String((JSON.parse(edges.last.toString("utf8")) as { timestamp?: unknown }).timestamp));
    lastAt = Number.isNaN(at) ? undefined : at;
  } catch {
    lastAt = undefined;
  }
  return { kind: "log", lastAt, continues: typeof parent === "string" ? parent : undefined };
}

interface SessionFile {
  /** The file id: the session id for a first file, a derived name for a revert's or a migration's. */
  readonly id: string;
  /** The live copy, when there is one. The store reads it first, so it decides what the file holds. */
  live?: string;
  /** The archived copy, when there is one. */
  archived?: string;
  /**
   * A live file with no complete line beside the archived copy. The store reads past it to the archive, a purge removes
   * it with the archive, and an archive leaves it alone.
   */
  stub?: string;
  readonly contents: Contents;
}

/** The file id that a store-written name holds, or `undefined` for a name the store would not write. */
function idOf(name: string, extension: string): string | undefined {
  const encoded = name.slice(0, -extension.length);
  try {
    const id = decodeURIComponent(encoded);
    return encodeName(id) === encoded ? id : undefined;
  } catch {
    return undefined;
  }
}

const listFolder = (folder: string): Promise<string[]> =>
  readdir(folder).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });

interface Scan {
  readonly files: Map<string, SessionFile>;
  /** Session id to the file its pointer names, or `undefined` for a pointer that can't be read. */
  readonly pointers: Map<string, string | undefined>;
  readonly skipped: string[];
  /** Whether a store-written file could not be read, so it might be any session's and continue any other. */
  opaque: boolean;
}

type Copy = Contents | "empty" | "gone";

const archives = new Map<string, { size: number; mtimeMs: number; ino: number; copy: Copy }>();

/** What an archived copy holds, unpacked once and then kept while the file keeps its size, time and inode. */
async function readArchivedCopy(path: string): Promise<Copy> {
  const info = await stat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info === undefined) return "gone";
  const cached = archives.get(path);
  if (cached?.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ino === info.ino) return cached.copy;
  let copy: Copy;
  try {
    const bytes = await readArchive(path);
    copy = bytes === undefined ? "gone" : contentsOrEmpty(edgesOf(bytes));
  } catch (error) {
    if (isHarnessError(error) && error.code === "session_corrupt") copy = { kind: "opaque" };
    else throw error;
  }
  archives.delete(path);
  if (copy !== "gone") archives.set(path, { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino, copy });
  const oldest = archives.keys().next().value;
  if (archives.size > MAX_CACHED_ARCHIVES && oldest !== undefined) archives.delete(oldest);
  return copy;
}

const contentsOrEmpty = (edges: Edges | undefined): Contents | "empty" =>
  edges === undefined ? "empty" : contentsOf(edges);

/** What a file's live or archived copy holds: its contents, `"empty"` with no complete line, or `"gone"` when it went. */
async function readCopy(path: string, archived: boolean): Promise<Copy> {
  if (archived) return readArchivedCopy(path);
  const edges = await liveEdges(path);
  return edges === "empty" || edges === "gone" ? edges : contentsOf(edges);
}

/**
 * Adds one copy of a file to the scan: a name the store would not write is skipped, and a gone file is left out. `stubs`
 * holds the live files with no complete line, by file id, so the archived copy read after them can take them along.
 */
async function addCopy(found: Scan, stubs: Map<string, string>, folder: string, name: string, archived: boolean) {
  const path = join(folder, name);
  const id = idOf(name, archived ? ARCHIVE_EXTENSION : LIVE_EXTENSION);
  if (id === undefined) {
    found.skipped.push(path);
    return;
  }
  const known = found.files.get(id);
  if (known !== undefined) {
    // The live copy, read first, decides what the file holds, but a purge removes both copies.
    known.archived = path;
    return;
  }
  const contents = await readCopy(path, archived);
  if (contents === "gone") return;
  if (contents === "empty") {
    // A file with no complete line holds nothing. A live one is kept in mind, as its archive, if any, is the file.
    if (!archived) stubs.set(id, path);
    return;
  }
  if (contents.kind === "opaque") {
    found.opaque = true;
    found.skipped.push(path);
  }
  const stub = archived ? stubs.get(id) : undefined;
  if (!archived) found.files.set(id, { id, live: path, contents });
  else
    found.files.set(id, stub === undefined ? { id, archived: path, contents } : { id, archived: path, stub, contents });
}

async function readPointer(path: string): Promise<{ file: string | undefined } | undefined> {
  const text = await readIfThere(path);
  if (text === undefined) return undefined;
  try {
    const file = (JSON.parse(text.toString("utf8")) as { file?: unknown }).file;
    return { file: typeof file === "string" ? file : undefined };
  } catch {
    return { file: undefined };
  }
}

/** Reads the user's live and archived files and pointers. A file that goes while the run reads it is left out. */
async function scan(userDir: string, archiveDir: string): Promise<Scan> {
  const found: Scan = { files: new Map(), pointers: new Map(), skipped: [], opaque: false };
  const names = await listFolder(userDir);
  const stubs = new Map<string, string>();
  for (const name of names.filter((entry) => entry.endsWith(LIVE_EXTENSION))) {
    await addCopy(found, stubs, userDir, name, false);
  }
  for (const name of (await listFolder(archiveDir)).filter((entry) => entry.endsWith(ARCHIVE_EXTENSION))) {
    await addCopy(found, stubs, archiveDir, name, true);
  }
  for (const name of names.filter((entry) => entry.endsWith(POINTER_EXTENSION))) {
    const id = idOf(name, POINTER_EXTENSION);
    const pointer = id === undefined ? undefined : await readPointer(join(userDir, name));
    if (id !== undefined && pointer !== undefined) found.pointers.set(id, pointer.file);
  }
  return found;
}

interface Session {
  readonly id: string;
  /** Its files in the order expiry handles them: each before any file it continues, the first file last. */
  readonly files: SessionFile[];
  readonly pointer: boolean;
  /** The newest last entry of its files, `-Infinity` with none, or `undefined` when a file or the pointer can't be read. */
  readonly lastAt: number | undefined;
}

const continuesOf = (file: SessionFile): string | undefined =>
  file.contents.kind === "log" ? file.contents.continues : undefined;

/**
 * Each pointer's chain: the derived file it names, then each derived file that one continues and that is still the
 * session's own, newest first. Past the purged copy of a first file, only the purge's copies above it are the
 * session's, so a purged fork never claims the file of the session it was forked from.
 */
function pointerChains(found: Scan, owner: Map<string, string>): Map<string, SessionFile[]> {
  const chains = new Map<string, SessionFile[]>();
  for (const [sessionId, target] of found.pointers) {
    const chain: SessionFile[] = [];
    for (let at = target; at !== undefined && isDerivedFile(at) && !owner.has(at); ) {
      const file = found.files.get(at);
      if (file === undefined) break;
      owner.set(at, sessionId);
      chain.push(file);
      const next = continuesOf(file);
      at = next !== undefined && ownsContinued(at, next) ? next : undefined;
    }
    chains.set(sessionId, chain);
  }
  return chains;
}

/** The session a derived file belongs to, found by walking up the files it continues, and the files on the way. */
function homeOf(file: SessionFile, found: Scan, owner: Map<string, string>) {
  const path: SessionFile[] = [file];
  for (let at = continuesOf(file); at !== undefined; ) {
    // A first file's id names its session even when the file itself is gone.
    if (!isDerivedFile(at) || owner.has(at)) return { home: owner.get(at) ?? at, path };
    const next = found.files.get(at);
    if (next === undefined || path.includes(next)) break;
    path.push(next);
    at = continuesOf(next);
  }
  return { home: undefined, path };
}

/** Orders a session's loose files so that each goes before every loose file it continues. */
function newestFirst(members: SessionFile[]): SessionFile[] {
  const byId = new Map(members.map((file) => [file.id, file]));
  const depth = (file: SessionFile): number => {
    let count = 0;
    for (let at = byId.get(continuesOf(file) ?? ""); at !== undefined && count < members.length; count += 1) {
      at = byId.get(continuesOf(at) ?? "");
    }
    return count;
  };
  return members
    .map((file) => ({ file, depth: depth(file) }))
    .sort((a, b) => b.depth - a.depth)
    .map(({ file }) => file);
}

/** The derived files no pointer reaches, by the session they continue. A file whose session can't be found is skipped. */
function looseFiles(found: Scan, owner: Map<string, string>): Map<string, SessionFile[]> {
  const loose = new Map<string, SessionFile[]>();
  for (const file of found.files.values()) {
    if (owner.has(file.id)) continue;
    const { home, path } = homeOf(file, found, owner);
    if (home === undefined) {
      // A file whose header can't be read is in `skipped` already, from the scan.
      const name = file.live ?? file.archived ?? file.id;
      if (!found.skipped.includes(name)) found.skipped.push(name);
      continue;
    }
    for (const member of path) owner.set(member.id, home);
    loose.set(home, [...(loose.get(home) ?? []), ...path]);
  }
  for (const [id, members] of loose) loose.set(id, newestFirst(members));
  return loose;
}

/** The newest last entry among the files, or `undefined` when one of them, or the pointer, can't be read. */
function lastAtOf(files: readonly SessionFile[], readablePointer: boolean): number | undefined {
  let lastAt: number | undefined = readablePointer ? Number.NEGATIVE_INFINITY : undefined;
  for (const file of files) {
    const at = file.contents.kind === "log" ? file.contents.lastAt : undefined;
    lastAt = lastAt === undefined || at === undefined ? undefined : Math.max(lastAt, at);
  }
  return lastAt;
}

/**
 * Groups the files into sessions. A session owns its first file, the derived files its pointer's chain reaches, and the
 * derived files that continue one of its files. Its files are ordered so that a file goes before the file it continues:
 * the loose files, newest first, then the chain from the file the pointer names, then the first file. A run that stops
 * part-way so never leaves a file whose parent it removed, and every remaining file still continues, through files that
 * remain, the first file, so the next run finds the session again.
 */
function sessionsOf(found: Scan): { sessions: Map<string, Session>; owner: Map<string, string> } {
  const owner = new Map<string, string>();
  const chains = pointerChains(found, owner);
  for (const file of found.files.values()) if (!isDerivedFile(file.id)) owner.set(file.id, file.id);
  const loose = looseFiles(found, owner);
  const sessions = new Map<string, Session>();
  for (const id of new Set([...owner.values(), ...found.pointers.keys()])) {
    const first = found.files.get(id);
    const files = [...(loose.get(id) ?? []), ...(chains.get(id) ?? []), ...(first ? [first] : [])];
    const pointer = found.pointers.has(id);
    const lastAt = lastAtOf(files, !pointer || found.pointers.get(id) !== undefined);
    sessions.set(id, { id, files, pointer, lastAt });
  }
  return { sessions, owner };
}

/** The sessions whose logs `session` continues: the owners of the files its own files name as parents. */
function parentsOf(session: Session, owner: Map<string, string>, sessions: Map<string, Session>): Session[] {
  const parents: Session[] = [];
  for (const file of session.files) {
    const above = continuesOf(file);
    const parent = above === undefined ? undefined : sessions.get(owner.get(above) ?? above);
    if (parent !== undefined && parent !== session && !parents.includes(parent)) parents.push(parent);
  }
  return parents;
}

/** Whether `action` has anything to do to the session: a purge removes any copy or pointer, an archive moves live files. */
const hasWork = (session: Session, action: Retention["action"]): boolean =>
  action === "purge"
    ? session.pointer || session.files.length > 0
    : session.files.some((file) => file.live !== undefined);

interface Run {
  readonly options: PruneOptions;
  readonly action: Retention["action"];
  readonly userDir: string;
  readonly archiveDir: string;
  /** Whether a store call on this file id is running in this process, which makes its session count as locked. */
  readonly busy: (fileId: string) => boolean;
  /** The sessions as the latest scan found them. */
  sessions: Map<string, Session>;
  owner: Map<string, string>;
  readonly result: PruneResult;
  /** The sessions the run means to expire, with the lock it holds for each until that session's own work ends. */
  readonly acting: Map<string, LockHandle | undefined>;
}

const keep = (run: Run, sessionId: string, reason: KeptReason, error?: unknown): void => {
  run.result.kept.push({ sessionId, reason });
  if (reason === "error") run.result.errors.push({ sessionId, error });
};

/** Gives up the lock of a session whose work is over, so its writer can open it before the run ends. */
async function release(run: Run, sessionId: string): Promise<void> {
  const handle = run.acting.get(sessionId);
  run.acting.delete(sessionId);
  await handle?.release().catch(() => undefined);
}

/** Whether a session is to be left alone, can't be judged, or is to be expired. */
function verdictOf(run: Run, session: Session, cutoff: number, opaque: boolean): "fresh" | "unreadable" | "expired" {
  if ((session.lastAt !== undefined && session.lastAt >= cutoff) || !hasWork(session, run.action)) return "fresh";
  return session.lastAt === undefined || (run.action === "purge" && opaque) ? "unreadable" : "expired";
}

const isBusy = (run: Run, session: Session): boolean =>
  run.busy(session.id) || session.files.some((file) => run.busy(file.id));

/** Picks the expired sessions to act on and takes each one's lock, keeping those it can't date, read or lock. */
async function choose(run: Run, cutoff: number, opaque: boolean): Promise<void> {
  for (const session of run.sessions.values()) {
    const verdict = verdictOf(run, session, cutoff, opaque);
    if (verdict !== "expired") {
      if (verdict === "unreadable") keep(run, session.id, "unreadable");
      continue;
    }
    if (isBusy(run, session)) {
      keep(run, session.id, "locked");
      continue;
    }
    try {
      const handle = await run.options.lock?.acquire({ userId: run.options.userId, sessionId: session.id });
      if (handle === "would_block") keep(run, session.id, "locked");
      else run.acting.set(session.id, handle);
    } catch (error) {
      keep(run, session.id, "error", error);
    }
  }
}

/**
 * Reads the folder again once the locks are taken, so a session written between the first read and its lock is judged
 * on what it holds now: one that is fresh or unreadable now is let go, and every later decision uses this read.
 */
async function recheck(run: Run, cutoff: number): Promise<void> {
  const found = await scan(run.userDir, run.archiveDir);
  ({ sessions: run.sessions, owner: run.owner } = sessionsOf(found));
  for (const path of found.skipped) if (!run.result.skipped.includes(path)) run.result.skipped.push(path);
  for (const id of [...run.acting.keys()]) {
    const session = run.sessions.get(id);
    const verdict = session === undefined ? "fresh" : verdictOf(run, session, cutoff, found.opaque);
    if (verdict === "expired") continue;
    if (verdict === "unreadable") keep(run, id, "unreadable");
    await release(run, id);
  }
}

/**
 * Expires the user's sessions: each one whose last entry is more than `retention.days` old is archived or purged, and
 * with no `retention` nothing happens. A session is a first file, the derived files that continue it and its pointer,
 * and its files count wherever they are, live or archived, so an archived session expires again under a purge.
 *
 * Before anything is removed, the run takes the lock of every session it means to expire, reads the folder again, and
 * decides from that second read which sessions survive: the fresh ones, the locked ones, and the ones it can't read or
 * date. A writer that appended between the first read and the lock is so judged on what it wrote. A purge then keeps
 * every expired session that a survivor continues, directly or through another kept session, and it keeps every
 * session when any file in the user's folder can't be read, because that file could continue any of them. A purge
 * removes a fork before the session it continues, and keeps that session when the fork's removal fails. Each lock is
 * given up as soon as its session is archived, purged or kept. Without `lock`, nothing stops a writer elsewhere from
 * appending to a session while the run moves it, so pass the lock that writers hold.
 *
 * Each archived file is written and read back before its original goes, and a file deleted while the run goes on is
 * not brought back. A session's files go one at a time, newest first, then its first file and then its pointer, so a
 * run that stops part-way leaves a session the next run still finds and finishes. A failure stops only its own session:
 * it is recorded in `errors` and the run goes on.
 */
export function pruneSessions(options: PruneOptions): Promise<PruneResult> {
  return expireSessions(options, () => false);
}

/**
 * `pruneSessions()` for the store, which passes `busy`: a session with a file that one of the store's own calls is
 * reading or writing is kept as `locked`, so a pass never moves a file under a call that is already past expiry.
 */
export async function expireSessions(options: PruneOptions, busy: (fileId: string) => boolean): Promise<PruneResult> {
  const result: PruneResult = {
    archived: [],
    purged: [],
    kept: [],
    skipped: [],
    errors: [],
    ...(options.marks === undefined ? {} : { purgedMarks: [], markedArchives: [] }),
  };
  const { retention } = options;
  if (retention === undefined) return result;
  checkRetention(retention);
  checkKey({ userId: options.userId, sessionId: "-" });
  const userDir = join(options.dir, encodeName(options.userId));
  const archiveDir = join(options.dir, ARCHIVE_DIR, encodeName(options.userId));
  const found = await scan(userDir, archiveDir);
  const { sessions, owner } = sessionsOf(found);
  result.skipped.push(...found.skipped);
  const action = retention.action;
  const run: Run = { options, action, userDir, archiveDir, busy, sessions, owner, result, acting: new Map() };
  const cutoff = (options.now?.() ?? new Date()).getTime() - retention.days * DAY_MS;
  try {
    await choose(run, cutoff, found.opaque);
    if (run.acting.size > 0) await recheck(run, cutoff);
    if (retention.action === "archive") {
      for (const id of [...run.acting.keys()]) {
        await attempt(run, id, () => archiveSession(run, id));
        await release(run, id);
      }
    } else {
      await purgeAll(run);
    }
  } finally {
    for (const id of [...run.acting.keys()]) await release(run, id);
  }
  return result;
}

/** Runs one session's expiry, and records a failure as that session's instead of ending the run. */
async function attempt(run: Run, sessionId: string, task: () => Promise<void>): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error) {
    keep(run, sessionId, "error", error);
    return false;
  }
}

/** Takes out of `pending` every session that a survivor continues, directly or through another kept session. */
function protect(run: Run, pending: Set<string>): void {
  const survivors = [...run.sessions.values()].filter((session) => !pending.has(session.id));
  for (let session = survivors.pop(); session !== undefined; session = survivors.pop()) {
    for (const parent of parentsOf(session, run.owner, run.sessions)) {
      if (!pending.delete(parent.id)) continue;
      keep(run, parent.id, "continued");
      survivors.push(parent);
    }
  }
}

/** For each pending session, the pending sessions that continue it. */
function childrenOf(run: Run, pending: Set<string>): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const id of pending) {
    for (const parent of parentsOf(run.sessions.get(id) as Session, run.owner, run.sessions)) {
      if (pending.has(parent.id)) children.set(parent.id, [...(children.get(parent.id) ?? []), id]);
    }
  }
  return children;
}

/**
 * Purges the chosen sessions, minus those a survivor continues, each fork before the session it continues. Every
 * decision is made before the first file goes, and each session's lock is given up as soon as its own fate is settled:
 * a parent's lock stays held until the parent itself is purged or kept, so no fork of it can start meanwhile.
 */
async function purgeAll(run: Run): Promise<void> {
  const pending = new Set(run.acting.keys());
  protect(run, pending);
  for (const id of [...run.acting.keys()]) if (!pending.has(id)) await release(run, id);
  const children = childrenOf(run, pending);
  const ended = new Map<string, boolean>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const id of pending) {
      const waiting = children.get(id) ?? [];
      if (!waiting.every((child) => ended.has(child))) continue;
      pending.delete(id);
      progress = true;
      // A fork that could not be removed still continues this session, so it stays.
      ended.set(id, await purgeUnlessContinued(run, id, waiting, ended));
    }
  }
  // What is left is a cycle of sessions that continue each other, which only a corrupt folder has.
  for (const id of pending) keep(run, id, "continued");
}

/** Purges one session once its forks have ended, unless one of them failed to go, and gives up its lock. */
async function purgeUnlessContinued(run: Run, id: string, forks: string[], ended: Map<string, boolean>) {
  let done = false;
  if (forks.some((fork) => ended.get(fork) === false)) keep(run, id, "continued");
  else done = await attempt(run, id, () => purgeSession(run, run.sessions.get(id) as Session));
  if (done) run.result.purged.push(id);
  await release(run, id);
  return done;
}

/** The entries of a log's bytes, line by line; a line that is not JSON, or has no newline yet, is left out. */
function entriesOfBytes(bytes: Uint8Array): SessionEntry[] {
  const lines = Buffer.from(bytes).toString("utf8").split("\n");
  lines.pop();
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as SessionEntry];
    } catch {
      return [];
    }
  });
}

/** The marks with an entry in the session's files, live or archived, read whole. Without marks, none. */
async function sessionMarks(run: Run, session: Session): Promise<PurgeMark[]> {
  const marks = run.options.marks;
  if (marks === undefined || marks.length === 0) return [];
  const found: PurgeMark[] = [];
  for (const file of session.files) {
    const bytes =
      (file.live === undefined ? undefined : await readIfThere(file.live)) ??
      (file.archived === undefined ? undefined : await readArchive(file.archived));
    if (bytes !== undefined) found.push(...marksIn(entriesOfBytes(bytes), marks));
  }
  return found;
}

/** Adds marks to a list once each. */
function addMarks(list: PurgeMark[] | undefined, marks: readonly PurgeMark[]): void {
  for (const mark of marks) {
    if (!list?.some((held) => held.callId === mark.callId && held.tool === mark.tool && held.runId === mark.runId))
      list?.push(mark);
  }
}

async function purgeSession(run: Run, session: Session): Promise<void> {
  // The marks are read before any file goes, and counted only once every file has gone.
  const marks = await sessionMarks(run, session);
  for (const file of session.files) {
    if (file.live !== undefined) await rm(file.live, { force: true });
    if (file.stub !== undefined) await removeStub(file.stub);
    if (file.archived !== undefined) await rm(file.archived, { force: true });
  }
  if (session.pointer) await rm(join(run.userDir, `${encodeName(session.id)}${POINTER_EXTENSION}`), { force: true });
  addMarks(run.result.purgedMarks, marks);
}

/** Removes a live file that held no complete line when the run read it, and keeps it if a line has landed since. */
async function removeStub(path: string): Promise<void> {
  const edges = await liveEdges(path);
  if (edges === "gone") return;
  if (edges !== "empty") {
    throw new HarnessError("session_conflict", `${path} was written during the run, so the session was kept`);
  }
  await rm(path, { force: true });
}

async function archiveSession(run: Run, sessionId: string): Promise<void> {
  let moved = false;
  const session = run.sessions.get(sessionId) as Session;
  const marked = (await sessionMarks(run, session)).length > 0;
  for (const file of session.files) {
    if (file.live === undefined) continue;
    if (await archiveFile(run.options.dir, run.options.userId, file.id, file.live)) moved = true;
  }
  if (moved) run.result.archived.push(sessionId);
  if (moved && marked) run.result.markedArchives?.push(sessionId);
}

/**
 * Archives one file and removes the original once the archive reads back to the same bytes. A file that is gone, or
 * that goes while its archive is written, is not archived, so a delete during the run never brings a session back.
 * Returns whether the file was archived.
 */
async function archiveFile(dir: string, userId: string, id: string, live: string): Promise<boolean> {
  const original = await readIfThere(live);
  if (original === undefined) return false;
  const target = archivePath(dir, userId, id);
  await writeAtomically(target, await gzip(original));
  if (!(await readArchive(target))?.equals(original)) {
    throw new HarnessError("session_corrupt", `${target} does not match ${live}, so the original was kept`);
  }
  // The archive is written before the original is read again, and a delete removes the original before its archive, so
  // in whichever order the two run, a deleted file leaves no archive behind.
  const again = await readIfThere(live);
  if (again === undefined || !again.equals(original)) {
    await rm(target, { force: true });
    if (again === undefined) return false;
    throw new HarnessError("session_corrupt", `${live} changed while it was archived, so the original was kept`);
  }
  await rm(live, { force: true });
  return true;
}
