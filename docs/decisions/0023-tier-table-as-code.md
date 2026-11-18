# 0023. Ship the T0–T5 tier table as code, never register T5, always ask for replies, and deny T4 until the owner sets the caps

- **Status:** Proposed — owner to confirm (caps and sign-off)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD2](../plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-owner-to-confirm), with [AD11](../plans/build-agent.md#ad11-every-reply-needs-a-person-in-v1-and-the-template-only-path-waits-for-a-zero-leak-corpus)

## Context

Agent decision 2 asks who signs off the tier table and which refund cap and daily value budget trigger two-person approval. The boundaries and caps are our proposals, and no refund history exists yet to set them. Agent decision 11 asks whether template-only replies may skip approval.

## Decision

The table lives in `policy/tiers.ts` and compiles into deny rules, two permission hooks and the host callback, with no allow rules. T0 and T1 run freely under per-run caps; T2 asks one person in every stage; T3 always asks one person, templated or not; T4 is denied while `caps` is `null` and, once set, asks one approver up to the cap and two above it; T5 is never registered and its names are denied. Untiered and MCP-sourced tools get T3. A change to any T2+ row needs security-owner and product-owner sign-off and a `policy/CHANGELOG.md` entry, which a hash test enforces.

## Consequences

- The owner sets `singleApproverMaxCents`, `dailyValueBudgetCents` and names the two sign-off owners before any T4 path opens.
- A later todo may propose the template-only reply skip once the injection corpus (todo A21) shows zero leaks across all trials.
