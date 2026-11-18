# 0009. Check the USD budget before each model call, against a projected cost

- **Status:** Proposed
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D9](../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost)

## Context

Guide decision 9, harness decision 9 and agent decision 9 ask whether the USD cap is checked before each model call or after the crossing response. Claude's and mini-swe-agent's budgets act only after the response that crosses them.

## Decision

Before each call, the loop projects the call's cost from an input estimate and `maxOutputTokens`, and ends the run with `stopReason: "budget"` if spend plus projection exceeds the cap. Actual cost is still recorded after each call.

## Consequences

- Overshoot is bounded by one call's projection error, not a full call; todo B14 asserts the bound.
- P2 re-measures overshoot on recorded runs.
