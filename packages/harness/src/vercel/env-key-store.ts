/**
 * `envKeyStore()`: a read-only `KeyStore` over a secret environment variable, such as a Vercel environment variable of
 * the sensitive type. It is `secretKeyStore()` with a reader that looks the variable up at each `load()`. This file
 * imports no Node module: it reads `process.env` through `globalThis` when no `env` is given.
 */
import type { KeyStore } from "@buildanagent/agent-safety";
import { HarnessError } from "../errors.js";
import { secretKeyStore } from "../session/secret-key-store.js";

/** The variable `envKeyStore()` reads when no name is given. */
export const DEFAULT_KEY_RING_VARIABLE = "HARNESS_KEY_RING";

/** The options of `envKeyStore()`. */
export interface EnvKeyStoreOptions {
  /** The variable that holds the ring's JSON. Default `HARNESS_KEY_RING`. Upper-case letters, digits and `_` only. */
  readonly name?: string;
  /** Where to read it. Default `process.env`, read at each `load()`. A test passes its own. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function processEnv(): Readonly<Record<string, string | undefined>> {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}

/**
 * A `KeyStore` whose `load()` reads the ring from one environment variable and parses it as `secretKeyStore()` does:
 * JSON such as `{"current":"2026-11","keys":{"2026-11":"<base64url key>"}}`. It has no `rotate()` or `prune()`, so
 * `rotateKeys()` refuses with `key_store_read_only`: change the variable with `vercel env` and redeploy, keeping an old
 * key in the ring until no unresolved pause names it. A function reads the value its deployment was built with, so a
 * changed ring takes effect at the next deployment.
 *
 * `load()` throws a `HarnessError`, code `invalid_key_store`, when the variable is missing or empty, naming the variable,
 * and when its value is not a usable ring, with fixed text. No error, `inspect()` output or JSON of the store holds the
 * variable's value: the store keeps no copy and reads it only inside `load()`.
 */
export function envKeyStore(options: EnvKeyStoreOptions = {}): KeyStore {
  const name = options.name ?? DEFAULT_KEY_RING_VARIABLE;
  if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new HarnessError(
      "invalid_key_store",
      "envKeyStore() needs a variable name of upper-case letters, digits and underscores",
    );
  }
  const source = options.env;
  const inner = secretKeyStore({ read: () => (source ?? processEnv())[name] ?? "" });
  return Object.freeze({
    async load() {
      const value = (source ?? processEnv())[name];
      if (value === undefined || value.trim() === "") {
        throw new HarnessError("invalid_key_store", `the environment variable ${name} is not set`);
      }
      return inner.load();
    },
  });
}
