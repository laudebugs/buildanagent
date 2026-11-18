# 0004. Price usage from a versioned catalog, let a billed total win, and block budgeted runs on unknown prices

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D4](../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it)

## Context

Guide decision 4 asks where prices come from, how often they refresh, and whether a provider-billed total overrides the catalog. Cost needs a `basis` flag and tiered rates, and failed attempts count. A run-time price fetch would reach outside the process by default.

## Decision

The gateway ships `catalog.json` with per-model tiered rates, an `asOf` date and a source URL, refreshed in every minor release; callers may pass their own. A billed total sets `basis: "provider"` and wins. An unknown model gets `basis: "unknown"` and `total: null`, and a run with a USD cap refuses to start on it.

## Consequences

- A test warns when a catalog entry is older than 90 days.
- `Cost.total` is `number | null`, which the harness sketch must adopt (P2).
