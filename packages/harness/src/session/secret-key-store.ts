/**
 * `secretKeyStore()`: a read-only `KeyStore` over a secret the host can read but not write, such as a Worker secret, a
 * Secrets Manager value or a secret environment variable. The platform's own tooling rotates the secret, so the store
 * has `load()` only (ADR 0035). `rotateKeys()` and `pruneKeys()` call a store's optional methods and, for a read-only
 * store, reject with an error that names the tooling to use instead. Nothing here needs Node, so it runs on every target.
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

// No error built here carries a cause: a reader's error can quote the secret, as `JSON.parse` quotes its input, and a
// SafetyError repeats key ids as the ring spells them, so a ring with a key in an id position would put the key in the
// message. A fixed message is the only text that cannot hold key material.
const invalid = (message: string) => new HarnessError("invalid_key_store", message);

/**
 * A `KeyStore` whose `load()` calls `read()` and parses the text it returns. It reads the secret on every call and
 * keeps no copy, so a ring the platform rotated takes effect at the next `load()`. It has no `rotate()` or `prune()`:
 * rotate with the platform's secret tooling, and keep an old key in the ring until no unresolved pause names it.
 *
 * `load()` throws a `HarnessError`, code `invalid_key_store`, when `read()` fails or returns something that is not a
 * usable ring: not JSON, a key that is not base64url or is shorter than 32 bytes, or a `current` the ring lacks. The
 * error's message is fixed text and it has no cause, so it never holds the secret's text, a key id or a key, nor the
 * error `read()` threw. Check the secret itself to find which rule it breaks.
 */
export function secretKeyStore(options: SecretKeyStoreOptions): KeyStore {
  const { read } = options;
  if (typeof read !== "function") throw invalid("secretKeyStore() needs a read function that returns the secret");
  return {
    load: async (): Promise<KeyRing> => {
      let text: unknown;
      try {
        text = await read();
      } catch {
        throw invalid("the key ring secret could not be read");
      }
      if (typeof text !== "string") throw invalid("the key ring secret's reader must return a string");
      try {
        const ring = parseKeyRing(text);
        // The signer checks what the parser leaves out: key lengths, key ids and that `current` is in the ring.
        hmacSigner(ring);
        return ring;
      } catch {
        throw invalid(
          "the key ring secret is not a usable key ring: it must be JSON with a current id and unpadded base64url keys " +
            "of 32 or more bytes, and current must be one of the keys",
        );
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
 * Adds a new current key to `store` and returns its id. Rejects with a `HarnessError`, code `key_store_read_only`, when
 * the store has no `rotate()`, with a message that names the platform tool to rotate with instead. An error the store's
 * `rotate()` throws, even synchronously, becomes a rejection too.
 */
export async function rotateKeys(store: KeyStore, options?: KeyChangeOptions): Promise<string> {
  if (store.rotate === undefined) throw readOnly("rotate keys", options);
  return await store.rotate();
}

/**
 * Calls `store.prune(inUse)` and returns the ids it removed. The store removes the keys not in `inUse` and keeps its
 * current key; this helper adds no check of its own, and `keyStoreConformanceCases()` tests a store for both. Pass
 * every key id that an unresolved pause names, or that pause fails closed. Rejects with a `HarnessError`, code
 * `key_store_read_only`, when the store has no `prune()`, with a message that names the platform tool to remove keys
 * with instead. An error the store's `prune()` throws, even synchronously, becomes a rejection too.
 */
export async function pruneKeys(
  store: KeyStore,
  inUse: ReadonlySet<string>,
  options?: KeyChangeOptions,
): Promise<string[]> {
  if (store.prune === undefined) throw readOnly("prune keys", options);
  return await store.prune(new Set(inUse));
}
