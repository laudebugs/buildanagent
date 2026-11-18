# 0015. Have the harness always sign pauses with a persistent, host-only key ring, and make every approval a pause first

- **Status:** Superseded by [0035](0035-read-only-key-store.md) (2026-11-18); accepted by the owner on 2026-11-18
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD5](../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5)

## Context

Harness decision 5 merges with SDK decision 5 (ADR 0005). The SDK defaults to a per-process ephemeral key, but harness sessions must resume after a restart and in another process, which an ephemeral key would strand.

## Decision

The harness keeps a key ring in a `KeyStore` outside every sandbox and outside the session log (by default `$XDG_STATE_HOME/agent-speak/keys.json`, mode `0600`) and passes `hmacSigner({ keys, current })` on every run and resume. Rotation adds a current key; an old key stays until no unresolved `approval_requested` entry names it. Every `ask` ends the run `awaiting_approval`, and the harness writes the `approval_requested` entry before any client sees the request; it never uses `blockingApprovals()`. On resume the SDK verifies signatures and the harness re-runs its pipeline on each approved call, letting a deny win.

## Consequences

- The SDK's ephemeral default stays correct for library users; the owner may still make `signer` required (ADR 0005's alternative), which the harness already satisfies.
- Outcome (2026-11-18): the owner kept the ephemeral default, so `signer` stays optional in the SDK (ADR 0005).
- Todo N13 builds the key store and the resume path.
