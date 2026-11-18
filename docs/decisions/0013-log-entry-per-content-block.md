# 0013. Write one session-log entry per content block, from the SDK's end events, and never persist deltas

- **Status:** Proposed (provisional until todo N35)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD1](../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional)

## Context

Harness decision 1 asks whether the log stores one line per stream delta, per content block or per completed message. A real Claude Code transcript stores one entry per content block, so parallel tool calls interleave with their results, and the SDK's `*_end` events already carry each authoritative item.

## Decision

On `model_call_end` the session runner writes one `message_block` entry per block, a `message_end` entry and a `usage` entry; each `tool_call_end` becomes a `tool_result` entry. Deltas reach live clients as protocol events only.

## Consequences

- Playback rebuilds the SDK `Context` from block entries with no model calls.
- `EntryBase.origin` gives agent decision 5 a per-block provenance label.
- Todo N35 records the capstone at all three granularities and keeps this choice unless per-block playback loses information that per-delta keeps.
