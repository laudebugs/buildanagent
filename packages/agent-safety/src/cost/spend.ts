/**
 * `Spend`: where a cost guard keeps what a run or a session has spent. One `Spend` per run caps each run; one that
 * outlives the run, kept in storage every run of a session reads, caps the session.
 */

/** The USD a run or session has spent on model calls so far. */
export interface Spend {
  /** The dollars spent so far. */
  get(): Promise<number>;
  /** Records the cost of one finished call, in dollars. */
  add(usd: number): Promise<void>;
}

/** A `Spend` held in memory, starting at `initialUsd`, which lasts as long as the object does. */
export function memorySpend(initialUsd = 0): Spend {
  let spent = initialUsd;
  return {
    get: async () => spent,
    add: async (usd) => {
      spent += usd;
    },
  };
}
