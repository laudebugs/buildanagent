# 0013. Write one session-log entry per content block, from the SDK's end events, and never persist deltas

- **Status:** Proposed, no longer provisional: todo N35's granularity test kept the choice (2026-11-25)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD1](../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-decided-by-n35)

## Context

Harness decision 1 asks whether the log stores one line per stream delta, per content block or per completed message. A real Claude Code transcript stores one entry per content block, so parallel tool calls interleave with their results, and the SDK's `*_end` events already carry each authoritative item.

## Decision

On `model_call_end` the session runner writes one `message_block` entry per block, a `message_end` entry and a `usage` entry; each `tool_call_end` becomes a `tool_result` entry. Deltas reach live clients as protocol events only.

## Consequences

- Playback rebuilds the SDK `Context` from block entries with no model calls.
- `EntryBase.origin` gives agent decision 5 a per-block provenance label.
- Todo N35 records the capstone at all three granularities and keeps this choice unless per-block playback loses information that per-delta keeps.

## Result of the granularity test (N35, 2026-11-25)

Todo N35 recorded the harness capstone's three cases per delta, per block and per message, and kept this decision. In the approved case, the per-delta file took 6,810 bytes against 1,889 per block and 1,589 per message. All three played back to the same transcript as the rebuilt context, for text and tool-call blocks; the capstone has no reasoning block, so a reasoning block's signature is not covered. Per delta kept only the stream's 56 chunk boundaries beyond per block, and no playback reads them. Its decoder also needed the most code, 29 lines against 18 per block. Per message was smaller still, but one line per message cannot give each block its own provenance label. The numbers are in [`granularity.json`](../../packages/harness/test/fixtures/capstone/granularity.json), and the plan's [HD1](../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-decided-by-n35) records the result.
