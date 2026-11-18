# 0026. Derive provenance from HD1's per-block origin labels plus a per-session taint, without per-argument tracking

- **Status:** Proposed (provisional until todos A15 and A21)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD5](../plans/build-agent.md#ad5-hd1s-per-block-origin-plus-a-per-session-taint-and-no-per-argument-tracking-provisional)

## Context

Agent decision 5 asks whether origin labels are per entry, per content block or per argument, and its settling test keeps the coarsest granularity on which the "refuse T2+ arguments derived from untrusted text" rule and the T3 foreign-identifier scan both work. ADR 0013 already writes one entry per block with an `origin`.

## Decision

A role's session is tainted when any block in it has `origin: "user"` or comes from a tool that declares `outputTrust: "untrusted"`. A permission hook denies any T2+ call proposed in a tainted session; code-initiated T3 and T4 calls built from a tainted draft always ask, and the approval card lists the taint sources. The foreign-identifier scan reads the draft text and needs no provenance. No per-argument tracking in v1.

## Consequences

- The harness records a tool's declared output trust as `tool_result.trust` (build-agent.md §3.7, AH10; todos N2 and N11), and the planner's code-built input carries `origin: "operator"` (AH14; todo N6).
- If an injection task in todo A15 or A21 steers a T2+ call past both rules, this record is superseded by per-argument labels.
