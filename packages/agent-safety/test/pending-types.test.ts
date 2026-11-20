import assert from "node:assert/strict";
import type {
  ApprovalSigner,
  ephemeralSigner,
  hmacSigner,
  Recheck,
  Resolution,
  SignedPendingRequest,
} from "@buildanagent/agent-safety";
import { test } from "vitest";

// The shapes exactly as build-sdk.md §3.3 writes them, which our SDK re-exports. Each `Equal` below fails
// `pnpm typecheck` if a field is added, dropped, renamed, made optional or retyped on either side.
interface SpecSignedPendingRequest {
  id: string;
  kind: "approval" | "clarification";
  callId: string;
  tool: string;
  inputHash: string;
  policyVersion?: string;
  question?: string;
  reason?: string;
  keyId: string;
  signature: string;
  createdAt: string;
}
type SpecResolution =
  | { requestId: string; decision: "allow" | "deny"; reason?: string; by?: string }
  | { requestId: string; answer: string; by?: string };
interface SpecApprovalSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<string>;
  verify(keyId: string, payload: Uint8Array, signature: string): Promise<boolean>;
}
type SpecRecheck = (p: SpecSignedPendingRequest, input: unknown) => Promise<"allow" | { deny: string }>;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const pendingMatches: Equal<SignedPendingRequest, SpecSignedPendingRequest> = true;
const resolutionMatches: Equal<Resolution, SpecResolution> = true;
const signerMatches: Equal<ApprovalSigner, SpecApprovalSigner> = true;
const recheckMatches: Equal<Recheck, SpecRecheck> = true;
// §3.3 declares `hmacSigner(options: { keys: Record<string, Uint8Array>; current: string })`; such a value must fit.
const hmacAccepts: Parameters<typeof hmacSigner>[0] = { keys: {} as Record<string, Uint8Array>, current: "a" };
const ephemeralReturns: Equal<ReturnType<typeof ephemeralSigner>, SpecApprovalSigner> = true;

// @ts-expect-error A pending request without its signature is not a SignedPendingRequest.
const unsigned: SignedPendingRequest = {
  id: "r",
  kind: "approval",
  callId: "c",
  tool: "t",
  inputHash: "h",
  keyId: "k",
  createdAt: "",
};

test("the pending request, resolution, signer and recheck types match the SDK plan field for field", () => {
  assert.deepEqual(
    [pendingMatches, resolutionMatches, signerMatches, recheckMatches, ephemeralReturns],
    [true, true, true, true, true],
  );
  assert.equal(hmacAccepts.current, "a");
  assert.equal(unsigned.id, "r");
});
