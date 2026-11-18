# 0003. Store four token classes, and name the uncached field `uncachedInput`

- **Status:** Proposed
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D3](../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name)

## Context

Guide decision 3 and harness decision 7 ask whether `input` means uncached input, as Pi stores it, or the total, as Vercel's Anthropic adapter and OTel's `gen_ai.usage.input_tokens` report it. Separate classes let the cost fold price each class with no conversion, and the OTel projection needs one sum.

## Decision

`Usage` carries `uncachedInput`, `cacheRead`, `cacheWrite` by TTL, `output`, `reasoning` (a part of `output`) and `raw`. No field is called `input`; `totalInput()` sums the input classes.

## Consequences

- The telemetry projection sums the input classes for `gen_ai.usage.input_tokens`.
- Adapters must confirm from raw usage that reasoning is counted inside output (todos B8, B9).
