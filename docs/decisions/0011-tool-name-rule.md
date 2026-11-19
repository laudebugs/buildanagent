# 0011. Check canonical tool names against `^[A-Za-z0-9_-]{1,64}$`, and sanitise reversibly per adapter

- **Status:** Proposed. Todo B7 confirmed the rule against both first providers on 2026-11-19, so the rule is in force for the adapter todos B8 and B9 until the owner accepts this record.
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D12](../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising)

## Context

Guide decision 12 notes that the 64-character `[A-Za-z0-9_-]` floor is an assumption without a per-provider table. Names must be sanitised to the strictest provider and stay stable for prompt caching.

## Decision

Before any naming code was written, todo B7 would build the per-provider table from each first provider's API reference. Until then, `defineTool()` would reject names outside `^[A-Za-z0-9_-]{1,64}$`, and each adapter would keep a reversible map from canonical to wire names. B7 built the table and kept the rule.

## Consequences

- B7 was to tighten the rule, and record why, if a provider proved stricter than the floor. Neither first provider was, so the rule stands.
- Namespaced names such as `mcp__<server>__<tool>` follow the same rule.

## Status note (todo B7, 2026-11-19)

The per-provider table in [`packages/gateway/src/names.md`](../../packages/gateway/src/names.md) keeps the rule unchanged. As of November 2026, Anthropic Messages accepts `^[a-zA-Z0-9_-]{1,128}$` ([Messages API reference](https://platform.claude.com/docs/en/api/messages/create)), and OpenAI Chat Completions accepts the same characters at up to 64 ([Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), `FunctionDefinition.name`). Their strictest intersection is `^[A-Za-z0-9_-]{1,64}$`, the floor this record assumed, so no superseding rule is needed. The [fact-check log](../plans/reviews/fact-check-tool-name-rule.md) records each source, and `names.md` lists what neither provider states.

`assertCanonicalName()` checks the rule, and `createToolNameMap()` gives each adapter its reversible map. The map keeps a name its provider's rule accepts. It adds a hash suffix to any other name, and to a name that differs only in case from one already issued.
