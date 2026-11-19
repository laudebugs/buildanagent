/**
 * `canonicalInputHash()`: one hash per tool input, whatever order its keys arrive in. Approvals sign it and effect
 * records store it, so both must compute it the same way on every runtime: canonical JSON as RFC 8785 (JCS) defines
 * it, hashed with Web Crypto's SHA-256.
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

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalObject(value: Record<string, unknown>, path: string): string {
  // JCS sorts property names by UTF-16 code units, which is what the default sort compares.
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const members = keys.map((key) => `${canonicalString(key, path)}:${canonical(value[key], `${path}.${key}`)}`);
  return `{${members.join(",")}}`;
}

function canonicalArray(value: readonly unknown[], path: string): string {
  const items = value.map((item, index) => {
    if (item === undefined) throw invalid(`${path}[${index}]`, "is undefined");
    return canonical(item, `${path}[${index}]`);
  });
  return `[${items.join(",")}]`;
}

function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  return typeof value === "object" ? "an object that isn't plain" : `a ${typeof value}`;
}

function canonical(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return canonicalString(value, path);
  if (typeof value === "number") return canonicalNumber(value, path);
  if (Array.isArray(value)) return canonicalArray(value, path);
  if (typeof value === "object" && isPlainObject(value)) return canonicalObject(value, path);
  throw invalid(path, `is ${describeType(value)}`);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes a tool input: the SHA-256 of its canonical JSON (RFC 8785), as 64 lowercase hex digits. Two inputs whose
 * object keys differ only in order get the same hash, and any changed value gives a different one. Object properties
 * set to `undefined` are left out, as `JSON.stringify` leaves them out. Throws a `SafetyError` with code
 * `invalid_input` for a value JSON can't hold the same way everywhere: `undefined` in an array, a number that isn't
 * finite, a string with a lone surrogate, a bigint, symbol or function, or an object that isn't plain, such as a
 * `Date`.
 */
export async function canonicalInputHash(input: unknown): Promise<string> {
  const text = canonical(input, "$");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", ENCODER.encode(text)));
}
