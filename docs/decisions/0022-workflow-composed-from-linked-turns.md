# 0022. Compose the triage workflow from three linked harness turns, and run every chosen side effect as a code-initiated call through the pipeline

- **Status:** Proposed (provisional until todo A16)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD1](../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional)

## Context

Agent decision 1 asks whether the harness hosts multi-step workflows or the product composes them from loop runs, and the SDK plan asks whether the reader and drafter call `Model.complete()` or run as loops. The harness plan keeps agent policy out of the harness, and a loop run gives the reader and drafter schema repair, the pre-emptive budget check and log entries for free.

## Decision

`triageTicket()` is product code. It opens one session per ticket and one child session per model role. The reader and drafter run as SDK loop runs with only an `outputTool` and `maxSteps: 2`; the planner runs one loop with the seven T0–T2 tools and a step cap of 8. Side effects that code chooses (triage fields, replies, refunds and credits) run as code-initiated tool calls through the same permission pipeline (`Harness.invokeTool()`, todo N40), so they pause with signed `approval_requested` entries like model-proposed calls.

## Consequences

- The harness plan needs per-turn run settings, a per-turn host context, child sessions keyed by step id and a code-initiated tool call (build-agent.md §3.7, AH1–AH4). P4 (2026-11-18) placed all four upstream: AH1 and AH2 in todo N6, AH3 in N5 and AH4 in the new todo N40.
- Todo A16 builds a test-only `Model.complete()` variant and compares code size, log shape and shadow replay; this record stays unless the variant wins on all three.
