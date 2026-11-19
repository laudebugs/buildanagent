/**
 * The approval signers. Every signature names the key that made it, so a verifier can hold a ring of keys and rotate
 * the current one without stranding stored pauses (D5, ADR 0005). Each signer is HMAC-SHA-256 through Web Crypto, and
 * a key's bytes stay inside a non-extractable `CryptoKey` once imported: no signer exposes, logs or serializes a key.
 * Web Crypto is the bare `crypto` global, as in hash.ts, so the file type-checks against the Workers types too.
 */
import { constantTimeEqual, fromBase64Url, toBase64Url } from "./bytes.js";
import { SafetyError } from "./errors.js";

/**
 * Signs and verifies the payload of a pending request. `keyId` names the key `sign()` uses now; `verify()` accepts a
 * signature from any key the signer holds. `verify()` resolves to `false` for an unknown key id or a malformed or
 * wrong signature, and never throws for bad input.
 */
export interface ApprovalSigner {
  /** The id of the key that `sign()` uses. */
  readonly keyId: string;
  /** Signs `payload` with the current key. */
  sign(payload: Uint8Array): Promise<string>;
  /** True only when `signature` is the signature of `payload` under the key named `keyId`. */
  verify(keyId: string, payload: Uint8Array, signature: string): Promise<boolean>;
}

/** The options of `hmacSigner()`: every key the signer may verify with, by id, and the id of the one it signs with. */
export interface HmacSignerOptions {
  /** Each key's raw bytes, at least 32 of them, under its key id. */
  readonly keys: Readonly<Record<string, Uint8Array>>;
  /** The id of the key that signs. It must be one of `keys`. */
  readonly current: string;
}

const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const MAC_BYTES = 32;
/** The shortest key `hmacSigner()` accepts: one SHA-256 output, the length RFC 2104 recommends as the minimum. */
export const MIN_KEY_BYTES = 32;
// Key ids are written into stored records and may appear in logs, so they are short and plain.
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function invalidRing(message: string): SafetyError {
  return new SafetyError("invalid_key_ring", message);
}

function checkKeyId(keyId: unknown, what: string): string {
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) {
    throw invalidRing(`${what} must be 1 to 64 letters, digits, '.', '_', ':' or '-', starting with a letter or digit`);
  }
  return keyId;
}

/** A signer over `keyFor`, which returns the key for an id it holds and `undefined` for any other. */
function macSigner(keyId: string, keyFor: (id: string) => Promise<CryptoKey> | undefined): ApprovalSigner {
  const mac = async (key: Promise<CryptoKey>, payload: Uint8Array) =>
    new Uint8Array(await crypto.subtle.sign("HMAC", await key, new Uint8Array(payload)));
  return Object.freeze({
    keyId,
    async sign(payload: Uint8Array): Promise<string> {
      if (!ArrayBuffer.isView(payload)) throw new SafetyError("invalid_pending", "a signed payload must be bytes");
      // keyFor() holds the current key by construction, so it is present.
      const key = keyFor(keyId) as Promise<CryptoKey>;
      return toBase64Url(await mac(key, payload));
    },
    async verify(id: string, payload: Uint8Array, signature: string): Promise<boolean> {
      if (typeof id !== "string" || typeof signature !== "string" || !ArrayBuffer.isView(payload)) return false;
      const key = keyFor(id);
      if (key === undefined) return false;
      const given = fromBase64Url(signature);
      if (given === undefined || given.length !== MAC_BYTES) return false;
      // Recompute and compare in constant time, rather than trust the runtime's verify() to be constant-time.
      return constantTimeEqual(given, await mac(key, payload));
    },
  });
}

/** Copies each key, so a caller that later changes its array can't change the ring, and checks ids and lengths. */
function copyRing(keys: unknown): Map<string, Uint8Array<ArrayBuffer>> {
  if (typeof keys !== "object" || keys === null) throw invalidRing("keys must be an object of key id to key bytes");
  const ring = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [id, bytes] of Object.entries(keys)) {
    checkKeyId(id, `the key id ${JSON.stringify(id)}`);
    if (!(bytes instanceof Uint8Array) || bytes.length < MIN_KEY_BYTES) {
      // The message names the key id only: a key's bytes never reach an error, a log or a stored record.
      throw invalidRing(`the key ${JSON.stringify(id)} must be a Uint8Array of at least ${MIN_KEY_BYTES} bytes`);
    }
    ring.set(id, new Uint8Array(bytes));
  }
  if (ring.size === 0) throw invalidRing("keys must hold at least one key");
  return ring;
}

/**
 * A signer over a key ring, for any host where a pause may resume in another process: it signs with the key named
 * `current` and verifies with any key in `keys`. To rotate, add a new key, make it current, and keep the old one in
 * the ring until no unresolved pause names it.
 *
 * The keys are copied, so later changes to the arrays you pass have no effect. Throws a `SafetyError`, code
 * `invalid_key_ring`, for an empty ring, a key shorter than 32 bytes, a malformed key id, or a `current` that isn't in
 * the ring. No error, log line or signer property ever holds a key's bytes.
 */
export function hmacSigner(options: HmacSignerOptions): ApprovalSigner {
  const ring = copyRing(options.keys);
  const current = checkKeyId(options.current, "current");
  if (!ring.has(current)) throw invalidRing(`current names the key ${JSON.stringify(current)}, which keys lacks`);
  const imported = new Map<string, Promise<CryptoKey>>();
  return macSigner(current, (id) => {
    const cached = imported.get(id);
    if (cached !== undefined) return cached;
    const bytes = ring.get(id);
    if (bytes === undefined) return undefined;
    const key = crypto.subtle.importKey("raw", bytes, HMAC, false, ["sign"]);
    imported.set(id, key);
    // The CryptoKey now holds the key, so the copy is wiped and dropped.
    bytes.fill(0);
    ring.delete(id);
    return key;
  });
}

let ephemeral: ApprovalSigner | undefined;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A signer whose key is random and lives only in this process: every call in one process returns the same signer, and
 * no other process can verify what it signs. Its key id is random too, so another process rejects the signature as
 * one from an unknown key.
 *
 * Use it only where a pause resumes in the process that made it. On a serverless host an isolate or function can be
 * recycled between a pause and its resume, and the pause then fails closed; pass `hmacSigner()` over a persistent key
 * ring there instead.
 */
export function ephemeralSigner(): ApprovalSigner {
  if (ephemeral === undefined) {
    const keyId = `ephemeral-${hex(crypto.getRandomValues(new Uint8Array(8)))}`;
    let key: Promise<CryptoKey> | undefined;
    ephemeral = macSigner(keyId, (id) => {
      if (id !== keyId) return undefined;
      // Generated on first use and never extractable, so the key's bytes never exist outside Web Crypto. An HMAC key
      // is one secret key, never a pair, which the Workers types' wider return type doesn't express.
      key ??= crypto.subtle.generateKey({ ...HMAC, length: 256 }, false, ["sign"]) as Promise<CryptoKey>;
      return key;
    });
  }
  return ephemeral;
}

/** The key id of `testSigner()`. */
export const TEST_KEY_ID = "test-fixed-key";
// Public on purpose: tests in any process, and fixtures checked into the repo, must produce the same signatures.
const TEST_KEY = new TextEncoder().encode("buildanagent testSigner fixed key, never for production");

/**
 * A signer with a fixed, published key, for tests and fixtures: every process produces the same signatures, so a
 * signed pause can be checked into a test. Anyone can forge its signatures. Never use it outside tests, and never add
 * its key id, `test-fixed-key`, to a real key ring.
 */
export function testSigner(): ApprovalSigner {
  return hmacSigner({ keys: { [TEST_KEY_ID]: TEST_KEY }, current: TEST_KEY_ID });
}
