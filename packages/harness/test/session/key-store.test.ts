// The key stores: secretKeyStore() reads a ring from a secret on every load and has no rotate() or prune(),
// rotateKeys() and pruneKeys() fail with a typed error on such a store, and both stores pass the conformance suite.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { DEFAULT_PLATFORM_HINT, pruneKeys, rotateKeys, secretKeyStore } from "@buildanagent/harness/session";
import { fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { type KeyStoreFactory, keyStoreConformanceCases, runKeyStoreConformance } from "@buildanagent/harness/testing";
import { afterAll, describe, test } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const key = () => randomBytes(32).toString("base64url");
const ring = (current: string, keys: Record<string, string>) => JSON.stringify({ current, keys });

/** True when `error` is an `invalid_key_store` error whose message and cause chain hold none of `secret`. */
function leaksNothing(error: unknown, secret: string): boolean {
  if (!isHarnessError(error) || error.code !== "invalid_key_store") return false;
  let text = "";
  for (let current: unknown = error; current instanceof Error; current = current.cause) text += `${current.message}\n`;
  return !text.includes(secret);
}

describe("secretKeyStore()", () => {
  test("load() reads the secret each time and picks up a ring the platform rotated", async () => {
    const first = key();
    let secret = ring("k1", { k1: first });
    let reads = 0;
    const store = secretKeyStore({
      read: () => {
        reads += 1;
        return secret;
      },
    });
    const before = await store.load();
    assert.equal(before.current, "k1");
    assert.equal(before.keys.k1?.length, 32);
    secret = ring("k2", { k1: first, k2: key() });
    const after = await store.load();
    assert.equal(reads, 2, "each load read the secret");
    assert.equal(after.current, "k2");
    assert.deepEqual(Object.keys(after.keys).sort(), ["k1", "k2"]);
  });

  test("an async reader works", async () => {
    const store = secretKeyStore({ read: async () => ring("k1", { k1: key() }) });
    assert.equal((await store.load()).current, "k1");
  });

  test("the store has no rotate() or prune()", () => {
    const store = secretKeyStore({ read: () => ring("k1", { k1: key() }) });
    assert.equal(store.rotate, undefined);
    assert.equal(store.prune, undefined);
  });

  test("bad JSON, a missing current, bad base64url and a short key are typed errors that leak no secret text", async () => {
    const material = key();
    const bad = [
      `{"current":"k1","keys":{"k1":"${material}"`,
      ring("k9", { k1: material }),
      JSON.stringify({ keys: { k1: material } }),
      ring("k1", { k1: `${material}+/=` }),
      ring("k1", { k1: material.slice(0, 20) }),
    ];
    for (const secret of bad) {
      await assert.rejects(
        () => secretKeyStore({ read: () => secret }).load(),
        (error) => leaksNothing(error, material.slice(0, 20)),
      );
    }
  });

  test("a reader that throws or returns something other than a string is a typed error", async () => {
    await assert.rejects(
      () =>
        secretKeyStore({
          read: () => {
            throw new Error("the secret is missing");
          },
        }).load(),
      (error) => isHarnessError(error) && error.code === "invalid_key_store",
    );
    await assert.rejects(
      () => secretKeyStore({ read: () => undefined as unknown as string }).load(),
      (error) => isHarnessError(error) && error.code === "invalid_key_store",
    );
    assert.throws(
      () => secretKeyStore({} as never),
      (error) => isHarnessError(error) && error.code === "invalid_key_store",
    );
  });
});

describe("rotateKeys() and pruneKeys()", () => {
  const readOnly = secretKeyStore({ read: () => ring("k1", { k1: key() }) });

  test("on a read-only store, each fails with key_store_read_only and names the platform's tooling", async () => {
    await assert.rejects(
      () => rotateKeys(readOnly),
      (error) =>
        isHarnessError(error) && error.code === "key_store_read_only" && error.message.includes(DEFAULT_PLATFORM_HINT),
    );
    await assert.rejects(
      () => pruneKeys(readOnly, new Set()),
      (error) =>
        isHarnessError(error) && error.code === "key_store_read_only" && error.message.includes(DEFAULT_PLATFORM_HINT),
    );
    assert.match(DEFAULT_PLATFORM_HINT, /wrangler secret put/);
  });

  test("a platform hint replaces the default text", async () => {
    await assert.rejects(
      () => rotateKeys(readOnly, { platformHint: "wrangler secret put KEY_RING" }),
      (error) =>
        isHarnessError(error) &&
        error.message.includes("wrangler secret put KEY_RING") &&
        !error.message.includes("vercel env"),
    );
  });

  test("on a store with the methods, each calls through", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-keys-"));
    dirs.push(dir);
    const store = fileKeyStore(join(dir, "keys.json"));
    const first = (await store.load()).current;
    const second = await rotateKeys(store);
    assert.equal((await store.load()).current, second);
    assert.deepEqual(await pruneKeys(store, new Set()), [first]);
  });
});

const fileFactory: KeyStoreFactory = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-keys-"));
  dirs.push(dir);
  return { store: fileKeyStore(join(dir, "state", "keys.json")) };
};
const secretFactory: KeyStoreFactory = () => {
  const secret = ring("2026-11", { "2026-11": key() });
  return { store: secretKeyStore({ read: () => secret }) };
};

const backends: [string, KeyStoreFactory][] = [
  ["the file key store", fileFactory],
  ["the secret key store", secretFactory],
];

for (const [label, factory] of backends) {
  for (const conformance of keyStoreConformanceCases(factory)) {
    test(`${label}: ${conformance.name}`, async (context) => {
      const outcome = await conformance.run();
      if (outcome !== undefined) context.skip(outcome.skipped);
    });
  }
}

test("the file key store passes every case, and the secret key store skips only rotate and prune", async () => {
  const file = await runKeyStoreConformance(fileFactory);
  assert.deepEqual(file.failed, []);
  assert.deepEqual(file.skipped, []);
  const secret = await runKeyStoreConformance(secretFactory);
  assert.deepEqual(secret.failed, []);
  assert.deepEqual(
    secret.skipped.map((skip) => skip.name),
    [
      "rotate adds a new current key and keeps the old one",
      "prune keeps the current key and every key in use, and returns the ids it removed",
    ],
  );
});
