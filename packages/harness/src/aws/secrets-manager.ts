/**
 * `@buildanagent/harness/aws/secrets-manager`: a read-only `KeyStore` over an AWS Secrets Manager secret. It reads the
 * approval key ring with `GetSecretValue` on every `load()` and never writes, because the owner rotates the secret with
 * Secrets Manager's own tooling.
 *
 * @module @buildanagent/harness/aws/secrets-manager
 */
import { GetSecretValueCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { KeyRing, KeyStore } from "@buildanagent/agent-safety";
import { HarnessError, isHarnessError } from "../errors.js";
import { secretKeyStore } from "../session/secret-key-store.js";
import { checkClient, errorName } from "./sdk.js";

/** The options of `secretsManagerKeyStore()`. */
export interface SecretsManagerKeyStoreOptions {
  /** The secret's name or ARN. Use the full ARN for a secret in another account. */
  readonly secretId: string;
  /**
   * The staging label of the version to read. Default `AWSCURRENT`, the version Secrets Manager moves to whenever a
   * new value is put, so a rotated ring takes effect at the next `load()`.
   */
  readonly versionStage?: string;
}

// An SDK error's name is one of the service's error shapes, such as AccessDeniedException. Only a name of this form is
// repeated, so a name can never carry text from the request or the response.
const SAFE_ERROR_NAME = /^[A-Za-z]{1,64}$/;

/**
 * A `KeyStore` with `load()` only, over the Secrets Manager secret `secretId`. The secret's string value is the JSON
 * ring that `secretKeyStore()` reads, such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}`, with each key 32 or
 * more random bytes in unpadded base64url. `load()` reads the version labelled `versionStage` (default `AWSCURRENT`)
 * every time and keeps no copy, so a value put with `aws secretsmanager put-secret-value` takes effect at the next
 * load. Keep an old key in the new value until no waiting approval names it.
 *
 * `load()` throws a `HarnessError`, code `invalid_key_store`, when the read fails, when the secret holds no string, and
 * when the string is not a usable ring. The message is fixed text plus, for a failed read, the AWS error's name, such
 * as `AccessDeniedException` or `ResourceNotFoundException`. The error has no cause, so it never holds the secret's
 * value, a key, a key id or the SDK's own error, whose message can repeat request parameters. `rotate()` and `prune()`
 * are absent, so `rotateKeys()` and `pruneKeys()` reject with `key_store_read_only`.
 */
export function secretsManagerKeyStore(client: SecretsManagerClient, options: SecretsManagerKeyStoreOptions): KeyStore {
  checkClient("secretsManagerKeyStore()", client);
  const secretId = options?.secretId;
  const versionStage = options?.versionStage ?? "AWSCURRENT";
  if (typeof secretId !== "string" || secretId === "" || secretId.length > 2048) {
    throw new HarnessError(
      "invalid_aws_options",
      "secretsManagerKeyStore() needs a secretId, the secret's name or ARN",
    );
  }
  if (typeof versionStage !== "string" || !/^[\w.-]{1,256}$/.test(versionStage)) {
    throw new HarnessError("invalid_aws_options", "secretsManagerKeyStore() needs a versionStage such as AWSCURRENT");
  }
  const read = async (failed: { reason?: string }): Promise<string> => {
    let out: { readonly SecretString?: string | undefined };
    try {
      out = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: versionStage }));
    } catch (error) {
      const name = errorName(error);
      failed.reason = name !== undefined && SAFE_ERROR_NAME.test(name) ? name : "an error with no usable name";
      throw new Error("read failed");
    }
    if (typeof out.SecretString !== "string") {
      failed.reason = "the secret has no string value";
      throw new Error("no string value");
    }
    return out.SecretString;
  };
  return {
    load: async (): Promise<KeyRing> => {
      // Each load has its own record of why its read failed, so two loads at once never mix their reasons.
      const failed: { reason?: string } = {};
      try {
        return await secretKeyStore({ read: () => read(failed) }).load();
      } catch (error) {
        if (failed.reason === undefined || !isHarnessError(error)) throw error;
        throw new HarnessError(
          "invalid_key_store",
          `the key ring secret could not be read from Secrets Manager (${failed.reason}); check the secret's name, its value and the role's secretsmanager:GetSecretValue permission`,
        );
      }
    },
  };
}
