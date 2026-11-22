/**
 * Retention for a `jsonlStore()` folder. Nothing is ever deleted unless the caller sets a retention period: an expired
 * session is then gzipped into `archive/`, where the store still lists and loads it, or deleted with its pointer. The
 * code only runs when a caller asks, either through `pruneSessions()` or once for each user when the store first
 * touches that user, and never on a timer.
 */
import type { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { HarnessError } from "../errors.js";
import type { SessionLock } from "./lock.js";
import { isDerivedFile } from "./session.js";
import { checkKey, encodeName } from "./store.js";

/** The folder under the store's folder that holds archived sessions, one folder per user. */
export const ARCHIVE_DIR = "archive";
/** The extension of an archived file: the session file's `.jsonl`, gzipped. */
export const ARCHIVE_EXTENSION = ".jsonl.gz";
const LIVE_EXTENSION = ".jsonl";
const POINTER_EXTENSION = ".pointer.json";
const DAY_MS = 86_400_000;

/** How long to keep a session after its last entry, and what to do with it then. */
export interface Retention {
  /** Days since the session's last entry. A positive number. */
  readonly days: number;
  /** `archive` gzips the session's files into `archive/`, where the store still reads them. `purge` deletes them. */
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
  /** The writer lock. A session whose lock is held is kept. */
  readonly lock?: SessionLock;
}

/** What `pruneSessions()` did, by session id. */
export interface PruneResult {
  readonly archived: string[];
  readonly purged: string[];
  /**
   * Expired sessions left alone, and why: a writer holds the lock, or a surviving session continues the log. A file
   * that isn't a readable session log is not a session here, so it is never touched and is not listed.
   */
  readonly kept: Array<{ readonly sessionId: string; readonly reason: "locked" | "continued" }>;
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
  try {
    return gunzipSync(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new HarnessError("session_corrupt", `${path} is not a readable archive`, { cause: error });
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

interface LiveFile {
  /** The file id: the session id for a first file, a derived name for a revert's or a migration's. */
  readonly id: string;
  readonly path: string;
  readonly lastAt: number;
  /** The file this one continues, when it continues one and was not spawned. */
  readonly continues: string | undefined;
}

async function describeFile(userDir: string, name: string): Promise<LiveFile | undefined> {
  const path = join(userDir, name);
  try {
    const lines = (await readFile(path, "utf8")).split("\n");
    // A last line without a newline was never acknowledged, so it doesn't count.
    lines.pop();
    const header = JSON.parse(lines[0] ?? "") as { type?: string; parent?: { session?: unknown }; spawn?: unknown };
    const last = JSON.parse(lines.at(-1) ?? "") as { timestamp?: unknown };
    const lastAt = Date.parse(String(last.timestamp));
    if (header.type !== "session_header" || Number.isNaN(lastAt)) return undefined;
    const parent = header.spawn === undefined ? header.parent?.session : undefined;
    return {
      id: decodeURIComponent(name.slice(0, -LIVE_EXTENSION.length)),
      path,
      lastAt,
      continues: typeof parent === "string" ? parent : undefined,
    };
  } catch {
    return undefined;
  }
}

interface Session {
  readonly id: string;
  /** Its files: the first file and the derived files that continue it, newest last. */
  readonly files: LiveFile[];
  readonly lastAt: number;
}

/** A session's files: the file its pointer names, then the derived files that file continues, then the session's own first file. */
function sessionsOf(files: Map<string, LiveFile>, pointers: Map<string, string>): Session[] {
  const sessions: Session[] = [];
  for (const file of files.values()) {
    if (isDerivedFile(file.id)) continue;
    const chain: LiveFile[] = [file];
    for (let at = files.get(pointers.get(file.id) ?? file.id); at !== undefined && !chain.includes(at); ) {
      chain.push(at);
      at = at.continues !== undefined && isDerivedFile(at.continues) ? files.get(at.continues) : undefined;
    }
    sessions.push({ id: file.id, files: chain, lastAt: Math.max(...chain.map((member) => member.lastAt)) });
  }
  return sessions;
}

/**
 * Expires the user's sessions: each one whose last entry is more than `retention.days` old is archived or purged, and
 * with no `retention` nothing happens. A session is a first file, the derived files that continue it and its pointer.
 * A purge keeps an expired session that a surviving session continues (a fork's parent), so no log is left without its
 * ancestors. An archive keeps the pointer, because the store reads the archive where the file was. Each file is written
 * and checked before its original goes, so a crash leaves a file in one place or both, and the next run finishes the job.
 */
export async function pruneSessions(options: PruneOptions): Promise<PruneResult> {
  const result: PruneResult = { archived: [], purged: [], kept: [] };
  const { retention } = options;
  if (retention === undefined) return result;
  checkRetention(retention);
  checkKey({ userId: options.userId, sessionId: "-" });
  const userDir = join(options.dir, encodeName(options.userId));
  const names = await readdir(userDir).catch(() => [] as string[]);
  const files = new Map<string, LiveFile>();
  for (const name of names.filter((entry) => entry.endsWith(LIVE_EXTENSION))) {
    const file = await describeFile(userDir, name);
    if (file !== undefined) files.set(file.id, file);
  }
  const pointers = new Map<string, string>();
  for (const name of names.filter((entry) => entry.endsWith(POINTER_EXTENSION))) {
    try {
      const pointer = JSON.parse(await readFile(join(userDir, name), "utf8")) as { file?: unknown };
      if (typeof pointer.file === "string") {
        pointers.set(decodeURIComponent(name.slice(0, -POINTER_EXTENSION.length)), pointer.file);
      }
    } catch {
      /* a bad pointer leaves its session at its first file, and its session is then kept by the checks below */
    }
  }
  const cutoff = (options.now?.() ?? new Date()).getTime() - retention.days * DAY_MS;
  const sessions = sessionsOf(files, pointers);
  const expired = new Set(sessions.filter((session) => session.lastAt < cutoff).map((session) => session.id));
  if (retention.action === "purge") protectContinued(sessions, expired, result);
  for (const session of sessions.filter((entry) => expired.has(entry.id))) {
    await expire(options, userDir, session, retention.action, result);
  }
  return result;
}

/** The sessions that `session` continues: the owners of the files its own files name as parents. */
function continuedBy(session: Session, owner: Map<string, Session>): Session[] {
  const parents: Session[] = [];
  for (const file of session.files) {
    const parent = file.continues === undefined ? undefined : owner.get(file.continues);
    if (parent !== undefined && parent !== session) parents.push(parent);
  }
  return parents;
}

/** Takes out of `expired` every session that a surviving one continues, directly or through another kept session. */
function protectContinued(sessions: Session[], expired: Set<string>, result: PruneResult): void {
  const owner = new Map<string, Session>();
  for (const session of sessions) for (const file of session.files) owner.set(file.id, session);
  const pending = sessions.filter((session) => !expired.has(session.id));
  for (let session = pending.pop(); session !== undefined; session = pending.pop()) {
    for (const parent of continuedBy(session, owner)) {
      if (!expired.delete(parent.id)) continue;
      result.kept.push({ sessionId: parent.id, reason: "continued" });
      pending.push(parent);
    }
  }
}

async function expire(
  options: PruneOptions,
  userDir: string,
  session: Session,
  action: Retention["action"],
  result: PruneResult,
): Promise<void> {
  const key = { userId: options.userId, sessionId: session.id };
  const handle = options.lock === undefined ? undefined : await options.lock.acquire(key);
  if (handle === "would_block") {
    result.kept.push({ sessionId: session.id, reason: "locked" });
    return;
  }
  try {
    for (const file of session.files) {
      if (action === "archive") await archiveFile(options.dir, options.userId, file);
      else await rm(file.path, { force: true });
    }
    if (action === "purge") await rm(join(userDir, `${encodeName(session.id)}${POINTER_EXTENSION}`), { force: true });
    (action === "archive" ? result.archived : result.purged).push(session.id);
  } finally {
    await handle?.release();
  }
}

async function archiveFile(dir: string, userId: string, file: LiveFile): Promise<void> {
  const original = await readFile(file.path);
  const target = archivePath(dir, userId, file.id);
  await writeAtomically(target, gzipSync(original));
  // The original goes only once its archive reads back to the same bytes.
  if (!(await readArchive(target))?.equals(original)) {
    throw new HarnessError("session_corrupt", `${target} does not match ${file.path}, so the original was kept`);
  }
  await rm(file.path);
}
