# 0017. Pin semconv-genai at `d28355d`, and name cost attributes in our own namespace

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD7](../plans/build-harness.md#hd7-pin-semconv-genai-d28355d-and-name-cost-in-our-own-namespace-with-sdk-d3)

## Context

Harness decision 7 asks which OTel GenAI commit to pin and what to call cost; its token-field question is settled by SDK decision 3 (ADR 0003). The conventions are Development-only with no tags, and no convention names cost.

## Decision

The telemetry projection pins `open-telemetry/semantic-conventions-genai` at `d28355d`, the HEAD read on 2026-11-18, and stamps it as `agent_speak.semconv.genai.commit`. It writes `gen_ai.usage.input_tokens` as `totalInput(usage)`, and records cost as `agent_speak.cost.usd` (omitted when `Cost.total` is `null`) with `agent_speak.cost.basis`, plus our cache-token attributes, all outside `gen_ai.*`.

## Consequences

- Moving the pin is a deliberate change with a changelog entry, not a dependency bump.
- The SDK's OTel observer exports `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT` (todo B17), and the harness projection imports them (todo N31), so the two share one module (P4, harness need 10).
