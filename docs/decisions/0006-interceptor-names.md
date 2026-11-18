# 0006. Name the six interceptors by model and tool moment, and keep run-level hooks as observers

- **Status:** Proposed
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D6](../plans/build-sdk.md#d6-our-six-moment-named-interceptors-with-run-level-hooks-as-observers)

## Context

Guide decision 6 asks whether to use our names or LangChain's (`beforeModel`, `wrapToolCall`). AGENTS.md's planned architecture already lists the moments, and the triage capstone needs two hooks under either naming.

## Decision

The interceptors are `transformContext`, `beforeModelCall`, `afterModelCall`, `beforeToolCall`, `afterToolCall` and `shouldStop`, each taking one event object and returning a replacement. Run start and end are observer events only.

## Consequences

- No wrap-style hook calls through to `execute`, so each return type stays small.
- Todo B19 re-counts the capstone's hooks and records the result.
