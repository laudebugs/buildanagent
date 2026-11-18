# 0008. Start at 0.x with marked breaking changes, and fail CI on undocumented exports and on stale doc names

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D8](../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted)

## Context

Guide decision 8 asks whether to start at 0.x or 1.0, and which CI check fails on exports missing from the docs. Its rule is 0.x unless an external consumer depends on the SDK before the harness ships; the only planned consumers are our own harness and agent.

## Decision

Both packages start at 0.x, `private: true` until the owner chooses to publish. The four versioning rules apply from the first release, and defaults, built-in prompts and tool descriptions are versioned too. CI fails when a public export lacks docs and when the docs name a symbol missing from the `.d.ts`.

## Consequences

- A 0.x minor release may break the API, but only with a "Breaking Changes" changelog entry.
- The owner decides when, and whether, to publish to npm.
