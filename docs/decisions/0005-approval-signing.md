# 0005. Sign pauses with a pluggable, key-id signer, default to an ephemeral key, and never accept an unsigned resume

- **Status:** Accepted (owner, 2026-11-18), with ADR 0015
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D5](../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5)

## Context

Guide decision 5, harness decision 5 and agent decision 3 ask who owns the HMAC key for pending approvals, how it rotates, and whether an unsigned resume fails closed. A stored history is untrusted input, and the right key owner depends on whether the host runs one process or many.

## Decision

The SDK defines `ApprovalSigner` with a `keyId` on every signature, so verifiers hold key rings and rotate keys. `ephemeralSigner()` is the default; `hmacSigner()` takes a key store the harness owns. A missing, unknown-key or invalid signature always fails closed. The signed payload covers request id, kind, call id, tool, canonical input hash and an optional `policyVersion`.

## Consequences

- If the owner and P2 choose a multi-process deployment, `signer` becomes a required option instead of defaulting to an ephemeral key.
- `canonicalInputHash()` is exported so the harness stores the same hash.
- Outcome (2026-11-18): the default stays `ephemeralSigner()` and `signer` stays optional; the harness, the first multi-process host, always passes `hmacSigner()` over its key ring (ADR 0015). The first consequence's condition is therefore met by the harness, not by a required option.
- P4 (2026-11-18) added `createPendingRequest()`, which signs the same payload outside a run for code-initiated calls (todo B15).
