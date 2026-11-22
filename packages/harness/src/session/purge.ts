/**
 * Purge marks and the targeted purge. A mark names one tool call whose entries hold text that must leave the log, such
 * as a memory record that was deleted. The targeted purge rewrites a session into new files with the content of every
 * marked entry replaced and each entry's base fields kept, so the tree still resolves; the retention purge reads the
 * same marks. The old files are deleted only after the new ones read back, and the pointer moves between the two, so
 * a crash leaves the session readable from the old files or the new.
 */
import type { SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { SessionLock } from "./lock.js";
import type { SessionIndex } from "./pointer.js";
import { DERIVED, isDerivedFile } from "./session.js";
import type { EntryInput, SessionKey, SessionStore } from "./store.js";

/**
 * One tool call whose entries must leave the log: the `message_block` that holds the call, its `tool_result`, and, for
 * a call the host's code made, its `code_call` and `approval_requested` entries. An entry matches by its call id and
 * tool name, and by `runId` where the log shows which run wrote the call: the run whose `turn_start` came before the
 * call's entries with no `turn_end` between, or the call id of a host code call. A call whose entries no open run
 * covers matches by its call id and tool alone, so where the log can't name the run a purge removes more, never less.
 */
export interface PurgeMark {
  readonly runId: string;
  readonly callId: string;
  readonly tool: string;
  /**
   * When the mark joined the memory extension's purge list, as an ISO 8601 string. `clearPurgeMarks()` reads it to drop
   * a mark that no session held for 30 days. Matching ignores it.
   */
  readonly at?: string;
}

/** The text that replaces the content of a purged entry. A replay of a purged session reads it where the content was. */
export const PURGED_TEXT = "[purged: this entry held a deleted memory record]";

/** The prefix of a file the targeted purge writes below a session's first file: a revert's or a migration's copy. */
const PURGE_FILE = `${DERIVED}p`;
/**
 * The prefix of the purged copy of a session's first file. A session's own files end at its first file, so a chain that
 * reaches this copy has reached the session's first file, and the files above it belong to the session it was forked
 * from, unless they are the session's own copies of them.
 */
export const PURGE_ROOT_FILE = `${DERIVED}o`;
/** The prefix of a session's purged copy of a file above its first file, which it continues from another session. */
export const PURGE_ABOVE_FILE = `${DERIVED}q`;

/**
 * Whether the session that owns `file` also owns `next`, the file that `file` continues, by their names alone. A first
 * file, or its purged copy, ends the session's own files except for the copies a purge made above it; a revert's,
 * migration's or purge's file continues files of its own session, which are derived or its first file.
 */
export function ownsContinued(file: string, next: string): boolean {
  if (!isDerivedFile(file) || file.startsWith(PURGE_ROOT_FILE) || file.startsWith(PURGE_ABOVE_FILE)) {
    return next.startsWith(PURGE_ABOVE_FILE);
  }
  return !next.startsWith(PURGE_ABOVE_FILE);
}

// A chain of parent files longer than this is a cycle in a corrupt log.
const MAX_FILES = 10_000;

const keyOf = (callId: string, tool: string): string => JSON.stringify([callId, tool]);

/** The call an entry belongs to, as its key, and whether the entry starts the call, or `undefined`. */
function callOf(entry: SessionEntry): { readonly key: string; readonly starts: boolean } | undefined {
  switch (entry.type) {
    case "message_block":
      return entry.block.type === "tool_call"
        ? { key: keyOf(entry.block.callId, entry.block.name), starts: true }
        : undefined;
    case "code_call":
      return { key: keyOf(entry.callId, entry.tool), starts: true };
    case "tool_result":
      return { key: keyOf(entry.callId, entry.tool), starts: false };
    case "approval_requested":
      return { key: keyOf(entry.request.callId, entry.request.tool), starts: false };
    default:
      return undefined;
  }
}

/** One call in the log: the runs its entries were written in, and where its entries are. */
interface CallSeen {
  readonly key: string;
  readonly runs: Set<string>;
  /** Whether an entry of the call was written where no open run covers it, so its run is not known. */
  unknownRun: boolean;
  readonly at: Array<readonly [file: number, position: number]>;
}

/** Which entries of `files`, read oldest first, match a mark: by position in each file, and the marks found in each. */
interface Matched {
  readonly positions: readonly Set<number>[];
  readonly found: readonly PurgeMark[][];
}

/** Records one more entry of `call`, written in the run `open` or in none. */
function seen(call: CallSeen, own: string | undefined, open: string | undefined, at: readonly [number, number]) {
  if (own !== undefined) call.runs.add(own);
  if (open === undefined) call.unknownRun = true;
  else call.runs.add(open);
  call.at.push(at);
}

/** The calls of `files`, read oldest first, whose key is in `wanted`, in the order they started. */
function callsIn(files: readonly (readonly SessionEntry[])[], wanted: ReadonlySet<string>): CallSeen[] {
  const calls: CallSeen[] = [];
  const latest = new Map<string, CallSeen>();
  const seenFor = (key: string, starts: boolean): CallSeen => {
    const held = starts ? undefined : latest.get(key);
    if (held !== undefined) return held;
    const started: CallSeen = { key, runs: new Set(), unknownRun: false, at: [] };
    calls.push(started);
    latest.set(key, started);
    return started;
  };
  files.forEach((entries, file) => {
    let open: string | undefined;
    entries.forEach((entry, position) => {
      if (entry.type === "turn_start") open = entry.runId;
      else if (entry.type === "turn_end") open = undefined;
      const call = callOf(entry);
      if (call === undefined || !wanted.has(call.key)) return;
      // A code call runs under its own call id, whatever turn its entries sit in.
      seen(seenFor(call.key, call.starts), entry.type === "code_call" ? entry.callId : undefined, open, [
        file,
        position,
      ]);
    });
  });
  return calls;
}

/**
 * Matches `marks` against `files`, the oldest file first. A tool call starts a new call even when a provider reuses its
 * id, and a result or an approval joins the latest call with its id and tool. The open run is reset at each file's
 * start, so a file that continues another mid-run matches its calls by id and tool alone.
 */
function matchMarks(files: readonly (readonly SessionEntry[])[], marks: readonly PurgeMark[]): Matched {
  const positions = files.map(() => new Set<number>());
  const found = files.map(() => new Set<PurgeMark>());
  const wanted = new Map<string, PurgeMark[]>();
  for (const mark of marks) {
    const key = keyOf(mark.callId, mark.tool);
    wanted.set(key, [...(wanted.get(key) ?? []), mark]);
  }
  for (const call of callsIn(files, new Set(wanted.keys()))) {
    const hits = (wanted.get(call.key) ?? []).filter((mark) => call.unknownRun || call.runs.has(mark.runId));
    for (const [file, position] of hits.length === 0 ? [] : call.at) {
      positions[file]?.add(position);
      for (const mark of hits) found[file]?.add(mark);
    }
  }
  return { positions, found: found.map((held) => [...held]) };
}

/** The marks whose call has an entry among `entries`, one file read whole. */
export function marksIn(entries: readonly SessionEntry[], marks: readonly PurgeMark[]): PurgeMark[] {
  const held = new Set(matchMarks([entries], marks).found[0]);
  return marks.filter((mark) => held.has(mark));
}

/**
 * The entry with its content replaced: a call's input becomes `{}`, a result's content becomes `PURGED_TEXT` and
 * loses its `details` and `spill`. The base fields, the call id and the tool name stay, so the rebuilt context still
 * pairs each call with its result. The spilled copy of a result is the spill store's file, which the purge can't reach,
 * so `purgeSession()` returns its path for the caller to delete.
 */
function purgedEntry(entry: SessionEntry): SessionEntry {
  switch (entry.type) {
    case "message_block":
      return entry.block.type === "tool_call" ? { ...entry, block: { ...entry.block, input: {} } } : entry;
    case "tool_result": {
      const { details: _details, spill: _spill, ...rest } = entry;
      return { ...rest, content: [{ type: "text", text: PURGED_TEXT }] };
    }
    case "code_call":
    case "approval_requested":
      return { ...entry, input: {} };
    default:
      return entry;
  }
}

/** Whether a marked entry, as read back, still holds content that `purgedEntry()` would remove. */
function keepsContent(entry: SessionEntry): boolean {
  const empty = (value: unknown) => JSON.stringify(value) === "{}";
  switch (entry.type) {
    case "message_block":
      return entry.block.type === "tool_call" && !empty(entry.block.input);
    case "tool_result":
      return (
        entry.details !== undefined ||
        entry.spill !== undefined ||
        JSON.stringify(entry.content) !== JSON.stringify([{ type: "text", text: PURGED_TEXT }])
      );
    case "code_call":
    case "approval_requested":
      return !empty(entry.input);
    default:
      return false;
  }
}

/** The options of `purgeSession()`. */
export interface PurgeSessionOptions {
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly key: SessionKey;
  /** The session's writer lock, held for the whole purge so no writer appends to a file while it is rewritten. */
  readonly lock: SessionLock;
  /** The marks to apply. An entry of the session that matches one loses its content. */
  readonly marks: readonly PurgeMark[];
  /** Makes the id in each new file's name. Defaults to a random UUID; a test passes a fixed one. */
  readonly newId?: () => string;
}

/** What `purgeSession()` did. */
export type PurgeSessionResult =
  | { readonly purged: false }
  | {
      readonly purged: true;
      /** The new files, the session's current file last. */
      readonly files: readonly string[];
      /** How many entries lost their content. */
      readonly entries: number;
      /** The marks that had an entry in the session. */
      readonly marks: readonly PurgeMark[];
      /**
       * The spill files of the purged results, which still hold their full text: the purge removed only the reference.
       * Delete each with the spill store that wrote it. A later purge does not list them again.
       */
      readonly spills: readonly string[];
      /** The entries the purge left as they are that may still hold a deleted fact. */
      readonly residual: PurgeResidual;
    };

/**
 * The entries of a purged session, after its first marked call, that may restate what the call held: a purge clears
 * only the marked calls, so the fact can still be in a summary or in the model's own words. They are counted, not read,
 * so an entry listed here may hold nothing of the fact. Remove the session, or the entries' branch, to remove them.
 */
export interface PurgeResidual {
  /** The ids of the `compaction` entries, whose summary may restate the fact. */
  readonly compactions: readonly string[];
  /** The ids of the assistant `message_block` entries other than tool calls, whose text may restate the fact. */
  readonly assistantBlocks: readonly string[];
}

interface ChainFile {
  readonly id: string;
  readonly entries: readonly SessionEntry[];
  /** Whether the file is this session's own, so the purge may delete it once it is rewritten. */
  readonly own: boolean;
}

interface Chain {
  /** The files from the current one up, current first. */
  readonly files: readonly ChainFile[];
  /** Where in `files` the session's first file, or its purged copy, is. */
  readonly root: number;
  /**
   * The entries of the file named by the session id when the chain does not pass it: the copy of the first file that
   * an earlier purge wrote for the listing, or the first file a migration copied. It is the session's own.
   */
  readonly listing: readonly SessionEntry[] | undefined;
}

const load = async (store: SessionStore, key: SessionKey): Promise<SessionEntry[]> => {
  const found: SessionEntry[] = [];
  for await (const entry of store.load(key)) found.push(entry);
  return found;
};

const parentOf = (entries: readonly SessionEntry[]): string | undefined => {
  const header = entries[0];
  return header?.type === "session_header" && header.spawn === undefined ? header.parent?.session : undefined;
};

/** Whether `id`, reached from `previous` (or first, from the pointer), is still a file of the session `sessionId`. */
function isOwn(previous: string | undefined, id: string, sessionId: string): boolean {
  if (previous === undefined) return id === sessionId || (isDerivedFile(id) && !id.startsWith(PURGE_ABOVE_FILE));
  return ownsContinued(previous, id) && (isDerivedFile(id) || id === sessionId);
}

/**
 * The session's files from its current file up through each file it continues, current first. The session's own files
 * are its derived files down to its first file, or to the purged copy of it, and then the copies a purge made above
 * that; a fork's parent files beyond them belong to the session it was forked from, so the purge copies them and never
 * deletes them. A chain whose own files end without reaching a first file, as a migration's does, ends at its root.
 */
async function chainOf(store: SessionStore, index: SessionIndex, key: SessionKey): Promise<Chain> {
  const files: ChainFile[] = [];
  let own = true;
  for (let id: string | undefined = (await index.get(key)) ?? key.sessionId; id !== undefined; ) {
    if (files.length > MAX_FILES || files.some((file) => file.id === id)) {
      throw new HarnessError("session_corrupt", `the files of ${key.sessionId} have a cycle at ${id}`);
    }
    const entries = await load(store, { userId: key.userId, sessionId: id });
    if (entries.length === 0) break;
    own = own && isOwn(files.at(-1)?.id, id, key.sessionId);
    files.push({ id, entries, own });
    id = parentOf(entries);
  }
  const first = files.findIndex(
    (file) => file.own && (file.id === key.sessionId || file.id.startsWith(PURGE_ROOT_FILE)),
  );
  const root = first >= 0 ? first : files.findLastIndex((file) => file.own);
  if (root < 0) return { files, root, listing: undefined };
  const named = files[root]?.id === key.sessionId ? [] : await load(store, key);
  return { files, root, listing: named.length === 0 ? undefined : named };
}

/** The files of the user, other than `skip`, whose header continues one of `files`. */
async function dependentsOf(
  store: SessionStore,
  userId: string,
  files: ReadonlySet<string>,
  skip: ReadonlySet<string>,
) {
  const found: string[] = [];
  for await (const summary of store.list(userId)) {
    if (skip.has(summary.sessionId) || summary.spawn !== undefined) continue;
    const parent = summary.parent?.session;
    if (parent !== undefined && files.has(parent)) found.push(summary.sessionId);
  }
  return found;
}

/** Throws `session_conflict` when a file of the user, other than `skip`, continues one of `deleting`. */
async function refuseDependents(
  store: SessionStore,
  key: SessionKey,
  deleting: ReadonlySet<string>,
  skip: ReadonlySet<string>,
): Promise<void> {
  const dependents = await dependentsOf(store, key.userId, deleting, skip);
  if (dependents.length > 0) {
    throw new HarnessError(
      "session_conflict",
      `the files ${dependents.join(", ")} continue a file of ${key.sessionId} that the purge would delete, so purge them first`,
    );
  }
}

/** A file's header with its parent renamed to the new copy of that parent, when the purge wrote one. */
function renamedHeader(entry: SessionEntry, renamed: ReadonlyMap<string, string>): SessionEntry {
  if (entry.type !== "session_header" || entry.parent === undefined || entry.spawn !== undefined) return entry;
  const parent = renamed.get(entry.parent.session);
  return parent === undefined ? entry : { ...entry, parent: { ...entry.parent, session: parent } };
}

/** Writes a new file and reads it back, refusing a copy whose ids differ or that still holds marked content. */
async function writeChecked(
  store: SessionStore,
  target: SessionKey,
  entries: readonly SessionEntry[],
  marked: ReadonlySet<number>,
): Promise<void> {
  await store.append(
    target,
    entries.map(({ seq: _seq, ...entry }) => entry as EntryInput),
    { expectedLastId: null },
  );
  const back = await load(store, target);
  if (
    back.map((entry) => entry.id).join() !== entries.map((entry) => entry.id).join() ||
    back.some((entry, at) => marked.has(at) && keepsContent(entry))
  ) {
    throw new HarnessError(
      "session_corrupt",
      `the purged file ${target.sessionId} does not match what was written, so the purge stopped`,
    );
  }
}

/**
 * Rewrites the session so that no entry matching `marks` keeps its content. The files from the furthest one that holds
 * a marked entry down to the current file are written again under new names, each header pointing at the new copy of
 * the file above it, with every marked entry's content replaced by `purgedEntry()` and every entry's base fields kept.
 * Each new file is read back and compared before the pointer moves to the new current file, and the old files of the
 * session's own are deleted only after that. When the session's first file is among them, its purged copy is written
 * under the session's id again, replacing any copy an earlier purge wrote there, so a listing still finds the session
 * and no file under its id keeps a purged fact. A fork's parent file from another session is copied and left in place,
 * for that session's own purge, and a later purge of the fork deletes only the fork's own copies.
 *
 * A session with no marked entry is left alone. The purge throws a `HarnessError` with code `session_locked` when a
 * writer holds the lock, and with code `session_conflict`, before it writes anything, when another file of the user
 * continues one of the files it would delete: purge that fork first, which copies the shared part into the fork's own
 * files. A store has no index of the files that continue a file, so the check lists the user's files.
 */
export async function purgeSession(options: PurgeSessionOptions): Promise<PurgeSessionResult> {
  const handle = await options.lock.acquire(options.key);
  if (handle === "would_block") {
    throw new HarnessError(
      "session_locked",
      `another writer holds the session ${JSON.stringify(options.key.sessionId)}`,
    );
  }
  try {
    return await purgeLocked(options);
  } finally {
    await handle.release();
  }
}

/** The marked positions of each file of a chain, and the marks found in it, matched oldest file first. */
interface ChainMarks {
  readonly positions: ReadonlyMap<ChainFile, ReadonlySet<number>>;
  readonly found: ReadonlyMap<ChainFile, readonly PurgeMark[]>;
}

function chainMarks(chain: readonly ChainFile[], marks: readonly PurgeMark[]): ChainMarks {
  const oldest = [...chain].reverse();
  const matched = matchMarks(
    oldest.map((file) => file.entries),
    marks,
  );
  return {
    positions: new Map(oldest.map((file, at) => [file, matched.positions[at] ?? new Set<number>()])),
    found: new Map(oldest.map((file, at) => [file, matched.found[at] ?? []])),
  };
}

/**
 * Writes the purged copy of each file in `rewritten`, root first, each header naming the copy of the file above it,
 * and returns the new names, the root's purged entries when the root was among them, how many entries were purged and
 * the spill files of the purged results.
 */
async function writeCopies(
  options: PurgeSessionOptions,
  chain: readonly ChainFile[],
  root: number,
  rewritten: readonly ChainFile[],
  marked: ChainMarks["positions"],
) {
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const renamed = new Map<string, string>();
  const spills = new Set<string>();
  let rootEntries: SessionEntry[] | undefined;
  let count = 0;
  for (const file of rewritten) {
    const at = chain.indexOf(file);
    const positions = marked.get(file) ?? new Set<number>();
    const prefix = at === root ? PURGE_ROOT_FILE : at > root ? PURGE_ABOVE_FILE : PURGE_FILE;
    const name = `${prefix}${newId()}`;
    const entries = file.entries.map((entry, position) => {
      if (position === 0) return renamedHeader(entry, renamed);
      if (!positions.has(position) || !keepsContent(entry)) return entry;
      count += 1;
      if (entry.type === "tool_result" && entry.spill !== undefined) spills.add(entry.spill.path);
      return purgedEntry(entry);
    });
    await writeChecked(options.store, { userId: options.key.userId, sessionId: name }, entries, positions);
    renamed.set(file.id, name);
    if (at === root) rootEntries = entries;
  }
  return { renamed, rootEntries, count, spills: [...spills] };
}

/** The entries after the chain's first marked entry, oldest first, that may restate a deleted fact. */
function residualOf(chain: readonly ChainFile[], marked: ChainMarks["positions"]): PurgeResidual {
  const compactions: string[] = [];
  const assistantBlocks: string[] = [];
  let after = false;
  for (const file of [...chain].reverse()) {
    const positions = marked.get(file);
    file.entries.forEach((entry, position) => {
      if (positions?.has(position) === true) after = true;
      else if (!after) return;
      else if (entry.type === "compaction") compactions.push(entry.id);
      else if (entry.type === "message_block" && entry.role === "assistant" && entry.block.type !== "tool_call")
        assistantBlocks.push(entry.id);
    });
  }
  return { compactions, assistantBlocks };
}

async function purgeLocked(options: PurgeSessionOptions): Promise<PurgeSessionResult> {
  const { store, index, key } = options;
  const { files: chain, root, listing } = await chainOf(store, index, key);
  const marked = chainMarks(chain, options.marks);
  const holds = (file: ChainFile) =>
    file.entries.some((entry, at) => marked.positions.get(file)?.has(at) === true && keepsContent(entry));
  const listed = listing === undefined ? undefined : matchMarks([listing], options.marks);
  const listingHolds =
    listing?.some((entry, at) => listed?.positions[0]?.has(at) === true && keepsContent(entry)) === true;
  // The listing's copy of the first file holds what the first file's purged copy holds, so either brings in the root.
  const furthest = Math.max(chain.findLastIndex(holds), listingHolds ? root : -1);
  if (furthest < 0) return { purged: false };
  const rewritten = chain.slice(0, furthest + 1).reverse();
  const deleting = new Set(rewritten.filter((file) => file.own).map((file) => file.id));
  if (root >= 0 && furthest >= root && listing !== undefined) deleting.add(key.sessionId);
  await refuseDependents(store, key, deleting, new Set([...chain.map((file) => file.id), key.sessionId]));
  const { renamed, rootEntries, count, spills } = await writeCopies(options, chain, root, rewritten, marked.positions);
  const files = rewritten.map((file) => renamed.get(file.id) as string);
  await index.set(key, files.at(-1) as string);
  for (const id of deleting) await store.delete({ userId: key.userId, sessionId: id });
  // A listing finds a session by the file named by its id, so the purged copy of the first file is written under that
  // name again, replacing an earlier purge's copy. The chain reads the copy under its new name, so a crash before this
  // write leaves a session that still opens and only drops out of the listing until its next purge.
  const rootFile = chain[root];
  if (rootEntries !== undefined && rootFile !== undefined) {
    await writeChecked(store, key, rootEntries, marked.positions.get(rootFile) ?? new Set());
  }
  const found = new Set([...rewritten.flatMap((file) => marked.found.get(file) ?? []), ...(listed?.found[0] ?? [])]);
  return {
    purged: true,
    files,
    entries: count,
    marks: options.marks.filter((mark) => found.has(mark)),
    spills,
    residual: residualOf(chain, marked.positions),
  };
}
