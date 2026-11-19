# 0043. Build the signer, effect identity, outcomes and plan approval in a standalone safety package that our SDK later imports

- **Status:** Accepted (owner, 2026-11-18), including `EffectStore` as the eighth portable seam; names amended by [0044](0044-rename-to-buildanagent.md) (2026-11-19)
- **Date:** 2026-11-18
- **Plan:** [close-sdk-gaps.md, SG1](../plans/close-sdk-gaps.md#sg1-the-safety-core-is-a-standalone-package-that-our-sdk-later-imports-accepted-adr-0043)

## Context

The owner wants the SDK gaps closed and tested before anything big is built. The planned safety package, todo F5, depends on B15, the seventh todo on Round B's longest chain, so it cannot start until most of our SDK exists ([build-sdk.md §4.3](../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses)). Three accepted ADRs place the pieces inside the SDK packages: ADR 0001 names two packages, ADR 0005 puts the signer in the SDK, and ADR 0009 has B14 export `projectCallCost()` from the loop.

## Decision

`@agent-speak/agent-safety` becomes a third workspace package with no dependency on `@agent-speak/sdk`. It holds the `ApprovalSigner` interface and its signers, the canonical input hash, the effect identity and store, the five write outcomes and the plan approval. It depends only on `@agent-speak/gateway`, for the price catalog and for `projectCallCost()`, which moves from B14 to B5. Our SDK imports the signer and hashing from the package instead of defining them, with the interface shapes that [build-sdk.md §3.3](../plans/build-sdk.md#33-sdk-api) gives them. ADR 0005's rules stay as written: key ids, a fail-closed resume that no option turns off, and the same signed fields. The package's `EffectStore` becomes an eighth portable seam beside ADR 0033's seven, held to the same conformance suite (N45).

## Consequences

- Round E (todos E1–E7) can start after B1 and B5, before the loop exists.
- B15 imports the signer and `canonicalInputHash()` from the package, B5 exports `projectCallCost()` and the token-level `projectCost()` it calls, and B14 imports both from the gateway. B5, B14 and B15 carry revisions that apply this record, which the owner accepted on 2026-11-18.
- ADR 0001 is extended by a third package, ADR 0033 by an eighth seam, and ADR 0009's consequence about B14 is superseded by this record; ADR 0005 is unchanged in substance.
- F5 narrows to releasing the package for the platform's generation templates.

## Notes

- 2026-11-19 (owner decision): the package also owns the `SignedPendingRequest` and `Resolution` types, which this record did not list, and our SDK re-exports them. Plan review 2 proposed it ([§6, action 2](../plans/reviews/plan-review-2.md#6-eleven-owner-actions-are-still-open-and-only-one-a-test-project-for-n50-touches-waves-15)), and [E3](../todos/ongoing/E3-signed-approvals-third-party.md) builds them. The decision above is otherwise unchanged.
