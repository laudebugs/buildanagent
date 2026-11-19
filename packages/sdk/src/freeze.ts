/**
 * Frozen copies of the data a hook receives, so a hook that mutates its input throws instead of changing the run's
 * own transcript (agent-SDK guide §6, rule 2: a hook returns a replacement).
 */

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyOf(value: unknown, seen: WeakMap<object, unknown>, freeze = true): unknown {
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyOf(item, seen, freeze));
    return freeze ? Object.freeze(copy) : copy;
  }
  // A class instance, such as an `Error` in a result's details, is kept as it is: copying would lose its behaviour.
  if (!isPlain(value)) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = copyOf(item, seen, freeze);
  return freeze ? Object.freeze(copy) : copy;
}

/** A deep, frozen copy of the plain objects and arrays in `value`; other values are shared. */
export function frozenCopy<T>(value: T): T {
  return copyOf(value, new WeakMap()) as T;
}

/**
 * A deep, writable copy of the plain objects and arrays in `value`. A hook's event holds frozen copies, so an input a
 * gate hands back from the event must be thawed before a tool runs with it, or a tool that edits its input throws.
 */
export function thawedCopy<T>(value: T): T {
  return copyOf(value, new WeakMap(), false) as T;
}
