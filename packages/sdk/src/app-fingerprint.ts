/**
 * The fingerprint of a run's app data: `canonicalInputHash()` of `app`, which a signed pending request binds so that
 * an approved call runs only for the caller whose app data the host passes back. Two values are the same app when
 * their RFC 8785 canonical JSON is the same: key order and whitespace don't matter, and a number and its other
 * spellings (1 and 1.0) match. The app itself is never stored, logged or put in an error; only this hash is.
 */
import { canonicalInputHash } from "./vendor/agent-safety/hash.js";

/** Hashes `app` the first time it is asked, and answers the same promise after that. `undefined` has no fingerprint. */
export function fingerprintOf(app: unknown): () => Promise<string | undefined> {
  if (app === undefined) return () => Promise.resolve(undefined);
  let hash: Promise<string> | undefined;
  return () => {
    hash ??= canonicalInputHash(app);
    return hash;
  };
}
