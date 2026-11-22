/**
 * The key store conformance suite: what every `KeyStore` must do. `load()` returns a ring a signer can use, and the
 * same ring each time until something changes it. `rotate()` and `prune()` are optional, because a read-only secret
 * is a valid store (ADR 0035), so their cases skip with a reason when a store leaves them out. The cases import no
 * test runner and no Node module, so any runner can call them, in workerd too. No message names a key's bytes.
 */
import { hmacSigner, type KeyRing, type KeyStore } from "@buildanagent/agent-safety";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/** What a factory returns: the store under test. */
export interface KeyStoreUnderTest {
  readonly store: KeyStore;
}

/** Makes a fresh store for each case. */
export type KeyStoreFactory = () => KeyStoreUnderTest | Promise<KeyStoreUnderTest>;

/** One key store case. */
export type KeyStoreCase = RunnableCase;

/** What `runKeyStoreConformance()` reports. */
export type KeyStoreConformanceReport = CaseReport;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`KeyStore conformance: ${message}`);
}

const PAYLOAD = new TextEncoder().encode("key store conformance payload");

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((byte, index) => byte === b[index]);
}

function sameRing(a: KeyRing, b: KeyRing): boolean {
  const ids = Object.keys(a.keys).sort();
  const other = Object.keys(b.keys).sort();
  return (
    a.current === b.current &&
    ids.length === other.length &&
    ids.every((id, index) => id === other[index] && sameBytes(a.keys[id], b.keys[id]))
  );
}

type Outcome = { readonly skipped: string } | undefined;

async function loadsUsableRing(store: KeyStore): Promise<Outcome> {
  const ring = await store.load();
  check(typeof ring.current === "string", "the ring has no current key id");
  check(ring.keys[ring.current] instanceof Uint8Array, "the current key id is not in the ring's keys");
  return undefined;
}

async function loadsSameRing(store: KeyStore): Promise<Outcome> {
  check(sameRing(await store.load(), await store.load()), "two loads returned different rings");
  return undefined;
}

async function signsAndVerifies(store: KeyStore): Promise<Outcome> {
  const signer = hmacSigner(await store.load());
  const signature = await signer.sign(PAYLOAD);
  check(await signer.verify(signer.keyId, PAYLOAD, signature), "a signature from the ring did not verify");
  const reloaded = hmacSigner(await store.load());
  check(await reloaded.verify(signer.keyId, PAYLOAD, signature), "a reloaded ring did not verify the signature");
  check(
    !(await reloaded.verify(signer.keyId, new TextEncoder().encode("another payload"), signature)),
    "a signature verified for another payload",
  );
  return undefined;
}

async function rotates(store: KeyStore): Promise<Outcome> {
  if (store.rotate === undefined) return { skipped: "the store is read-only: it has no rotate()" };
  const before = await store.load();
  const signature = await hmacSigner(before).sign(PAYLOAD);
  const id = await store.rotate();
  check(id !== before.current, "rotate returned the id of the key that was already current");
  const after = await store.load();
  check(after.current === id, "the rotated key is not current");
  check(sameBytes(after.keys[before.current], before.keys[before.current]), "the old key left the ring");
  check(
    await hmacSigner(after).verify(before.current, PAYLOAD, signature),
    "a signature under the old key did not verify after the rotation",
  );
  return undefined;
}

async function prunes(store: KeyStore): Promise<Outcome> {
  if (store.prune === undefined) return { skipped: "the store is read-only: it has no prune()" };
  // With rotate() the ring holds three keys: one in use, one free to remove, and the current one.
  const inUse = new Set<string>();
  if (store.rotate !== undefined) {
    inUse.add((await store.load()).current);
    await store.rotate();
    await store.rotate();
  }
  const before = await store.load();
  const removed = await store.prune(inUse);
  const after = await store.load();
  check(after.current === before.current, "prune changed the current key");
  check(after.keys[after.current] instanceof Uint8Array, "prune removed the current key");
  check(
    [...inUse].every((id) => sameBytes(after.keys[id], before.keys[id])),
    "prune removed a key that a pause still names",
  );
  const gone = Object.keys(before.keys)
    .filter((id) => !(id in after.keys))
    .sort();
  check(
    removed.length === gone.length && [...removed].sort().every((id, index) => id === gone[index]),
    "prune's returned ids are not the ids it removed",
  );
  if (store.rotate !== undefined) check(gone.length === 1, "prune did not remove the one key nothing names");
  return undefined;
}

const CASES: readonly (readonly [string, (store: KeyStore) => Promise<Outcome>])[] = [
  ["load returns a ring whose current key is in its keys", loadsUsableRing],
  ["load twice returns the same ring", loadsSameRing],
  ["the loaded ring signs and verifies through hmacSigner", signsAndVerifies],
  ["rotate adds a new current key and keeps the old one", rotates],
  ["prune keeps the current key and every key in use, and returns the ids it removed", prunes],
];

/** The cases, each run against a store from `factory`. */
export function keyStoreConformanceCases(factory: KeyStoreFactory): readonly KeyStoreCase[] {
  return CASES.map(([name, body]) => ({ name, run: async () => body((await factory()).store) }));
}

/** Runs every case and reports which passed, which skipped and which failed. */
export function runKeyStoreConformance(factory: KeyStoreFactory): Promise<KeyStoreConformanceReport> {
  return runCases(keyStoreConformanceCases(factory));
}
