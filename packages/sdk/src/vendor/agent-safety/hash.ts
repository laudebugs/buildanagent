/**
 * `canonicalInputHash()`: one hash per tool input, whatever order its keys arrive in. Approvals sign it and effect
 * records store it, so both must compute it the same way on every runtime: canonical JSON as RFC 8785 (JCS) defines
 * it, hashed with Web Crypto's SHA-256. Web Crypto is read as the bare `crypto` global, the same object as
 * `globalThis.crypto`, because the Workers types declare it as a `const`, which `typeof globalThis` lacks.
 */
import { SafetyError } from "./errors.js";

const ENCODER = new TextEncoder();

function invalid(path: string, why: string): SafetyError {
  return new SafetyError("invalid_input", `the input at ${path} ${why}, so it has no canonical JSON form`);
}

function canonicalString(value: string, path: string): string {
  // JCS refuses lone surrogates, which JSON.stringify would escape instead.
  if (!value.isWellFormed()) throw invalid(path, "holds a lone surrogate");
  return JSON.stringify(value);
}

function canonicalNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) throw invalid(path, `is ${value}`);
  // JCS serializes numbers as ECMAScript does, which JSON.stringify follows, including -0 as 0.
  return JSON.stringify(value);
}

// Plain means a null prototype or any realm's `Object.prototype`, whose own prototype is null: an object made in a
// `vm` context or an iframe is as plain as one made here, while a `Date` or class instance is not.
function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  // JCS sorts property names by UTF-16 code units, which is what `<` compares.
  return a < b ? -1 : a > b ? 1 : 0;
}

// `ancestors` holds the objects and arrays that enclose the current value, so a cycle throws instead of recursing
// until the stack runs out. A value shared by two siblings is no cycle, so it is removed again on the way out.
function canonicalObject(value: Record<string, unknown>, path: string, ancestors: Set<object>): string {
  // Each property is read once, so a getter or a Proxy can't be counted as present and then read as undefined.
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(byKey);
  const members = entries.map(
    ([key, item]) =>
      `${canonicalString(key, `${path}'s property name`)}:${canonical(item, `${path}.${key}`, ancestors)}`,
  );
  return `{${members.join(",")}}`;
}

function canonicalArray(value: readonly unknown[], path: string, ancestors: Set<object>): string {
  // An index loop, because `map` skips the holes of a sparse array and `join` would then write `[1,,3]`.
  const items: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const itemPath = `${path}[${index}]`;
    if (!(index in value)) throw invalid(itemPath, "is a hole in a sparse array");
    const item = value[index];
    if (item === undefined) throw invalid(itemPath, "is undefined");
    items.push(canonical(item, itemPath, ancestors));
  }
  return `[${items.join(",")}]`;
}

function nested(value: object, path: string, ancestors: Set<object>, write: () => string): string {
  if (ancestors.has(value)) throw invalid(path, "refers back to an object that contains it");
  ancestors.add(value);
  try {
    return write();
  } finally {
    ancestors.delete(value);
  }
}

function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  return typeof value === "object" ? "an object that isn't plain" : `a ${typeof value}`;
}

function canonical(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return canonicalString(value, path);
  if (typeof value === "number") return canonicalNumber(value, path);
  if (Array.isArray(value)) return nested(value, path, ancestors, () => canonicalArray(value, path, ancestors));
  if (typeof value === "object" && isPlainObject(value)) {
    return nested(value, path, ancestors, () => canonicalObject(value, path, ancestors));
  }
  throw invalid(path, `is ${describeType(value)}`);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes a tool input: the SHA-256 of its canonical JSON (RFC 8785), as 64 lowercase hex digits. Two inputs whose
 * object keys differ only in order get the same hash, and any changed value gives a different one. Object properties
 * set to `undefined` are left out, as `JSON.stringify` leaves them out. The hash is async, because Web Crypto's
 * digest is.
 *
 * It rejects with a `SafetyError`, code `invalid_input`, for a value that has no single JSON form:
 * - `undefined`, or a hole, in an array;
 * - a number that isn't finite;
 * - a string with a lone surrogate;
 * - a bigint, symbol or function;
 * - an object that isn't plain, such as a `Date` (a plain object's prototype is `null` or any realm's
 *   `Object.prototype`);
 * - an object or array that contains itself.
 */
export async function canonicalInputHash(input: unknown): Promise<string> {
  const text = canonical(input, "$", new Set());
  return hex(await crypto.subtle.digest("SHA-256", ENCODER.encode(text)));
}
