# 0011. Check canonical tool names against `^[A-Za-z0-9_-]{1,64}$`, and sanitise reversibly per adapter

- **Status:** Proposed (provisional until todo B7)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D12](../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-provisional)

## Context

Guide decision 12 notes that the 64-character `[A-Za-z0-9_-]` floor is an assumption without a per-provider table. Names must be sanitised to the strictest provider and stay stable for prompt caching.

## Decision

Todo B7 builds the per-provider table from each first provider's API reference before naming code is written. Until then, `defineTool()` rejects names outside `^[A-Za-z0-9_-]{1,64}$`, and each adapter keeps a reversible map from canonical to wire names.

## Consequences

- If a provider is stricter than the floor, B7 tightens the rule and records why.
- Namespaced names such as `mcp__<server>__<tool>` follow the same rule.
