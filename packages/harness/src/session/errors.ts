/** The session store's two named errors, each a `HarnessError` with its own code and fields. */
import { HarnessError } from "../errors.js";

/**
 * Thrown by `append()` when the log is not in the state the caller expected: `expectedLastId` is stale, an entry id is
 * already stored with different content, or a batch is partly stored out of order. Nothing is written. A caller that
 * lost a race reloads the log and decides again.
 */
export class ConflictError extends HarnessError {
  override readonly name = "ConflictError";

  constructor(why: string) {
    super("session_conflict", `the session log changed under this append: ${why}`);
  }
}

/** Thrown by `append()` when an entry's JSON is over the store's bound, which is 64 KiB unless the store sets another. */
export class EntryTooLargeError extends HarnessError {
  override readonly name = "EntryTooLargeError";
  readonly entryId: string;
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(entryId: string, bytes: number, maxBytes: number) {
    super(
      "entry_too_large",
      `entry "${entryId}" is ${bytes} bytes, over the store's bound of ${maxBytes}; spill large content to a file and keep a reference`,
    );
    this.entryId = entryId;
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}
