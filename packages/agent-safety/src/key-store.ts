/**
 * `KeyStore`: where a host keeps its approval key ring. Only `load()` is required, so a read-only cloud secret can
 * back the ring, and rotation is then the platform's job (ADR 0035). `parseKeyRing()` reads the ring from the text of
 * such a secret.
 */
import { fromBase64Url } from "./bytes.js";
import { SafetyError } from "./errors.js";
import { type ApprovalSigner, hmacSigner } from "./signer.js";

/** A key ring: every key a signer may verify with, by id, and the id of the key that signs. */
export interface KeyRing {
  /** Every key the signer may verify with, by key id. Each key is 32 or more random bytes. */
  readonly keys: Readonly<Record<string, Uint8Array>>;
  /** The id of the key that signs, which must be one of `keys`. */
  readonly current: string;
}

/**
 * A host's key ring store. `load()` returns the ring. `rotate()` adds a new current key and returns its id, and
 * `prune()` removes the keys no unresolved pause names, other than the current one, and returns their ids; a store
 * backed by a read-only secret leaves both out.
 */
export interface KeyStore {
  /** Returns the current ring. */
  load(): Promise<KeyRing>;
  /** Adds a new key, makes it `current` and returns its id. Leave it out for a read-only store. */
  rotate?(): Promise<string>;
  /**
   * Removes every key whose id is not in `inUse`, the ids that unresolved pauses still name, except the current key,
   * which it always keeps, and returns the removed ids. A pause whose key is gone fails closed, so pass every id a
   * stored pending request names.
   */
  prune?(inUse: Set<string>): Promise<string[]>;
}

function invalid(message: string): SafetyError {
  return new SafetyError("invalid_key_ring", message);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The parser's message can quote the text around the error, which here is key material, so it is dropped.
    throw invalid("the key ring is not valid JSON");
  }
}

/**
 * Reads a key ring from JSON text such as a secret's value: `{"current":"2026-11","keys":{"2026-11":"<key>"}}`,
 * where each key is base64url without padding. Generate a key with 32 random bytes, for example
 * `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.
 *
 * Throws a `SafetyError`, code `invalid_key_ring`, when the text isn't such an object or a key isn't base64url. The
 * error never holds a key's value, but it repeats key ids as the text spells them, so don't show it where the text
 * itself must stay secret. `hmacSigner()` checks the rest: key lengths, ids and `current`.
 */
export function parseKeyRing(text: string): KeyRing {
  const value = parseJson(text);
  if (typeof value !== "object" || value === null) throw invalid("the key ring must be a JSON object");
  const { current, keys } = value as Record<string, unknown>;
  if (typeof current !== "string") throw invalid("the key ring's current must be a string");
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    throw invalid("the key ring's keys must be an object of key id to base64url key");
  }
  const decoded: Record<string, Uint8Array> = {};
  for (const [id, encoded] of Object.entries(keys)) {
    const bytes = typeof encoded === "string" ? fromBase64Url(encoded) : undefined;
    if (bytes === undefined) throw invalid(`the key ${JSON.stringify(id)} must be unpadded base64url`);
    Object.defineProperty(decoded, id, { value: bytes, enumerable: true });
  }
  return { keys: decoded, current };
}

/** Loads the ring from `store` and returns `hmacSigner()` over it. Load it again to pick up a rotated ring. */
export async function signerFromKeyStore(store: KeyStore): Promise<ApprovalSigner> {
  return hmacSigner(await store.load());
}
