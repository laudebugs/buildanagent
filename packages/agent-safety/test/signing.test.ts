import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import {
  type ApprovalSigner,
  canonicalInputHash,
  ephemeralSigner,
  hmacSigner,
  isSafetyError,
  memoryPendingStore,
  type PendingCall,
  parseKeyRing,
  pendingPayload,
  type Resolution,
  type SignedPendingRequest,
  signerFromKeyStore,
  signPending,
  verifyResolution,
} from "@buildanagent/agent-safety";
import { TEST_KEY_ID, testSigner } from "@buildanagent/agent-safety/testing";
import { test } from "vitest";
import { constantTimeEqual, fromBase64Url, toBase64Url } from "../src/bytes.js";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const KEY_A = new Uint8Array(32).fill(0xa1);
const KEY_B = new Uint8Array(32).fill(0xb2);
const PAYLOAD = ENCODER.encode("refund 4417");
const CALL = { callId: "call_1", tool: "refund", input: { order: 4417, amount: 250 } };
const FIXED = { generateId: () => "req_1", now: () => new Date("2026-11-19T12:00:00.000Z") };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

async function pending(signer: ApprovalSigner, extra: { policyVersion?: string } = {}) {
  return signPending({ kind: "approval", ...CALL, ...extra }, signer, FIXED);
}

function allow(request: SignedPendingRequest): Resolution {
  return { requestId: request.id, decision: "allow" };
}

function assertSafetyError(code: string, mustNotContain: readonly string[] = []) {
  return (error: unknown) => {
    assert.ok(isSafetyError(error), `expected a SafetyError, got ${String(error)}`);
    assert.equal(error.code, code);
    for (const secret of mustNotContain) assert.ok(!error.message.includes(secret), "the message leaks key material");
    return true;
  };
}

test("an hmac signer verifies its own signature and nothing else", async () => {
  const signer = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const signature = await signer.sign(PAYLOAD);
  assert.equal(signer.keyId, "a");
  assert.equal(await signer.verify("a", PAYLOAD, signature), true);
  assert.equal(await signer.verify("a", ENCODER.encode("refund 4418"), signature), false);
  assert.equal(await signer.verify("b", PAYLOAD, signature), false, "an unknown key id fails");
  const flipped = `${signature.slice(0, 5)}${signature[5] === "A" ? "B" : "A"}${signature.slice(6)}`;
  assert.equal(await signer.verify("a", PAYLOAD, flipped), false, "a tampered signature fails");
});

test("a malformed signature, key id or payload resolves to false instead of throwing", async () => {
  const signer = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const signature = await signer.sign(PAYLOAD);
  for (const bad of [
    "",
    `${signature}=`,
    `${signature}A`,
    signature.slice(1),
    signature.replace(/.$/, "!"),
    "a".repeat(43),
  ]) {
    assert.equal(await signer.verify("a", PAYLOAD, bad), false, JSON.stringify(bad));
  }
  // 32 bytes take 43 characters, whose last 2 bits are unused; setting one spells the same MAC a second way.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1) ?? "");
  const nonCanonical = `${signature.slice(0, -1)}${alphabet[last ^ 1]}`;
  assert.equal(await signer.verify("a", PAYLOAD, nonCanonical), false);
  const loose = signer as unknown as { verify(...args: unknown[]): Promise<boolean> };
  assert.equal(await loose.verify(7, PAYLOAD, signature), false);
  assert.equal(await loose.verify("a", "refund 4417", signature), false);
  assert.equal(await loose.verify("a", PAYLOAD, null), false);
  assert.equal(await loose.verify("__proto__", PAYLOAD, signature), false);
});

test("rotating from key a to key b still verifies a's signature while a stays in the ring", async () => {
  const before = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const request = await pending(before);
  const rotated = hmacSigner({ keys: { a: KEY_A, b: KEY_B }, current: "b" });
  assert.equal(rotated.keyId, "b");
  assert.deepEqual(await verifyResolution(request, allow(request), { signer: rotated, call: CALL }), {
    ok: true,
    resolution: allow(request),
  });
  const fresh = await pending(rotated);
  assert.equal(fresh.keyId, "b");
  assert.equal((await verifyResolution(fresh, allow(fresh), { signer: before, call: CALL })).ok, false);
  const pruned = hmacSigner({ keys: { b: KEY_B }, current: "b" });
  assert.deepEqual(await verifyResolution(request, allow(request), { signer: pruned, call: CALL }), {
    ok: false,
    cause: "signature_invalid",
  });
});

test("hmacSigner refuses a ring it can't sign with, and its errors name key ids only", () => {
  const secret = Buffer.from(KEY_A.subarray(0, 16)).toString("base64");
  const cases: unknown[] = [
    { keys: {}, current: "a" },
    { keys: { a: KEY_A.subarray(0, 16) }, current: "a" },
    { keys: { a: "a".repeat(40) }, current: "a" },
    { keys: { "bad id": KEY_A }, current: "bad id" },
    { keys: { a: KEY_A }, current: "b" },
    { keys: { a: KEY_A }, current: "" },
    { keys: null, current: "a" },
  ];
  for (const options of cases) {
    assert.throws(
      () => hmacSigner(options as Parameters<typeof hmacSigner>[0]),
      assertSafetyError("invalid_key_ring", [secret, hex(KEY_A)]),
    );
  }
});

test("a signer copies its keys, so changing the caller's array changes nothing", async () => {
  const key = new Uint8Array(KEY_A);
  const signer = hmacSigner({ keys: { a: key }, current: "a" });
  const signature = await signer.sign(PAYLOAD);
  key.fill(0);
  assert.equal(await signer.verify("a", PAYLOAD, signature), true);
  assert.equal(await hmacSigner({ keys: { a: KEY_A }, current: "a" }).sign(PAYLOAD), signature);
});

test("no signer exposes its key through JSON, inspection or its own properties", async () => {
  const signer = hmacSigner({ keys: { a: KEY_A, b: KEY_B }, current: "a" });
  await signer.sign(PAYLOAD);
  const shown = [JSON.stringify(signer), inspect(signer, { showHidden: true, depth: 20 }), Object.keys(signer).join()];
  for (const text of shown) {
    for (const key of [KEY_A, KEY_B]) {
      assert.ok(!text.includes(hex(key)), "hex key material is visible");
      assert.ok(!text.includes(Buffer.from(key).toString("base64").slice(0, 20)), "base64 key material is visible");
      assert.ok(!text.includes(key.join(",")), "key bytes are visible");
    }
  }
  assert.deepEqual(Object.keys(signer).sort(), ["keyId", "sign", "verify"]);
  assert.ok(Object.isFrozen(signer));
});

test("ephemeralSigner returns one signer per process that verifies its own signatures", async () => {
  const signer = ephemeralSigner();
  assert.equal(ephemeralSigner(), signer);
  assert.match(signer.keyId, /^ephemeral-[0-9a-f]{16}$/);
  const request = await pending(signer);
  assert.equal((await verifyResolution(request, allow(request), { signer: ephemeralSigner(), call: CALL })).ok, true);
  assert.equal((await verifyResolution(request, allow(request), { signer: testSigner(), call: CALL })).ok, false);
});

test("the signed payload is a tagged JSON array of D5's six fields, byte for byte as the fixture records", async () => {
  // The fixture pins the payload layout, so a signature made here and one made by another package over the same
  // fields are byte-identical, and a change to the layout fails this test before it strands stored pauses.
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/signed-pending.json", import.meta.url), "utf8")) as {
    input: unknown;
    request: SignedPendingRequest;
    payload: string;
    withoutPolicyVersion: { request: SignedPendingRequest; payload: string };
  };
  const request = await signPending(
    { kind: "approval", ...CALL, input: fixture.input, policyVersion: "policy-7" },
    testSigner(),
    FIXED,
  );
  assert.deepEqual(request, fixture.request);
  assert.equal(DECODER.decode(pendingPayload(request)), fixture.payload);
  assert.equal(request.inputHash, await canonicalInputHash(fixture.input));
  assert.equal(request.keyId, TEST_KEY_ID);
  // An HMAC-SHA-256 from Node's own crypto agrees, so the signature is plain HMAC over the payload bytes.
  const independent = createHmac("sha256", "buildanagent testSigner fixed key, never for production")
    .update(fixture.payload)
    .digest("base64url");
  assert.equal(request.signature, independent);
  const bare = await signPending({ kind: "approval", ...CALL, input: fixture.input }, testSigner(), FIXED);
  assert.deepEqual(bare, fixture.withoutPolicyVersion.request);
  assert.equal(DECODER.decode(pendingPayload(bare)), fixture.withoutPolicyVersion.payload);
});

test("signPending stores the hash, not the input, and keeps question and reason unsigned", async () => {
  const request = await signPending(
    { kind: "clarification", ...CALL, question: "Which card?", reason: "Over $100" },
    testSigner(),
    FIXED,
  );
  assert.deepEqual(Object.keys(request).sort(), [
    "callId",
    "createdAt",
    "id",
    "inputHash",
    "keyId",
    "kind",
    "question",
    "reason",
    "signature",
    "tool",
  ]);
  assert.equal(request.createdAt, "2026-11-19T12:00:00.000Z");
  assert.ok(!JSON.stringify(request).includes("4417"), "the input itself is not stored");
  const answer: Resolution = { requestId: "req_1", answer: "The Visa" };
  const reworded = { ...request, question: "Something else?", reason: "Changed" };
  assert.equal((await verifyResolution(reworded, answer, { signer: testSigner(), call: CALL })).ok, true);
});

test("signPending refuses blank or malformed fields", async () => {
  const signer = testSigner();
  const cases = [
    { kind: "approval", ...CALL, callId: "" },
    { kind: "approval", ...CALL, tool: "\ud800" },
    { kind: "maybe", ...CALL },
    { kind: "approval", ...CALL, policyVersion: "" },
    { kind: "approval", ...CALL, reason: "" },
  ];
  for (const fields of cases) {
    await assert.rejects(
      signPending(fields as Parameters<typeof signPending>[0], signer, FIXED),
      assertSafetyError("invalid_pending"),
    );
  }
  await assert.rejects(
    signPending({ kind: "approval", ...CALL }, signer, { generateId: () => "" }),
    assertSafetyError("invalid_pending"),
  );
  await assert.rejects(
    signPending({ kind: "approval", ...CALL, input: { at: new Date(0) } }, signer, FIXED),
    assertSafetyError("invalid_input"),
  );
});

test("verifyResolution names the first check that fails, and every tampered field fails", async () => {
  const signer = testSigner();
  const request = await pending(signer, { policyVersion: "v1" });
  const verify = (p: unknown, r: Resolution = allow(request), call: PendingCall = CALL) =>
    verifyResolution(p, r, { signer, call });
  const causes = await Promise.all([
    verify({ ...request, signature: 42 }),
    verify({ ...request, inputHash: "not-a-hash" }),
    verify(null),
    verify(request, { requestId: "req_other", decision: "allow" }),
    verify({ ...request, signature: request.signature.replace(/^./, (c) => (c === "A" ? "B" : "A")) }),
    verify({ ...request, keyId: "unknown" }),
    verify({ ...request, policyVersion: "v2" }),
    verify({ ...request, policyVersion: undefined }),
    verify({ ...request, tool: "delete_account" }),
    verify({ ...request, kind: "clarification" }),
    verify(request, allow(request), { ...CALL, callId: "call_2" }),
    verify(request, allow(request), { ...CALL, tool: "refund_all" }),
    verify(request, allow(request), { ...CALL, input: { order: 4417, amount: 2500 } }),
    verify(request, allow(request), { ...CALL, input: { order: 4417, amount: 250, at: new Date(0) } }),
    verify(request, { requestId: request.id, answer: "yes" }),
  ]);
  assert.deepEqual(
    causes.map((check) => (check.ok ? "ok" : check.cause)),
    [
      "malformed",
      "malformed",
      "malformed",
      "unknown_request",
      "signature_invalid",
      "signature_invalid",
      "signature_invalid",
      "signature_invalid",
      "signature_invalid",
      "signature_invalid",
      "call_mismatch",
      "call_mismatch",
      "input_changed",
      "input_changed",
      "resolution_mismatch",
    ],
  );
  const reordered = { ...CALL, input: { amount: 250, order: 4417 } };
  assert.equal((await verify(request, allow(request), reordered)).ok, true, "key order doesn't change the input hash");
});

test("parseKeyRing reads a secret's JSON, and its errors never quote key material", async () => {
  const encoded = toBase64Url(KEY_A);
  const ring = parseKeyRing(JSON.stringify({ current: "a", keys: { a: encoded, b: toBase64Url(KEY_B) } }));
  assert.equal(ring.current, "a");
  assert.deepEqual([...(ring.keys.a ?? [])], [...KEY_A]);
  const signer = await signerFromKeyStore({ load: async () => ring });
  assert.equal(await signer.sign(PAYLOAD), await hmacSigner({ keys: { a: KEY_A }, current: "a" }).sign(PAYLOAD));
  const cases = [
    `{"current":"a","keys":{"a":"${encoded}"`,
    `["${encoded}"]`,
    `{"current":1,"keys":{}}`,
    `{"current":"a","keys":["${encoded}"]}`,
    `{"current":"a","keys":{"a":"${encoded}="}}`,
    `{"current":"a","keys":{"a":"${encoded.replace(/./, "+")}"}}`,
  ];
  for (const text of cases)
    assert.throws(() => parseKeyRing(text), assertSafetyError("invalid_key_ring", [encoded.slice(0, 12)]));
});

test("base64url round-trips every length and refuses non-canonical text", () => {
  for (let length = 0; length < 40; length++) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length) & 0xff);
    const text = toBase64Url(bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64url"));
    assert.deepEqual(fromBase64Url(text), bytes);
  }
  for (const bad of ["A", "AB=", "A+", "A/", "AB==", "AF", "AAB"]) assert.equal(fromBase64Url(bad), undefined, bad);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test("the memory store keeps copies and hands each request out once", async () => {
  const store = memoryPendingStore();
  const request = await pending(testSigner());
  await store.put(request);
  request.tool = "changed outside the store";
  const taken = await store.take("call_1");
  assert.equal(taken?.tool, "refund");
  assert.equal(await store.take("call_1"), undefined);
});

test("the memory store drops a request once it is older than maxAgeMs, so an approval after that finds nothing", async () => {
  let time = 0;
  const store = memoryPendingStore({ maxAgeMs: 1000, now: () => time });
  const first = await pending(testSigner());
  await store.put(first);
  await store.put({ ...first, callId: "call_2" });
  time = 999;
  assert.equal((await store.take("call_2"))?.callId, "call_2", "a young request is still there");
  time = 1000;
  assert.equal(await store.take("call_1"), undefined, "an expired request is gone");
  await store.put(first);
  time = 1500;
  await store.put({ ...first, callId: "call_3" });
  assert.equal((await store.take("call_1"))?.id, first.id, "a request put again ages from its new put");
});

test("a signer signs a view's own bytes, so different DataViews never share a MAC", async () => {
  const signer = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const loose = signer as unknown as { sign(payload: unknown): Promise<string> };
  const a = await loose.sign(new DataView(Uint8Array.of(1, 2, 3).buffer));
  assert.notEqual(a, await loose.sign(new DataView(Uint8Array.of(4, 5, 6).buffer)));
  assert.equal(a, await signer.sign(Uint8Array.of(1, 2, 3)));
  const wide = Uint16Array.of(0x0102, 0x0304);
  assert.equal(await loose.sign(wide), await signer.sign(new Uint8Array(wide.buffer)));
});

test("the root entry doesn't export the fixed-key test signer; only ./testing does", async () => {
  const root: Record<string, unknown> = await import("@buildanagent/agent-safety");
  assert.equal("testSigner" in root, false);
  assert.equal("TEST_KEY_ID" in root, false);
});
