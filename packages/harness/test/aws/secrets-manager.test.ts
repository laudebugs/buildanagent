// What the Secrets Manager key store reads, how a rotation reaches it, and that no error it throws holds the secret.
import assert from "node:assert/strict";
import { hmacSigner } from "@buildanagent/agent-safety";
import { secretsManagerKeyStore } from "@buildanagent/harness/aws/secrets-manager";
import { pruneKeys, rotateKeys } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { ringText, SECRET_ID } from "./aws-target.js";
import { fakeSecretsManager } from "./fake-secrets-manager.js";

const PAYLOAD = new TextEncoder().encode("a paused approval");

/** Asserts that `error` is the store's fixed `invalid_key_store` error and holds none of `forbidden`. */
function clean(forbidden: readonly string[]) {
  return (error: unknown) => {
    const { code, message, cause } = error as { code?: string; message: string; cause?: unknown };
    assert.equal(code, "invalid_key_store");
    assert.equal(cause, undefined, "the error carries no cause");
    for (const text of forbidden) assert.ok(!message.includes(text), `the message holds ${JSON.stringify(text)}`);
    return true;
  };
}

describe("secretsManagerKeyStore", () => {
  test("reads AWSCURRENT on every load, so a value put with put-secret-value takes effect at the next load", async () => {
    const secrets = fakeSecretsManager();
    secrets.put(SECRET_ID, { SecretString: ringText("2026-11") });
    const store = secretsManagerKeyStore(secrets.client, { secretId: SECRET_ID });
    const before = await store.load();
    const signature = await hmacSigner(before).sign(PAYLOAD);
    const old = JSON.parse(ringText("2026-11")) as { keys: Record<string, string> };
    old.keys["2026-11"] = Buffer.from(before.keys["2026-11"] as Uint8Array).toString("base64url");
    const rotated = JSON.parse(ringText("2026-12")) as { current: string; keys: Record<string, string> };
    secrets.put(SECRET_ID, {
      SecretString: JSON.stringify({ current: "2026-12", keys: { ...old.keys, ...rotated.keys } }),
    });
    const after = await store.load();
    assert.equal(after.current, "2026-12");
    assert.ok(await hmacSigner(after).verify("2026-11", PAYLOAD, signature), "the old key still verifies its pauses");
    assert.deepEqual(
      secrets.sent.map((s) => s.input),
      [
        { SecretId: SECRET_ID, VersionStage: "AWSCURRENT" },
        { SecretId: SECRET_ID, VersionStage: "AWSCURRENT" },
      ],
    );
    const previous = await secretsManagerKeyStore(secrets.client, {
      secretId: SECRET_ID,
      versionStage: "AWSPREVIOUS",
    }).load();
    assert.equal(previous.current, "2026-11");
  });

  test("a failed read names the AWS error and nothing the SDK's message said", async () => {
    const secrets = fakeSecretsManager();
    const store = secretsManagerKeyStore(secrets.client, { secretId: SECRET_ID });
    secrets.failNext(secrets.serviceError("AccessDeniedException", `not allowed on ${SECRET_ID}: value=hunter2-key`));
    await assert.rejects(() => store.load(), clean(["hunter2-key", "not allowed"]));
    secrets.failNext(secrets.serviceError("AccessDeniedException", "x"));
    await assert.rejects(() => store.load(), /\(AccessDeniedException\)/);
    secrets.failNext(secrets.serviceError("Weird name: hunter2-key", "x"));
    await assert.rejects(() => store.load(), clean(["hunter2-key"]));
    await assert.rejects(() => store.load(), /\(ResourceNotFoundException\)/, "a secret that doesn't exist");
  });

  test("a secret that holds binary, or a string that is no ring, is refused without quoting it", async () => {
    const secrets = fakeSecretsManager();
    const store = secretsManagerKeyStore(secrets.client, { secretId: SECRET_ID });
    secrets.put(SECRET_ID, { SecretBinary: new TextEncoder().encode(ringText()) });
    await assert.rejects(() => store.load(), /has no string value/);
    const leaked = "c2VjcmV0LWtleS10aGF0LWlzLXRvby1zaG9ydA";
    secrets.put(SECRET_ID, { SecretString: JSON.stringify({ current: "k", keys: { k: leaked } }) });
    await assert.rejects(() => store.load(), clean([leaked, '"k"']));
    secrets.put(SECRET_ID, { SecretString: `{"current": "${leaked}"` });
    await assert.rejects(() => store.load(), clean([leaked]));
  });

  test("is read-only: rotateKeys and pruneKeys point to Secrets Manager's tooling", async () => {
    const secrets = fakeSecretsManager();
    const store = secretsManagerKeyStore(secrets.client, { secretId: SECRET_ID });
    const hint = { platformHint: "aws secretsmanager put-secret-value" };
    await assert.rejects(() => rotateKeys(store, hint), { code: "key_store_read_only", message: /put-secret-value/ });
    await assert.rejects(() => pruneKeys(store, new Set(), hint), { code: "key_store_read_only" });
    assert.equal(secrets.sent.length, 0);
  });

  test("refuses a missing client, an empty secret id and a version stage that is not a label", () => {
    const { client } = fakeSecretsManager();
    const code = { code: "invalid_aws_options" };
    assert.throws(() => secretsManagerKeyStore(undefined as never, { secretId: SECRET_ID }), code);
    assert.throws(() => secretsManagerKeyStore(client, { secretId: "" }), code);
    assert.throws(() => secretsManagerKeyStore(client, { secretId: SECRET_ID, versionStage: "a b" }), code);
  });
});
