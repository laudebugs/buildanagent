/** The spills of one session, in log order: which file holds the full text of each capped tool result. */
import { entriesAfterCompaction } from "../session/rebuild.js";
import type { Session } from "../session/session.js";

/** Where a capped result's full text went. An empty path means the result was never spilled. */
export type Spill = { readonly path: string; readonly bytes: number };
/** A result that was not capped still takes its place in the list, so the nth result of a call id finds its own spill. */
export const NO_SPILL: Spill = { path: "", bytes: 0 };

export class SpillLedger {
  // Every spill of a call id, in log order: a provider may reuse an id, so a masked result is told apart by its place.
  readonly #spills = new Map<string, Spill[]>();
  readonly #session: Session;
  #loading: Promise<void> | undefined;

  constructor(session: Session) {
    this.#session = session;
  }

  /** Records the spill of the next result with this call id. */
  remember(callId: string, spill: Spill): void {
    this.#spills.set(callId, [...(this.#spills.get(callId) ?? []), spill]);
  }

  async #read(): Promise<void> {
    // Only the results the compacted context still holds, so a result's place here is its place in the view.
    for (const entry of entriesAfterCompaction(await this.#session.path()).entries) {
      if (entry.type === "tool_result") this.remember(entry.callId, entry.spill ?? NO_SPILL);
    }
  }

  /**
   * Reads the earlier turns' spills from the log once. One shared promise makes parallel callers all wait for the read,
   * and a failed read is tried again by the next caller.
   */
  learn(): Promise<void> {
    this.#loading ??= this.#read().catch((error: unknown) => {
      this.#loading = undefined;
      throw error;
    });
    return this.#loading;
  }

  /** Reads the log again, after a compaction changed which results the context holds. */
  reload(): Promise<void> {
    this.#spills.clear();
    this.#loading = undefined;
    return this.learn();
  }

  /** The latest spill of a call id, or `undefined` when its latest result was not capped. */
  latest(callId: string): Spill | undefined {
    const spill = this.#spills.get(callId)?.at(-1);
    return spill === undefined || spill.path === "" ? undefined : spill;
  }

  /** The words a masked result's pointer line uses for the `occurrence`th result of a call id. */
  where(callId: string, occurrence: number): string {
    const spill = this.#spills.get(callId)?.[occurrence];
    return spill === undefined || spill.path === ""
      ? `the full text is in the session log, call ${callId}`
      : `the full text is in ${spill.path}`;
  }
}
