/**
 * `Session`: one session's log with its HEAD, and the operations that branch it. The log is an append-only tree of
 * entries. HEAD is the entry the next append follows. A checkout, a fork and a revert write new entries or new files and
 * never rewrite one, so the only mutable state is the pointer to the session's current file (`SessionIndex`).
 */
import type { SessionEntry, SessionHeaderEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "./lock.js";
import type { SessionIndex } from "./pointer.js";
import type { EntryInput, SessionKey, SessionStore, SessionSummary } from "./store.js";

/** The options of `openSession()`. */
export interface OpenSessionOptions {
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly key: SessionKey;
  /** With a lock, the session takes it and may write. Without one, the session is read-only: readers never lock. */
  readonly lock?: SessionLock;
  /** The clock for the entries a session writes itself. Default `new Date()`. */
  readonly now?: () => Date;
  /** Makes the ids of the entries and files a session writes itself. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/** What links a child session to the session that started it: a tool call, or a workflow step. Give exactly one. */
export type ChildLink = { readonly spawningCallId: string } | { readonly stepId: string };

// A walk up the parents that goes on this long is a cycle in a corrupt log.
const MAX_PATH_ENTRIES = 1_000_000;

/**
 * The prefix of the name of a file that holds part of a session, such as a revert's or a migration's file. A listing
 * leaves such files out, because a person knows a session by its key.
 */
export const DERIVED = "~";

/** Whether a file id names a derived file. */
export const isDerivedFile = (file: string): boolean => file.startsWith(DERIVED);

/** The HEAD a log leaves: each entry moves it to itself, and a `checkout` moves it to the entry it names. */
function headOf(entries: readonly SessionEntry[]): string | null {
  let head: string | null = null;
  for (const entry of entries) head = entry.type === "checkout" ? entry.headId : entry.id;
  return head;
}

const entriesOf = async (store: SessionStore, key: SessionKey): Promise<SessionEntry[]> => {
  const found: SessionEntry[] = [];
  for await (const entry of store.load(key)) found.push(entry);
  return found;
};

/** The fields a new file copies from a session's header, so every file of a session says what ran it. */
function inheritedFrom(
  header: SessionHeaderEntry,
): Omit<SessionHeaderEntry, "type" | "parent"> & { type: "session_header" } {
  return {
    type: "session_header",
    formatVersion: header.formatVersion,
    harnessVersion: header.harnessVersion,
    sdkVersion: header.sdkVersion,
    defaultsHash: header.defaultsHash,
    capabilities: [...header.capabilities],
    ablationHash: header.ablationHash,
    ...(header.product === undefined ? {} : { product: { ...header.product } }),
  };
}

/** One session. Open it with `openSession()`. */
export class Session {
  readonly key: SessionKey;
  readonly #options: OpenSessionOptions;
  readonly #handle: LockHandle | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #prefixes = new Map<string, readonly SessionEntry[]>();
  #prefix: Map<string, SessionEntry> | undefined;
  #file: string;
  #entries: SessionEntry[];
  #byId: Map<string, SessionEntry>;
  #head: string | null;

  private constructor(
    options: OpenSessionOptions,
    file: string,
    entries: SessionEntry[],
    handle: LockHandle | undefined,
  ) {
    this.key = options.key;
    this.#options = options;
    this.#file = file;
    this.#handle = handle;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.#entries = entries;
    this.#byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.#head = headOf(entries);
  }

  /** Reads the session's current file, and takes the writer lock when the options have a lock. */
  static async open(options: OpenSessionOptions): Promise<Session> {
    const handle = options.lock === undefined ? undefined : await options.lock.acquire(options.key);
    if (handle === "would_block") {
      throw new HarnessError(
        "session_locked",
        `another writer holds the session ${JSON.stringify(options.key.sessionId)}`,
      );
    }
    try {
      const file = (await options.index.get(options.key)) ?? options.key.sessionId;
      const entries = await entriesOf(options.store, { userId: options.key.userId, sessionId: file });
      return new Session(options, file, entries, handle);
    } catch (error) {
      await handle?.release();
      throw error;
    }
  }

  /** The id of the entry the next append follows, or `null` for a session with no entries yet. */
  head(): string | null {
    return this.#head;
  }

  /** The id of the file the session's log is in now. A revert or a migration changes it. */
  file(): string {
    return this.#file;
  }

  /** Whether this session may write: it was opened with a lock, and still holds it. */
  writable(): boolean {
    return this.#handle?.held() === true;
  }

  #physical(file: string): SessionKey {
    return { userId: this.key.userId, sessionId: file };
  }

  #requireWriter(): void {
    if (this.#handle === undefined)
      throw new HarnessError("session_read_only", "this session was opened without a lock");
    if (!this.#handle.held())
      throw new HarnessError("session_locked", "this session lost its writer lock, so it must stop writing");
  }

  #remember(stored: readonly SessionEntry[]): void {
    const fresh = stored.filter((entry) => !this.#byId.has(entry.id));
    for (const entry of fresh) {
      this.#byId.set(entry.id, entry);
      this.#head = entry.type === "checkout" ? entry.headId : entry.id;
    }
    this.#entries = [...this.#entries, ...fresh];
  }

  /**
   * Appends entries to the session's current file and moves HEAD. The caller sets each entry's `parentId`, normally
   * `head()` for the first and the entry before it for the rest. The append is guarded by the end of the log this session
   * has seen, so a writer that lost the lock can't extend it.
   */
  async append(entries: readonly EntryInput[]): Promise<SessionEntry[]> {
    this.#requireWriter();
    const expectedLastId = this.#entries.at(-1)?.id ?? null;
    const stored = await this.#options.store.append(this.#physical(this.#file), entries, { expectedLastId });
    this.#remember(stored);
    return stored;
  }

  /**
   * The entries a file's session was made from: the path to the entry its header names in its parent file, and so on up
   * through that file's own parent. An entry the parent wrote after the fork point is not in it. The path to a fork point
   * never changes, because a log is append-only, so the result is kept.
   */
  async #ancestry(file: string, entryId: string): Promise<readonly SessionEntry[]> {
    const cacheKey = JSON.stringify([file, entryId]);
    const cached = this.#prefixes.get(cacheKey);
    if (cached !== undefined) return cached;
    const entries = await entriesOf(this.#options.store, this.#physical(file));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const header = entries[0];
    const above = header?.type === "session_header" && header.spawn === undefined ? header.parent : undefined;
    const path: SessionEntry[] = [];
    const seen = new Set<string>();
    let at: string | null = entryId;
    while (at !== null) {
      if (seen.has(at))
        throw new HarnessError("session_corrupt", `the entries of the file ${file} have a cycle at ${at}`);
      seen.add(at);
      const entry = byId.get(at);
      if (entry === undefined) {
        if (above === undefined) throw new HarnessError("entry_not_found", `no entry ${at} in the file ${file}`);
        // A loop and not a spread, because a long prefix would be too many arguments for a call.
        // An entry missing from this file is in an ancestor file. The walk continues there from `at`, which is the entry this
        // file's header names when the missing entry is the fork point.
        const prefix = await this.#ancestry(above.session, at);
        for (let i = prefix.length - 1; i >= 0; i -= 1) path.push(prefix[i] as SessionEntry);
        break;
      }
      path.push(entry);
      at = entry.parentId;
    }
    const result = path.reverse();
    this.#prefixes.set(cacheKey, result);
    return result;
  }

  /** The entries of the parent files that this session's current file continues, by id. Empty for a first file. */
  async #inherited(): Promise<Map<string, SessionEntry>> {
    if (this.#prefix !== undefined) return this.#prefix;
    const header = this.#entries[0];
    const above = header?.type === "session_header" && header.spawn === undefined ? header.parent : undefined;
    const prefix = new Map<string, SessionEntry>();
    if (above !== undefined) {
      for (const entry of await this.#ancestry(above.session, above.entryId)) prefix.set(entry.id, entry);
    }
    this.#prefix = prefix;
    return prefix;
  }

  /** An entry of this session: one in its current file, or one in the prefix the file continues. */
  async #find(id: string): Promise<SessionEntry | undefined> {
    return this.#byId.get(id) ?? (await this.#inherited()).get(id);
  }

  /**
   * The entries from the root to `headId` (default HEAD), following `parentId` and crossing into a parent file when a
   * fork's entry follows one in it. A fork's own header is left out, and so are the `checkout` entries, which move HEAD
   * and are not part of the conversation.
   */
  async path(headId: string | null = this.#head): Promise<SessionEntry[]> {
    const path: SessionEntry[] = [];
    const seen = new Set<string>();
    let at = headId;
    while (at !== null) {
      if (seen.has(at) || path.length > MAX_PATH_ENTRIES) {
        throw new HarnessError("session_corrupt", `the entries of ${this.key.sessionId} have a cycle at ${at}`);
      }
      seen.add(at);
      const entry = await this.#find(at);
      if (entry === undefined)
        throw new HarnessError("entry_not_found", `no entry ${at} in the session ${this.key.sessionId}`);
      path.push(entry);
      at = entry.parentId;
    }
    return path.reverse();
  }

  #base(): { id: string; timestamp: string; origin: "harness" } {
    return { id: this.#newId(), timestamp: this.#now().toISOString(), origin: "harness" };
  }

  async #mustHave(entryId: string): Promise<void> {
    if ((await this.#find(entryId)) === undefined) {
      throw new HarnessError("entry_not_found", `no entry ${entryId} in the session ${this.key.sessionId}`);
    }
  }

  /** A fork or a revert needs a header to copy and an entry of this session to start from. */
  async #canBranchFrom(entryId: string): Promise<void> {
    this.#header();
    await this.#mustHave(entryId);
  }

  /** Moves HEAD to `entryId` by appending a `checkout` entry, so a reload finds HEAD where it was left. */
  async checkout(entryId: string): Promise<void> {
    this.#requireWriter();
    await this.#mustHave(entryId);
    await this.append([{ ...this.#base(), parentId: this.#head, type: "checkout", headId: entryId }]);
  }

  #header(): SessionHeaderEntry {
    const header = this.#entries[0];
    if (header?.type !== "session_header") {
      throw new HarnessError("entry_not_found", `the session ${this.key.sessionId} has no entries to branch from yet`);
    }
    return header;
  }

  /**
   * Writes a new file that holds a header and, for a branch, a `checkout` of the entry it starts from. A child's header
   * names the session and link entry that started it, and `spawn`, and has no `checkout`, because a child is its own
   * log and not a continuation.
   */
  async #writeFile(
    file: string,
    parent: { session: string; entryId: string } | undefined,
    spawn?: { spawningCallId?: string; stepId?: string },
  ): Promise<void> {
    const header = this.#header();
    const headerId = this.#newId();
    const entries: EntryInput[] = [
      {
        ...this.#base(),
        id: headerId,
        parentId: null,
        ...inheritedFrom(header),
        ...(parent === undefined ? {} : { parent }),
        ...(spawn === undefined ? {} : { spawn }),
      },
    ];
    if (parent !== undefined && spawn === undefined) {
      entries.push({ ...this.#base(), parentId: headerId, type: "checkout", headId: parent.entryId });
    }
    await this.#options.store.append(this.#physical(file), entries, { expectedLastId: null });
  }

  /**
   * Starts a new session from `entryId`: a new file whose header names this session's file and that entry as its parent,
   * so the fork's `path()` includes everything up to the entry without copying it. This session is unchanged. The
   * returned session is opened with the same options under a new id.
   */
  async fork(entryId: string): Promise<Session> {
    this.#requireWriter();
    await this.#canBranchFrom(entryId);
    const sessionId = this.#newId();
    await this.#writeFile(sessionId, { session: this.#file, entryId });
    return Session.open({ ...this.#options, key: { userId: this.key.userId, sessionId } });
  }

  /**
   * Goes back to `entryId` in a new file and points the session at it. The new file's header names the old file as its
   * parent, so nothing before the entry is lost, and the old file is not touched. A crash before the pointer moves
   * leaves the old file in use. Returns this session, now on the new file.
   */
  async revert(entryId: string): Promise<Session> {
    this.#requireWriter();
    await this.#canBranchFrom(entryId);
    const file = `${DERIVED}r${this.#newId()}`;
    await this.#writeFile(file, { session: this.#file, entryId });
    // The new file is read before anything changes, so a failure here leaves the session on the file it was on.
    const entries = await entriesOf(this.#options.store, this.#physical(file));
    await this.#options.index.set(this.key, file);
    this.#file = file;
    this.#entries = entries;
    this.#byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.#head = headOf(entries);
    this.#prefix = undefined;
    return this;
  }

  /**
   * Starts the log of a subagent or a workflow step, and records the link in this session with a `subagent_link` entry
   * that carries `spawningCallId` or `stepId`, whichever was given, and never both. If the link can't be written, for
   * example because the lock was lost, the child's file stays in the store as a session no one links to, which retention
   * removes; the same holds for a fork that can't be opened.
   */
  async child(link: ChildLink): Promise<Session> {
    this.#requireWriter();
    const { spawningCallId, stepId } = link as { spawningCallId?: string; stepId?: string };
    if ((spawningCallId === undefined) === (stepId === undefined)) {
      throw new HarnessError("invalid_session_entry", "a child link needs exactly one of spawningCallId and stepId");
    }
    const sessionId = this.#newId();
    const linkId = this.#newId();
    const spawn = spawningCallId === undefined ? { stepId: stepId as string } : { spawningCallId };
    await this.#writeFile(sessionId, { session: this.#file, entryId: linkId }, spawn);
    await this.append([
      {
        ...this.#base(),
        id: linkId,
        parentId: this.#head,
        type: "subagent_link",
        childSession: sessionId,
        ...(spawningCallId === undefined ? {} : { spawningCallId }),
        ...(stepId === undefined ? {} : { stepId }),
      },
    ]);
    return Session.open({ ...this.#options, key: { userId: this.key.userId, sessionId } });
  }

  /** Gives up the writer lock, if the session holds one. */
  async close(): Promise<void> {
    await this.#handle?.release();
  }
}

/** Opens a session. With a `lock` it is the session's one writer, and without one it can only read. */
export function openSession(options: OpenSessionOptions): Promise<Session> {
  return Session.open(options);
}

/** The user's sessions, oldest first, without the files that only hold part of a session (a revert's or a migration's). */
export async function* listSessions(store: SessionStore, userId: string): AsyncGenerator<SessionSummary> {
  for await (const summary of store.list(userId)) {
    if (!isDerivedFile(summary.sessionId)) yield summary;
  }
}
