/**
 * `Session`: one session's log with its HEAD, and the operations that branch it. The log is an append-only tree of
 * entries. HEAD is the entry the next append follows. A checkout, a fork and a revert write new entries or new files and
 * never rewrite one, so the only mutable state is the pointer to the session's current file (`SessionIndex`).
 */
import type { SessionEntry, SessionHeaderEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "./lock.js";
import type { SessionIndex } from "./pointer.js";
import type { EntryInput, SessionKey, SessionStore } from "./store.js";

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
  readonly #ancestors = new Map<string, SessionEntry[]>();
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
    for (const entry of stored) this.#byId.set(entry.id, entry);
    this.#entries = [
      ...this.#entries,
      ...stored.filter((entry) => !this.#entries.some((have) => have.id === entry.id)),
    ];
    this.#head = headOf(this.#entries);
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

  async #entriesOfFile(file: string): Promise<SessionEntry[]> {
    if (file === this.#file) return this.#entries;
    const cached = this.#ancestors.get(file);
    if (cached !== undefined) return cached;
    const loaded = await entriesOf(this.#options.store, this.#physical(file));
    this.#ancestors.set(file, loaded);
    return loaded;
  }

  /** Finds an entry in this file, or in the files above it, which a fork's header names. */
  async #find(id: string): Promise<SessionEntry | undefined> {
    let file = this.#file;
    for (let hops = 0; hops < 10_000; hops += 1) {
      const entries = await this.#entriesOfFile(file);
      const found = entries.find((entry) => entry.id === id);
      if (found !== undefined) return found;
      const header = entries[0];
      if (header?.type !== "session_header" || header.parent === undefined) return undefined;
      file = header.parent.session;
    }
    return undefined;
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

  /** Writes a new file that holds a header and, for a branch, a `checkout` of the entry it starts from. */
  async #writeFile(file: string, parent: { session: string; entryId: string } | undefined): Promise<void> {
    const header = this.#header();
    const headerId = this.#newId();
    const entries: EntryInput[] = [
      {
        ...this.#base(),
        id: headerId,
        parentId: null,
        ...inheritedFrom(header),
        ...(parent === undefined ? {} : { parent }),
      },
    ];
    if (parent !== undefined) {
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
    await this.#mustHave(entryId);
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
    await this.#mustHave(entryId);
    const file = `r${this.#newId()}`;
    await this.#writeFile(file, { session: this.#file, entryId });
    await this.#options.index.set(this.key, file);
    this.#ancestors.set(this.#file, this.#entries);
    this.#file = file;
    this.#entries = await entriesOf(this.#options.store, this.#physical(file));
    this.#byId = new Map(this.#entries.map((entry) => [entry.id, entry]));
    this.#head = headOf(this.#entries);
    return this;
  }

  /**
   * Starts the log of a subagent or a workflow step, and records the link in this session with a `subagent_link` entry
   * that carries `spawningCallId` or `stepId`, whichever was given, and never both.
   */
  async child(link: ChildLink): Promise<Session> {
    this.#requireWriter();
    const { spawningCallId, stepId } = link as { spawningCallId?: string; stepId?: string };
    if ((spawningCallId === undefined) === (stepId === undefined)) {
      throw new HarnessError("invalid_session_entry", "a child link needs exactly one of spawningCallId and stepId");
    }
    const sessionId = this.#newId();
    await this.#writeFile(sessionId, undefined);
    await this.append([
      {
        ...this.#base(),
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
