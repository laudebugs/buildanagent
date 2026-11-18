# 0035. Let a read-only cloud secret back the approval key ring, with rotation optional

- **Status:** Accepted (owner, 2026-11-18); supersedes [0015](0015-harness-approval-key-ring.md)
- **Date:** 2026-11-18
- **Plan:** [build-coding-agent.md, CA10](../plans/build-coding-agent.md#ca10-a-read-only-cloud-secret-can-back-the-key-ring-accepted)

## Context

ADR 0015 keeps the harness's approval key ring in a host-only file that the harness rotates and prunes. On Cloudflare, AWS and Vercel the key comes from a secret store the harness can read but not write. The SDK's default, `ephemeralSigner()`, cannot fill the gap: it cannot resume a pause on any serverless host, because the isolate or function may be recycled between the pause and its resume ([portable agents report](../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places)).

## Decision

Everything in ADR 0015 stands except storage and rotation. `KeyStore.load()` stays required; `rotate()` and `prune()` become optional. A read-only `KeyStore` reads the key ring from the target's secret store (a Worker secret or Secrets Store, Secrets Manager, or a secret environment variable), and the owner rotates keys with the platform's tooling. An old key stays in the ring until no unresolved `approval_requested` entry names it, as before. The harness still always passes `hmacSigner()`, writes every pause before a client sees it, and never uses `blockingApprovals()`.

## Consequences

- Todo N42 makes the methods optional and adds the secret-backed store; N46a, N47a and N48a supply one per target.
- The SDK docs for D5 gain one line: `ephemeralSigner()` cannot resume a pause on a serverless host. ADR 0005 is unchanged.
- ADR 0015's status is now "Superseded by 0035".
