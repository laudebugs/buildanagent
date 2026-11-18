# 0007. Validate raw JSON Schema with pi-schema 1.5.2, supporting drafts 2020-12 and 7

- **Status:** Proposed (provisional until todo B10)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D7](../plans/build-sdk.md#d7-pi-schema-validates-raw-json-schema-and-b10-confirms-the-choice-against-both-candidates-provisional)

## Context

Guide decision 7 asks which eval-free validator to bundle and which drafts it supports. Claude's output schemas are draft-07. Two MIT, eval-free candidates are already in our lockfile: `@earendil-works/pi-schema` 1.5.2 (drafts 2020-12 and 7, JSON Pointer error paths, no dependencies) and `@cfworker/json-schema` 4.1.6 (drafts 4, 7, 2019-09 and 2020-12).

## Decision

The SDK bundles pi-schema 1.5.2, with `@cfworker/json-schema` 4.1.6 as the fallback, and supports drafts 2020-12 and 7. Coercion is our own pipeline step.

## Consequences

- Todo B10 runs both candidates on our adapters' strict schemas and Claude's draft-07 schemas; pi-schema stays unless it fails a schema the fallback passes.
- pi-schema declares `node >=22.19.0`, which B1 checks.
