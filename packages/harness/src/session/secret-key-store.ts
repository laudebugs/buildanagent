/**
 * `secretKeyStore()`: a read-only `KeyStore` over a secret the host can read but not write, such as a Worker secret, a
 * Secrets Manager value or a secret environment variable. The platform's own tooling rotates the secret, so the store
 * has `load()` only (ADR 0035). `rotateKeys()` and `pruneKeys()` call a store's optional methods and, for a read-only
 * store, throw an error that names the tooling to use instead. Nothing here needs Node, so it runs on every target.
 */
import { hmacSigner, type KeyRing, type KeyStore, parseKeyRing } from "@buildanagent/agent-safety";
import { HarnessError } from "../errors.js";

/** The options of `secretKeyStore()`. */
export interface SecretKeyStoreOptions {
  /**
   * Returns the secret's text: the JSON ring `parseKeyRing()` reads, such as
   * `{"current":"2026-11","keys":{"2026-11":"<key>"}}`. It is called on every `load()`.
   */
  readonly read: () => string | Promise<string>;
}

const invalid = (message: string, cause?: unknown) =>
  new HarnessError("invalid_key_store", message, cause === undefined ? undefined : { cause });

/**
 * A `KeyStore` whose `load()` calls `read()` and parses the text it returns. It reads the secret on every call and
 * keeps no copy, so a ring the platform rotated takes effect at the next `load()`. It has no `rotate()` or `prune()`:
 * rotate with the platform's secret tooling, and keep an old key in the ring until no unresolved pause names it.
 *
 * `load()` throws a `HarnessError`, code `invalid_key_store`, when `read()` fails or returns something that is not a
 * usable ring: not JSON, a key that is not base64url or is shorter than 32 bytes, or a `current` the ring lacks. The
 * error never holds the secret's text or a key's bytes.
 */
export function secretKeyStore(options: SecretKeyStoreOptions): KeyStore {
  const { read } = options;
  if (typeof read !== "function") throw invalid("secretKeyStore() needs a read function that returns the secret");
  return {
    load: async (): Promise<KeyRing> => {
      let text: unknown;
      try {
        text = await read();
      } catch (cause) {
        throw invalid("the key ring secret could not be read", cause);
      }
      if (typeof text !== "string") throw invalid("the key ring secret's reader must return a string");
      try {
        const ring = parseKeyRing(text);
        // The signer checks what the parser leaves out: key lengths, key ids and that `current` is in the ring.
        hmacSigner(ring);
        return ring;
      } catch (cause) {
        // The cause is a SafetyError, whose message names key ids only, never the text or a key.
        throw invalid("the key ring secret is not a usable key ring", cause);
      }
    },
  };
}

/** Where a read-only store's error sends the owner when no hint is given. */
export const DEFAULT_PLATFORM_HINT =
  "your platform's secret tooling, such as wrangler secret put, aws secretsmanager put-secret-value or vercel env";

/** The options of `rotateKeys()` and `pruneKeys()`. */
export interface KeyChangeOptions {
  /** The tool a read-only store's error names, such as `wrangler secret put`. Default `DEFAULT_PLATFORM_HINT`. */
  readonly platformHint?: string;
}

function readOnly(action: string, options: KeyChangeOptions | undefined): HarnessError {
  const hint = options?.platformHint ?? DEFAULT_PLATFORM_HINT;
  return new HarnessError(
    "key_store_read_only",
    `this key store is read-only, so the harness cannot ${action}; change the secret with ${hint}`,
  );
}

/**
 * Adds a new current key to `store` and returns its id. Throws a `HarnessError`, code `key_store_read_only`, when the
 * store has no `rotate()`, with a message that names the platform tool to rotate with instead.
 */
export function rotateKeys(store: KeyStore, options?: KeyChangeOptions): Promise<string> {
  if (store.rotate === undefined) return Promise.reject(readOnly("rotate keys", options));
  return store.rotate();
}

/**
 * Removes every key of `store` that is neither current nor in `inUse`, and returns the removed ids. Pass every key id
 * that an unresolved pause names, or that pause fails closed. Throws a `HarnessError`, code `key_store_read_only`, when
 * the store has no `prune()`, with a message that names the platform tool to remove keys with instead.
 */
export function pruneKeys(store: KeyStore, inUse: ReadonlySet<string>, options?: KeyChangeOptions): Promise<string[]> {
  if (store.prune === undefined) return Promise.reject(readOnly("prune keys", options));
  return store.prune(new Set(inUse));
}
