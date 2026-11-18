# 0024. Require a role-based quorum per tier and amount band, bound to the host-signed pause and expiring on age or policy change

- **Status:** Proposed — owner to confirm (roles; builds on ADRs 0005 and 0015, accepted 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD3](../plans/build-agent.md#ad3-a-role-based-quorum-per-tier-and-amount-band-bound-to-the-host-signed-pause-and-expiring-on-age-or-policy-change-owner-to-confirm-with-sdk-d5-and-hd5)

## Context

Agent decision 3 asks whether N-of-M approval is a fixed pair, a role-based quorum or a policy expression, how long a partial approval stays valid, and who owns the signing key. SDK D5 signs pauses with key ids, and HD5 makes the harness sign with a persistent, host-only key ring; the harness's quorum hook (todo N14) collects resolutions and rejects the requester.

## Decision

Quorum rules are data: a tier, an optional minimum amount, one or two distinct approvers, the roles that count and a validity window (4 hours for T2, 24 hours for T3 and T4). T4 above the cap needs two distinct approvers, at least one with the `billing` role. Each approval binds to the host-signed pause; the approver's identity comes from an `ApproverDirectory` that authenticates the approval surface, never from client input. A partial quorum fails closed when its window lapses, when the policy version changed, or when an approver is the requester or lacks a counting role. No approver holds a signing key in v1.

## Consequences

- The owner names the roles and who holds them; the signing keys are already settled by ADRs 0005 and 0015.
- The harness plan should type `QuorumPolicy` with a clock and the current policy version (build-agent.md §3.7, H5).
- Todo A8 tests every fail-closed case.
