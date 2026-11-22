/**
 * `migrateSession()`: moves a session's log to the current format by writing a new file, checking it and then moving the
 * pointer. The old file is never changed, so a crash at any step leaves the session readable where it was.
 */
import { FORMAT_VERSION, parseEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { SessionIndex } from "./pointer.js";
import type { EntryInput, SessionKey, SessionStore } from "./store.js";

/** One step of format change: it maps each entry of a file at format `from` to an entry at format `to`. */
export interface Migration {
  readonly from: number;
  readonly to: number;
  /** Returns the entry in the new format, header included: its `formatVersion` must be `to`. */
  migrate(entry: unknown): unknown;
}

/** The options of `migrateSession()`. */
export interface MigrateOptions {
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly key: SessionKey;
  /** The steps this harness knows, from any format to the next. A session is taken through them in order. */
  readonly migrations: readonly Migration[];
  readonly newId?: () => string;
}

/** What `migrateSession()` did. */
export type MigrationResult =
  | { readonly migrated: false; readonly version: number }
  | {
      readonly migrated: true;
      readonly from: number;
      readonly to: number;
      readonly file: string;
      readonly entries: number;
    };

async function rawEntries(store: SessionStore, key: SessionKey): Promise<unknown[]> {
  if (store.loadRaw === undefined) {
    throw new HarnessError(
      "unsupported_format",
      "this store can't read a log as it was written, so it can't migrate one",
    );
  }
  const found: unknown[] = [];
  for await (const entry of store.loadRaw(key)) found.push(entry);
  return found;
}

/** The format version in a log's header, which a migration refuses to guess when it is missing. */
function versionOf(entries: readonly unknown[]): number {
  const header = entries[0] as { type?: unknown; formatVersion?: unknown } | undefined;
  if (header?.type !== "session_header" || typeof header.formatVersion !== "number") {
    throw new HarnessError("unsupported_format", "the log does not start with a session header that names its format");
  }
  return header.formatVersion;
}

function stepsFrom(version: number, migrations: readonly Migration[]): Migration[] {
  const steps: Migration[] = [];
  for (let at = version; at < FORMAT_VERSION; ) {
    const step = migrations.find((migration) => migration.from === at);
    if (step === undefined || step.to <= at) {
      throw new HarnessError("unsupported_format", `no migration takes format ${at} towards ${FORMAT_VERSION}`);
    }
    steps.push(step);
    at = step.to;
  }
  return steps;
}

/**
 * Migrates the session's current file to the current format. A session already there is left alone. A session from a
 * newer format is refused, because only a newer harness can read it. Otherwise the entries go through each step, the
 * new file is written in one append (which checks every entry against the current format), read back and compared, and
 * only then does the pointer move. A file whose header names a parent file is migrated alone, and its parent is not.
 */
export async function migrateSession(options: MigrateOptions): Promise<MigrationResult> {
  const { store, index, key } = options;
  const file = (await index.get(key)) ?? key.sessionId;
  const raw = await rawEntries(store, { userId: key.userId, sessionId: file });
  const version = versionOf(raw);
  if (version === FORMAT_VERSION) return { migrated: false, version };
  if (version > FORMAT_VERSION) {
    throw new HarnessError(
      "unsupported_format",
      `the log is format ${version}, newer than this harness reads (${FORMAT_VERSION})`,
    );
  }
  const steps = stepsFrom(version, options.migrations);
  const moved = raw.map((entry) => steps.reduce((value, step) => step.migrate(value), entry));
  const parsed = moved.map((entry) => parseEntry(entry));
  const newFile = `m${(options.newId ?? (() => globalThis.crypto.randomUUID()))()}`;
  const target = { userId: key.userId, sessionId: newFile };
  await store.append(
    target,
    parsed.map(({ seq: _seq, ...entry }) => entry as EntryInput),
    { expectedLastId: null },
  );
  const written: string[] = [];
  for await (const entry of store.load(target)) written.push(entry.id);
  if (written.join() !== parsed.map((entry) => entry.id).join()) {
    throw new HarnessError(
      "session_corrupt",
      "the migrated file does not match what was written, so the pointer was not moved",
    );
  }
  await index.set(key, newFile);
  return { migrated: true, from: version, to: FORMAT_VERSION, file: newFile, entries: parsed.length };
}
