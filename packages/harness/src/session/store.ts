/**
 * The session store's interface and the rules every backend shares. A session belongs to a user: every method names
 * the user, and a session under another user looks exactly like one that doesn't exist, so no caller can forget the
 * owner check. `planAppend()` holds the append rules once, so the memory and JSONL backends cannot drift apart.
 */
import { parseEntry, type SessionEntry, type SessionHeaderEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import { ConflictError, EntryTooLargeError } from "./errors.js";

/** The default bound on one entry's JSON, in bytes. */
export const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024;
const MAX_KEY_PART = 64;

/** Which session: its user and its id. No method finds a session by its id alone. */
export interface SessionKey {
  readonly userId: string;
  readonly sessionId: string;
}

type OmitSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** An entry as a caller writes it. The store assigns `seq`, so the caller never has to count. */
export type EntryInput = OmitSeq<SessionEntry>;

/** What `list()` says about a session, read from its header and its last entry. */
export interface SessionSummary {
  readonly sessionId: string;
  /** The header's timestamp. */
  readonly startedAt: string;
  /** The timestamp of the last entry. */
  readonly lastEntryAt: string;
  readonly entryCount: number;
  readonly harnessVersion: string;
  readonly sdkVersion: string;
  readonly parent?: SessionHeaderEntry["parent"];
  readonly product?: SessionHeaderEntry["product"];
}

/** The options of `append()`. */
export interface AppendOptions {
  /**
   * The id of the entry the log must end with, or `null` for a session that doesn't exist yet. A different tail throws
   * a `ConflictError` and writes nothing, so two writers can't both extend the same log. A batch that is already
   * stored, in whole or in part, is a retry and skips this check.
   */
  readonly expectedLastId?: string | null;
}

/** The options of `load()`. */
export interface LoadOptions {
  /** The first sequence number to yield. Default 0. */
  readonly fromSeq?: number;
  /** Called once if the log ends in a line that was never completed, which `load()` skips. */
  readonly onTornLine?: (line: { readonly bytes: number }) => void;
}

/** Where a session's entries live. Every method names the user. */
export interface SessionStore {
  /**
   * Appends entries, assigns each its `seq` and returns them as stored. It is idempotent by entry id: an entry already
   * stored with the same content is not written again, and one stored with different content throws a
   * `ConflictError`. A new session's first entry must be a `session_header`. It throws an `EntryTooLargeError` above
   * the size bound and a `HarnessError` for an entry that is not valid. A batch is written in one step, and a failure
   * writes none of it.
   */
  append(key: SessionKey, entries: readonly EntryInput[], options?: AppendOptions): Promise<SessionEntry[]>;
  /** The entries from `fromSeq` on, in order. A session that doesn't exist, or belongs to another user, yields none. */
  load(key: SessionKey, options?: LoadOptions): AsyncIterable<SessionEntry>;
  /** The user's sessions only, oldest first. */
  list(userId: string): AsyncIterable<SessionSummary>;
  /** Deletes the session. A session that doesn't exist, or belongs to another user, is left alone and is no error. */
  delete(key: SessionKey): Promise<void>;
}

/**
 * A user or session id as a file name: every byte outside `[a-z0-9_-]` becomes `%XX`, capital letters and dots
 * included, so no id can name `..`, climb out of its folder, or collide with another id on a file system that ignores case.
 */
export function encodeName(part: string): string {
  return [...new TextEncoder().encode(part)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[a-z0-9_-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

const MAX_NAME_BYTES = 200;

/** Throws a `HarnessError` with code `invalid_session_key` unless both parts are usable as a name, in every backend. */
export function checkKey(key: SessionKey): void {
  for (const [label, value] of [
    ["userId", key?.userId],
    ["sessionId", key?.sessionId],
  ] as const) {
    if (
      typeof value !== "string" ||
      value === "" ||
      [...value].length > MAX_KEY_PART ||
      [...value].some((char) => char.charCodeAt(0) < 32) ||
      encodeName(value).length > MAX_NAME_BYTES
    ) {
      throw new HarnessError(
        "invalid_session_key",
        `a session ${label} must be 1 to ${MAX_KEY_PART} characters with no control characters, and fit in a file name once encoded`,
      );
    }
  }
}

/** The log as a backend holds it: its entries by id, and where it ends. */
export interface LogState {
  readonly byId: ReadonlyMap<string, SessionEntry>;
  readonly lastId: string | null;
  readonly lastSeq: number;
}

// Key order and `undefined` fields must not make two equal entries look different.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((name) => record[name] !== undefined)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${stable(record[name])}`);
  return `{${fields.join(",")}}`;
}

const sameContent = (a: SessionEntry, b: SessionEntry): boolean => {
  const { seq: _a, ...left } = a;
  const { seq: _b, ...right } = b;
  return stable(left) === stable(right);
};

/** The bytes of an entry's JSON, which is what the size bound counts. */
export function entryBytes(entry: SessionEntry): number {
  return new TextEncoder().encode(JSON.stringify(entry)).length;
}

function invalidEntry(why: string, cause?: unknown): never {
  throw new HarnessError("invalid_session_entry", why, cause === undefined ? undefined : { cause });
}

/** Validates an entry with its assigned `seq`, through the protocol's own parser. */
function validated(input: EntryInput, seq: number): SessionEntry {
  try {
    return parseEntry(structuredClone({ ...input, seq }));
  } catch (cause) {
    return invalidEntry(`an entry is not valid: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }
}

/** The entries of a batch that are already stored. They must be the batch's first entries, in order, and equal. */
function storedPrefix(log: LogState, inputs: readonly EntryInput[]): SessionEntry[] {
  const stored: SessionEntry[] = [];
  for (const [index, input] of inputs.entries()) {
    const existing = log.byId.get(input.id);
    if (existing === undefined) {
      if (inputs.slice(index + 1).some((later) => log.byId.has(later.id))) {
        throw new ConflictError("a batch is partly stored, and not as its first entries");
      }
      break;
    }
    if (!sameContent(existing, { ...input, seq: existing.seq } as SessionEntry)) {
      throw new ConflictError(`entry "${input.id}" is already stored with different content`);
    }
    stored.push(existing);
  }
  return stored;
}

/** What an append will do: the entries it returns, and the ones to write. */
export interface AppendPlan {
  readonly result: SessionEntry[];
  readonly fresh: SessionEntry[];
}

/**
 * Applies the append rules to a log and a batch, without writing: idempotency by id, the expected tail, the header
 * first, validation and the size bound. Throws before anything is written, so a backend writes `fresh` or nothing.
 */
export function planAppend(
  log: LogState,
  inputs: readonly EntryInput[],
  options: AppendOptions | undefined,
  maxBytes: number,
): AppendPlan {
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length) invalidEntry("a batch repeats an entry id");
  const stored = storedPrefix(log, inputs);
  if (stored.length > 0 && stored.length < inputs.length && stored.at(-1)?.id !== log.lastId) {
    throw new ConflictError("the stored part of this batch is no longer the end of the log");
  }
  if (stored.length === 0 && options?.expectedLastId !== undefined && options.expectedLastId !== log.lastId) {
    throw new ConflictError(
      `the log ends at ${JSON.stringify(log.lastId)}, not ${JSON.stringify(options.expectedLastId)}`,
    );
  }
  const fresh = inputs.slice(stored.length).map((input, offset) => validated(input, log.lastSeq + 1 + offset));
  for (const [offset, entry] of fresh.entries()) {
    const first = log.lastSeq < 0 && offset === 0;
    if (first !== (entry.type === "session_header")) {
      invalidEntry(
        first
          ? "a session's first entry must be a session_header"
          : "only a session's first entry may be a session_header",
      );
    }
    const bytes = entryBytes(entry);
    if (bytes > maxBytes) throw new EntryTooLargeError(entry.id, bytes, maxBytes);
  }
  return { result: [...stored, ...fresh], fresh };
}

/** The log's state after `entries`, a copy that a backend can keep. */
export function stateOf(entries: readonly SessionEntry[]): LogState {
  const last = entries.at(-1);
  return {
    byId: new Map(entries.map((entry) => [entry.id, entry])),
    lastId: last?.id ?? null,
    lastSeq: last?.seq ?? -1,
  };
}

/** A summary from a log's entries, or `undefined` for a log with no header. */
export function summaryOf(sessionId: string, entries: readonly SessionEntry[]): SessionSummary | undefined {
  const header = entries[0];
  const last = entries.at(-1);
  if (header?.type !== "session_header" || last === undefined) return undefined;
  return {
    sessionId,
    startedAt: header.timestamp,
    lastEntryAt: last.timestamp,
    entryCount: entries.length,
    harnessVersion: header.harnessVersion,
    sdkVersion: header.sdkVersion,
    ...(header.parent === undefined ? {} : { parent: header.parent }),
    ...(header.product === undefined ? {} : { product: header.product }),
  };
}

/** The order `list()` uses: oldest first, then by id. */
export function byAge(a: SessionSummary, b: SessionSummary): number {
  return a.startedAt === b.startedAt ? a.sessionId.localeCompare(b.sessionId) : a.startedAt.localeCompare(b.startedAt);
}
