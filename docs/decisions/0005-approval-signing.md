# 0005. Sign pauses with a pluggable, key-id signer, default to an ephemeral key, and never accept an unsigned resume

- **Status:** Proposed — owner to confirm (with P2)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D5](../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-owner-to-confirm-with-p2)

## Context

Guide decision 5, harness decision 5 and agent decision 3 ask who owns the HMAC key for pending approvals, how it rotates, and whether an unsigned resume fails closed. A stored history is untrusted input, and the right key owner depends on whether the host runs one process or many.

## Decision

The SDK defines `ApprovalSigner` with a `keyId` on every signature, so verifiers hold key rings and rotate keys. `ephemeralSigner()` is the default; `hmacSigner()` takes a key store the harness owns. A missing, unknown-key or invalid signature always fails closed. The signed payload covers request id, kind, call id, tool, canonical input hash and an optional `policyVersion`.

## Consequences

- If the owner and P2 choose a multi-process deployment, `signer` becomes a required option instead of defaulting to an ephemeral key.
- `canonicalInputHash()` is exported so the harness stores the same hash.
