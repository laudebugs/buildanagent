// The signers the SDK re-exports: they are the safety package's own functions and types, the default is ephemeral, a
// rotated ring still verifies older pauses, an unknown key id fails, and no key reaches an event, a result or a span.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as safety from "@buildanagent/agent-safety";
import * as sdk from "@buildanagent/sdk";
import {
  type ApprovalSigner,
  ephemeralSigner,
  hmacSigner,
  type Interceptors,
  type RunResult,
  run,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import { otelObserver, type SpanLike, type TracerLike } from "@buildanagent/sdk/otel";
import { expectTypeOf, test } from "vitest";
import * as vendoredErrors from "../src/vendor/agent-safety/errors.js";
import * as vendoredHash from "../src/vendor/agent-safety/hash.js";
import type * as vendoredPending from "../src/vendor/agent-safety/pending.js";
import { pendingPayload } from "../src/vendor/agent-safety/pending.js";
import * as vendoredSigner from "../src/vendor/agent-safety/signer.js";
import { determinism, drive, scripted, toolCall } from "./run-helpers.js";

const ASK: Interceptors = { beforeToolCall: async () => ({ decision: "ask", reason: "refunds need a manager" }) };
const KEY_A = new Uint8Array(32).fill(0xa1);
const KEY_B = new Uint8Array(32).fill(0xb2);

const refund = sdk.defineTool({
  name: "refund",
  description: "Refund an order.",
  inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
  async execute() {
    throw new Error("a paused call must never run");
  },
});

/** Runs until a gate pauses one refund call, and returns its signed request. */
async function pausedRequest(signer?: ApprovalSigner, order = 1) {
  const { model } = scripted([toolCall("refund", { order })]);
  const options = { model, system: "", input: "Refund it.", tools: [refund], interceptors: ASK, ...determinism() };
  const { events, result } = await drive(run(signer === undefined ? options : { ...options, signer }));
  assert.equal(result.stopReason, "awaiting_approval");
  const [request] = (result as Extract<RunResult, { stopReason: "awaiting_approval" }>).pending;
  return { events, result, request: request as SignedPendingRequest };
}

function verifies(signer: ApprovalSigner, request: SignedPendingRequest): Promise<boolean> {
  return signer.verify(request.keyId, pendingPayload(request), request.signature);
}

test("the SDK's signer, hash and error exports are the vendored safety files' own functions", () => {
  assert.equal(sdk.ephemeralSigner, vendoredSigner.ephemeralSigner);
  assert.equal(sdk.hmacSigner, vendoredSigner.hmacSigner);
  assert.equal(sdk.canonicalInputHash, vendoredHash.canonicalInputHash);
  assert.equal(sdk.SafetyError, vendoredErrors.SafetyError);
  assert.equal(sdk.isSafetyError, vendoredErrors.isSafetyError);
});

test("the SDK's pause types are the safety package's types, unchanged", () => {
  expectTypeOf<sdk.SignedPendingRequest>().toEqualTypeOf<vendoredPending.SignedPendingRequest>();
  expectTypeOf<sdk.SignedPendingRequest>().toEqualTypeOf<safety.SignedPendingRequest>();
  expectTypeOf<sdk.Resolution>().toEqualTypeOf<safety.Resolution>();
  expectTypeOf<sdk.ApprovalSigner>().toEqualTypeOf<safety.ApprovalSigner>();
  expectTypeOf<sdk.HmacSignerOptions>().toEqualTypeOf<safety.HmacSignerOptions>();
  expectTypeOf<sdk.SignPendingOptions>().toEqualTypeOf<safety.SignPendingOptions>();
  expectTypeOf(sdk.hmacSigner).toEqualTypeOf(safety.hmacSigner);
  expectTypeOf(sdk.ephemeralSigner).toEqualTypeOf(safety.ephemeralSigner);
  expectTypeOf(sdk.canonicalInputHash).toEqualTypeOf(safety.canonicalInputHash);
});

test("no SDK source outside the vendored folder defines a signer, an input hash or a pending-record type", () => {
  const src = new URL("../src/", import.meta.url);
  const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".ts") && !file.startsWith("vendor"),
  );
  const names = "hmacSigner|ephemeralSigner|canonicalInputHash|ApprovalSigner|SignedPendingRequest|Resolution";
  const definitions = new RegExp(`((function|class|interface)\\s+(${names})\\b)|((type|const|let)\\s+(${names})\\s*=)`);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(new URL(file, src), "utf8"), definitions, `src/${file} defines its own`);
  }
});

test("the SDK's hash matches the safety package's hash for the same input", async () => {
  const input = { b: [1, "two"], a: { c: null } };
  assert.equal(await sdk.canonicalInputHash(input), await safety.canonicalInputHash(input));
});

test("a run without a signer signs with the process's ephemeral signer, which verifies its own pause", async () => {
  const { request } = await pausedRequest();
  assert.equal(request.keyId, ephemeralSigner().keyId);
  assert.match(request.keyId, /^ephemeral-[0-9a-f]{16}$/);
  assert.equal(await verifies(ephemeralSigner(), request), true);
  // Another process's signer holds another random key, so it rejects the pause as one from an unknown key.
  assert.equal(await verifies(safety.ephemeralSigner(), request), false);
});

test("after rotating from key a to key b, a request signed with a still verifies, and new ones use b", async () => {
  const before = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const { request: signedWithA } = await pausedRequest(before);
  assert.equal(signedWithA.keyId, "a");
  const rotated = hmacSigner({ keys: { a: KEY_A, b: KEY_B }, current: "b" });
  assert.equal(await verifies(rotated, signedWithA), true);
  const { request: signedWithB } = await pausedRequest(rotated, 2);
  assert.equal(signedWithB.keyId, "b");
  assert.equal(await verifies(rotated, signedWithB), true);
  // The safety package's own verifier accepts the SDK's request too.
  const check = await safety.verifyResolution(
    signedWithA,
    { requestId: signedWithA.id, decision: "allow" },
    { signer: rotated, call: { callId: signedWithA.callId, tool: "refund", input: { order: 1 } } },
  );
  assert.deepEqual(check, { ok: true, resolution: { requestId: signedWithA.id, decision: "allow" } });
});

test("a request whose key id the ring lacks fails verification", async () => {
  const { request } = await pausedRequest(hmacSigner({ keys: { a: KEY_A }, current: "a" }));
  const pruned = hmacSigner({ keys: { b: KEY_B }, current: "b" });
  assert.equal(await verifies(pruned, request), false);
  const relabelled = { ...request, keyId: "unknown" };
  assert.equal(await verifies(hmacSigner({ keys: { a: KEY_A }, current: "a" }), relabelled), false);
  const check = await safety.verifyResolution(
    request,
    { requestId: request.id, decision: "allow" },
    { signer: pruned, call: { callId: request.callId, tool: "refund", input: { order: 1 } } },
  );
  assert.deepEqual(check, { ok: false, cause: "signature_invalid" });
});

test("run() refuses a signer that isn't an ApprovalSigner, without echoing it", () => {
  const { model } = scripted([]);
  const secret = { keyId: "k", key: "do-not-print-me" };
  assert.throws(
    () => run({ model, system: "", input: "Go.", signer: secret as never }),
    (error) => sdk.isSdkError(error) && error.code === "invalid_run_options" && !error.message.includes("do-not-print"),
  );
});

/** A tracer that records every attribute any span is given. */
function recordingTracer(): { tracer: TracerLike; attributes: unknown[] } {
  const attributes: unknown[] = [];
  const span = (initial: unknown): SpanLike => {
    attributes.push(initial);
    return {
      setAttribute: (key, value) => {
        attributes.push({ [key]: value });
      },
      setStatus: (status) => {
        attributes.push(status);
      },
      end: () => undefined,
    };
  };
  return { tracer: { startSpan: (_name, options) => span(options?.attributes) }, attributes };
}

test("no key's bytes reach the events, the result or the OTel spans of a paused run", async () => {
  const marker = "key-material-marker-0123456789abcdef";
  const key = new TextEncoder().encode(marker);
  const { tracer, attributes } = recordingTracer();
  const { model } = scripted([toolCall("refund", { order: 1 })]);
  const signer = hmacSigner({ keys: { live: key }, current: "live" });
  const started = run({
    model,
    system: "",
    input: "Refund it.",
    tools: [refund],
    interceptors: ASK,
    signer,
    observers: [otelObserver({ tracer, childContext: () => undefined, captureContent: true })],
    ...determinism(),
  });
  const { events, result } = await drive(started);
  const seen = JSON.stringify({ events, result, attributes, signer });
  const forms = [marker, Buffer.from(key).toString("base64url"), Buffer.from(key).toString("hex")];
  for (const form of forms) assert.equal(seen.includes(form), false, `a key appeared as ${form}`);
  assert.equal(
    JSON.stringify(attributes).includes(
      (result as unknown as { pending: SignedPendingRequest[] }).pending[0]?.signature ?? "-",
    ),
    false,
  );
});
