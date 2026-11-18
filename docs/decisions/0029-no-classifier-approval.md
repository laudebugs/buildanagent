# 0029. Let no classifier approve a triage-agent call, and let detectors only raise a tier

- **Status:** Proposed
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD10](../plans/build-agent.md#ad10-no-classifier-approves-any-call-and-a-classifier-may-only-raise-a-tier)

## Context

Agent decision 10 asks whether a classifier approves T1–T2 calls or only routes and raises tiers. ADR 0019 confines classifier allows to the harness's host callback and leaves the choice to the agent.

## Decision

The agent's host callback is the tier table and nothing else. T0 and T1 are allowed by the table, so a classifier would save no prompts; T2 to T4 keep their person. A detector may run as a permission hook that turns an allowed call into an ask, and its verdicts are logged.

## Consequences

- Shadow-mode labels (todo A22) make a later classifier comparison possible; adopting one would supersede this record.
