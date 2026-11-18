# Plan: compare the four SDKs on facts the references verified (Round C)

- **Status:** Done
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): a deep comparison once every SDK is done, and a table comparing their features
- **Builds on:** the four references from [Round S](sdk-references.md), and the [research report](../research/agent-sdks-and-harness-design.md)
- **Todos:** Round C on the [todo board](../todos/README.md); §4 lists them.

## 1. Goal

A team choosing an agent SDK, or deciding which ideas to copy into its own harness, can read one page and see how the four SDKs differ on every dimension that matters. Every cell in that page traces back to a verified fact in a reference, not to marketing copy.

## 2. The feature table (C1)

`docs/comparison/feature-table.md` holds one table: one row per feature and one column per SDK. Each cell gives a short answer and links to the guide section or fact-check row behind it. The rows, grouped:

| Group | Rows |
| --- | --- |
| Architecture | Where the loop runs (subprocess or in-process); languages; license; model lock-in; package size and install footprint |
| Loop control | Turn and budget caps; stop conditions; streaming events; interrupt, steer and follow-up |
| Tools | Built-in tools; custom tool definition and schema library; parallel calls; tool search or deferral; MCP client and server |
| Safety | Permission model; approval callbacks; hooks that can block; sandboxing; how secrets stay out of the model's reach |
| State | Session storage; resume, fork and branch; compaction and its control; memory |
| Output | Structured output; multi-agent handoffs and subagents |
| Operations | Tracing and OpenTelemetry; cost accounting; offline testing seam; docs accuracy (from each fact-check) |

## 3. The deep comparison (C2)

`docs/comparison/deep-comparison.md` compares the SDKs as designs, not as feature lists:
- **The same agent four ways.** Each reference's triage-agent capstone gets a side-by-side reading: lines of code, how the risky tool is gated, how the typed result comes back, and what a test needs.
- **Design trade-offs.** Who owns the loop, how much safety ships by default, and how much each SDK lets you replace.
- **Lessons for our own stack.** For each of our planned layers (SDK, harness, agent), which SDK's design to copy and which to avoid. Round G starts from this section.
- **A refreshed research report.** C2 also updates [agent-sdks-and-harness-design.md](../research/agent-sdks-and-harness-design.md) with what the references found, logged in its fact-check as corrections.

Both C1 and C2 go through `/anthropic-skills:writing` and `/anthropic-skills:writing-review`, and every cell and claim is re-checked against its reference before the push.

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| C1 | Feature table for the four SDKs (done) | S4b |
| C2 | Deep comparison, and the research-report refresh (done) | C1 |

## 5. Risks

- **Unequal depth.** The references verify different behaviors, so a cell may compare a verified fact with a documented one. Mitigation: mark each cell **[verified]** or **[documented]**, the same convention the guides use.

## 6. Open questions

- None yet.
