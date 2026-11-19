/**
 * The step scheduler: decides when each tool call of one step starts (agent-SDK guide §4). It knows nothing about
 * tools, only about tasks that may share a resource, so the rules can be tested without a model.
 *
 * - By default every task starts at once, in model order.
 * - In a sequential batch, each task starts only after the one before it has settled.
 * - Tasks with the same `key` never overlap and start in model order. A read-only task shares its key with other
 *   read-only tasks (a readers-writer lock), and waits only for the writers before it.
 *
 * The queues are built while the tasks are handed in, in model order, so the order never depends on how fast a task
 * runs. No timers are used: a task waits on the promises of the tasks ahead of it.
 */

/** One unit of work for the scheduler. */
export interface Task<T> {
  /** Tasks with the same key never overlap. A task without one is not queued behind anything. */
  readonly key?: string;
  /** A read-only task may overlap other read-only tasks with its key; any other task waits for all before it. */
  readonly readOnly: boolean;
  run(): Promise<T>;
}

/** How a task ended: the scheduler catches each task's error so that no rejection goes unobserved. */
export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

async function settle<T>(task: Task<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await task.run() };
  } catch (error) {
    return { ok: false, error };
  }
}

// The tasks that currently hold or wait for one key: the last writer, and the readers queued since it.
interface Lane {
  writer: Promise<unknown>;
  readers: Promise<unknown>[];
}

function inLane<T>(lanes: Map<string, Lane>, key: string, task: Task<T>): Promise<Settled<T>> {
  const lane = lanes.get(key) ?? { writer: Promise.resolve(), readers: [] };
  lanes.set(key, lane);
  const ahead = task.readOnly ? [lane.writer] : [lane.writer, ...lane.readers];
  const settled = Promise.all(ahead).then(() => settle(task));
  if (task.readOnly) {
    lane.readers.push(settled);
  } else {
    lane.writer = settled;
    lane.readers = [];
  }
  return settled;
}

/**
 * Starts `tasks` by the rules above and returns one promise per task, in the same order. A task's own rejection
 * becomes a `Settled` value, so the promises never reject. With `sequential`, keys are moot: one task runs at a time.
 */
export function schedule<T>(tasks: readonly Task<T>[], sequential: boolean): Promise<Settled<T>>[] {
  const lanes = new Map<string, Lane>();
  let previous: Promise<unknown> = Promise.resolve();
  return tasks.map((task) => {
    if (sequential) {
      const settled = previous.then(() => settle(task));
      previous = settled;
      return settled;
    }
    return task.key === undefined ? settle(task) : inLane(lanes, task.key, task);
  });
}
