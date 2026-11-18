# N11: Tool registry: canonical names, exposure, tool search and host tools

| Field | Value |
| --- | --- |
| ID | `N11` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-tools-and-permissions) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N1](N1-harness-workspace-scaffold.md), [B12](B12-parallel-tools.md) |
| Size | M |

## Goal

Hold every tool from every source in one registry that names it canonically, refuses silent overrides, sets exposure per source, activates deferred tools through tool search, and wraps each definition for the run.

## Context

- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): one registry, canonical names, exposure, preamble size, host-tool patterns
- [build-harness.md §3.3](../../plans/build-harness.md#33-context-policy-and-tool-registry-apis): the API sketch
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 8 (`activeTools`)
- [build-harness.md §3.7](../../plans/build-harness.md#37-what-the-agent-plan-gets-from-the-harness): R2 through the wrapper

## Scope

**In scope**

- `ToolRegistry` with `register`, `setExposure`, `definitions(wrap)`, `activeTools`, `preambleTokens`
- `DuplicateToolError`; deterministic hash suffixes for MCP collisions; `override: true` to replace a built-in
- Aliases kept apart from canonical names, so rules can match either
- `toolSearchTool()` that activates deferred tools for the next step through `ModelCallPatch.activeTools`
- Host patterns `in_process` and `client_request` (the latter awaits a `tool/call` server request, wired in N28)
- `HarnessOptions.hostContext` passed to `execute` through the wrapper, never in a schema

**Out of scope** (and which todo covers it)

- MCP sources (N24)
- Built-in tools (N21)
- Permission checks (N12)

## Tasks

- [ ] Use the SDK's canonical name rule; do not re-implement it.
- [ ] Keep definition order stable so the cached prefix does not move when tools activate.
- [ ] Compute `preambleTokens` from the serialised tool definitions and the system prompt.

## Acceptance criteria

- [ ] Registering two tools with one name throws; two MCP servers with one tool name get distinct, stable names
- [ ] An extension replacing a built-in without `override: true` throws
- [ ] A deferred tool is absent from requests until `tool_search` activates it, then present in the next request
- [ ] Activation does not reorder tools already sent
- [ ] A host-context value reaches `execute` and appears in no recorded request and no entry
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/tools/registry.test.ts`, `tool-search.test.ts`.

## Docs to update

`packages/harness/README.md`: the registry. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 need 8.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
