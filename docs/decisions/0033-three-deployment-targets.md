# 0033. Run the SDK and harness on Cloudflare, AWS and Vercel, proved by one conformance suite, with Cloudflare first

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-coding-agent.md, CA3](../plans/build-coding-agent.md#ca3-cloudflare-first-then-aws-and-vercel-behind-one-conformance-suite-accepted)

## Context

The owner wants the coding agent deployed "to at least two cloud platforms or three", with all of Cloudflare as the first. The [portable agents report](../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places) found the SDK portable as planned and the harness tied to one host in six places. The [storage-and-wake note](../research/deployment/storage-and-wake.md) reduced those ties to storage, a single writer and a wake. GCP's and Azure's native sandboxes allow egress only on or off, which fails our allowlist rule ([portable agents report](../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first)).

## Decision

The SDK and harness support four targets: local Node for development, Cloudflare (primary), AWS and Vercel. Each target implements the same seven seams: `SessionStore`, `SessionLock`, `Scheduler`, `KeyStore`, `SandboxClient`, `EgressPolicy` and a transport. One conformance suite (todo N45) runs the same cases against every implementation. The sandboxes are Cloudflare Sandbox on Cloudflare (with E2B as a swap), E2B on AWS and Vercel Sandbox on Vercel. Off-host `SessionLock` implementations treat a lapsed lease as the only staleness signal; HD2's dead-pid check applies on the same host only. GCP and Azure are not targets.

## Consequences

- ADR 0014's file lock stays the local implementation; this record adds the off-host ones that its last consequence anticipated.
- The harness plan's non-goals drop the WebSocket transport and hosted sandbox backends; todos N41–N49 build the seams, adapters and measurements.
- The coding agent deploys on Cloudflare first (W4–W8), then AWS (W9) and Vercel (W10).
