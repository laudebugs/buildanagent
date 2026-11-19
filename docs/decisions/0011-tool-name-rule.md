# 0011. Check canonical tool names against `^[A-Za-z0-9_-]{1,64}$`, and sanitise reversibly per adapter

- **Status:** Proposed (todo B7 checked the provider table on 2026-11-19 and kept the rule)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D12](../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising)

## Context

Guide decision 12 notes that the 64-character `[A-Za-z0-9_-]` floor is an assumption without a per-provider table. Names must be sanitised to the strictest provider and stay stable for prompt caching.

## Decision

Todo B7 builds the per-provider table from each first provider's API reference before naming code is written. Until then, `defineTool()` rejects names outside `^[A-Za-z0-9_-]{1,64}$`, and each adapter keeps a reversible map from canonical to wire names.

## Consequences

- If a provider is stricter than the floor, B7 tightens the rule and records why.
- Namespaced names such as `mcp__<server>__<tool>` follow the same rule.

## Status note (todo B7, 2026-11-19)

The per-provider table in [`packages/gateway/src/names.md`](../../packages/gateway/src/names.md) keeps the rule unchanged. As of November 2026, Anthropic Messages accepts `^[a-zA-Z0-9_-]{1,128}$` ([Messages API reference](https://platform.claude.com/docs/en/api/messages/create)), and OpenAI Chat Completions accepts the same characters at up to 64 ([`FunctionDefinition.name` in OpenAI's TypeScript SDK](https://github.com/openai/openai-node/blob/v7.49.0/src/resources/shared.ts)). Their strictest intersection is `^[A-Za-z0-9_-]{1,64}$`, the floor this record assumed, so no superseding rule is needed. The OpenAI API reference page could not be reached from the build environment, so the OpenAI row rests on the SDK's doc comment, which is generated from the API specification; `names.md` lists what is still unchecked.

`assertCanonicalName()` checks the rule, and `createToolNameMap()` gives each adapter its reversible map, which cuts a name to fit and adds a hash suffix only for a provider stricter than the canonical rule.
