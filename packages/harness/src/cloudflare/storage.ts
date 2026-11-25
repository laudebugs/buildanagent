/**
 * The parts of a Durable Object's storage, `ctx.storage`, that the Cloudflare adapters use, typed by their shape so
 * the package needs no Cloudflare types at run time or in its declarations. A SQLite-backed Durable Object's
 * `ctx.storage` fits `DurableStorageLike` as it is.
 */
import { HarnessError } from "../errors.js";

/** What a SQL statement returns here: every row, each keyed by column name. */
export interface SqlCursorLike {
  /** Every row the statement returned, read before the next statement runs. */
  toArray(): Record<string, unknown>[];
}

/** The part of `SqlStorage` (`ctx.storage.sql`) the adapters use. Each call completes synchronously. */
export interface SqlStorageLike {
  /** Runs one SQL statement with its `?` placeholders bound, in order, to `bindings`. */
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

/** The part of `DurableObjectStorage` (`ctx.storage`) the store, the index and the lock use. */
export interface SqlDurableStorageLike {
  readonly sql: SqlStorageLike;
  /**
   * Runs `closure` in one SQLite transaction and returns its result. When `closure` throws, every statement it ran is
   * rolled back.
   */
  transactionSync<T>(closure: () => T): T;
}

/** The part of `DurableObjectStorage` the alarm scheduler uses besides SQL: the object's one alarm. */
export interface DurableStorageLike extends SqlDurableStorageLike {
  /** Sets the object's one alarm, replacing any alarm already set, in milliseconds since the epoch. */
  setAlarm(scheduledTime: number): Promise<void>;
  /** Removes the object's alarm, if one is set. */
  deleteAlarm(): Promise<void>;
}

const corrupt = (column: string) =>
  new HarnessError("session_corrupt", `a row in the Durable Object's storage has no usable value in column ${column}`);

/** One row's column as a string. A row these adapters wrote always has it, so a missing one is `session_corrupt`. */
export function text(row: Record<string, unknown> | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value !== "string") throw corrupt(column);
  return value;
}

/** One row's column as a number, or a `session_corrupt` error naming the column. */
export function integer(row: Record<string, unknown> | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value !== "number") throw corrupt(column);
  return value;
}
