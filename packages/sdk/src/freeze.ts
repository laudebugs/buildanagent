/**
 * Frozen copies of the data a hook receives, so a hook that mutates its input throws instead of changing the run's
 * own transcript (agent-SDK guide §6, rule 2: a hook returns a replacement).
 */

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyOf(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyOf(item, seen));
    return Object.freeze(copy);
  }
  // A class instance, such as an `Error` in a result's details, is kept as it is: copying would lose its behaviour.
  if (!isPlain(value)) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = copyOf(item, seen);
  return Object.freeze(copy);
}

/** A deep, frozen copy of the plain objects and arrays in `value`; other values are shared. */
export function frozenCopy<T>(value: T): T {
  return copyOf(value, new WeakMap()) as T;
}
