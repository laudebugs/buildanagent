/**
 * `workerKeyStore()`: the approval key ring from a Worker secret or a Secrets Store binding, as a read-only `KeyStore`
 * over `secretKeyStore()`. The owner rotates the ring with Wrangler, and the next `load()` reads the new one.
 */
import type { KeyStore } from "@buildanagent/agent-safety";
import { HarnessError } from "../errors.js";
import { secretKeyStore } from "../session/secret-key-store.js";

/** A Secrets Store binding as a Worker sees it: `get()` resolves with the secret's text. */
export interface SecretsStoreSecretLike {
  get(): Promise<string>;
}

/** Where a read-only Cloudflare key store's errors send the owner to rotate or prune keys. */
export const CLOUDFLARE_PLATFORM_HINT =
  "wrangler secret put, or wrangler secrets-store secret update for a Secrets Store binding";

/**
 * A read-only `KeyStore` over the key ring JSON in a Worker secret, such as `env.APPROVAL_KEYS`, or in a Secrets Store
 * binding, whose `get()` it calls on every `load()`. It has no `rotate()` or `prune()`; pass
 * `CLOUDFLARE_PLATFORM_HINT` to `rotateKeys()` and `pruneKeys()` so their error names the Wrangler commands.
 *
 * The store keeps the secret only inside the function that reads it, so the store object holds no key text a log or
 * `JSON.stringify()` could print, and every error it throws is fixed text with no cause. A secret that is missing,
 * empty or neither a string nor a binding throws a `HarnessError`, code `invalid_key_store`, when the store is made;
 * a secret that is not a usable ring throws the same code from `load()`.
 */
export function workerKeyStore(secret: string | SecretsStoreSecretLike | undefined): KeyStore {
  if (typeof secret === "string") {
    if (secret === "")
      throw new HarnessError("invalid_key_store", "the Worker secret that holds the key ring is empty");
    return secretKeyStore({ read: () => secret });
  }
  if (typeof secret === "object" && secret !== null && typeof secret.get === "function") {
    return secretKeyStore({ read: () => secret.get() });
  }
  throw new HarnessError(
    "invalid_key_store",
    "workerKeyStore() needs the key ring's Worker secret, a string, or its Secrets Store binding",
  );
}
