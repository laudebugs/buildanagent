# N11: Tool registry: canonical names, exposure, tool search and host tools

| Field | Value |
| --- | --- |
| ID | `N11` |
| Status | `done` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
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
- The turn's `hostContext` passed to the wrapper by `definitions(wrap, hostContext)` and on to `execute`, never in a schema (agent AH2)
- `RegisteredTool.outputTrust`, defaulting to `"untrusted"` for `mcp:*` sources and for any tool that calls a remote agent, and `"trusted"` otherwise, copied into `tool_result.trust` (agent AH10; the remote-agent default added by the owner's approval of U19's change 4 on 2026-11-19, [harness plan §3.3](../../plans/build-harness.md#33-context-policy-and-tool-registry-apis)). Choose how the registry knows a tool calls a remote agent: a source such as `` `agent:${string}` `` or a flag the registering code sets
- `RegisteredTool.approvalReuse`, default `"both"`, which N14 enforces (R8)

**Out of scope** (and which todo covers it)

- MCP sources (N24)
- Built-in tools (N21)
- Permission checks (N12)

## Tasks

- [x] Use the SDK's canonical name rule; do not re-implement it.
- [x] Keep definition order stable so the cached prefix does not move when tools activate.
- [x] Compute `preambleTokens` from the serialised tool definitions and the system prompt.

## Acceptance criteria

- [x] Registering two tools with one name throws; two MCP servers with one tool name get distinct, stable names
- [x] An extension replacing a built-in without `override: true` throws
- [x] A deferred tool is absent from requests until `tool_search` activates it, then present in the next request
- [x] Activation does not reorder tools already sent
- [x] A host-context value reaches `execute` and appears in no recorded request and no entry
- [x] An MCP-sourced tool's results and a remote-agent tool's results are written with `trust: "untrusted"`, a built-in's with `"trusted"`, and a declared `outputTrust` overrides any default
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/tools/registry.test.ts`, `tool-search.test.ts`.

## Docs to update

`packages/harness/README.md`: the registry. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 need 8.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The harness now holds every tool in one registry that names, defers and wraps them. It lives in `packages/harness/src/tools/`, and the plan's §3.3 sketch holds with the differences below.

**Public API (`@buildanagent/harness/tools`).**
- `createToolRegistry()` returns a `ToolRegistry` with `register`, `get`, `list`, `setExposure`, `definitions(wrap?, hostContext?)`, `activeTools(activated)` and `preambleTokens({ system })`.
- `toolSearchTool(registry, { activated, maxResults })` and `toolSearchInterceptors(registry, activated)`.
- `DuplicateToolError`, a `HarnessError` with code `duplicate_tool`, and the new code `invalid_tool_registration` for an unusable registration.
- Types: `RegisteredTool`, `ToolRegistration`, `ToolSource`, `HostPattern`, `ToolExposure`, `OutputTrust`, `ApprovalReuse`, `ToolWrapper` and `PreambleOptions`.

**Behavior.**
- A canonical name is checked once, with the gateway's `isCanonicalName()`. An MCP tool becomes `mcp__<server>__<tool>`, with characters outside the rule replaced by `_`. A collision, or a name over 64 characters, appends `_` and an FNV-1a hash of the source and name, so the name does not depend on registration order. The same server listing the same tool twice is a duplicate.
- An extension, client or other non-MCP tool replaces a built-in only with `override: true`, in the built-in's place in the order. Override reaches nothing else.
- Aliases are unique among aliases and never equal another tool's canonical name.
- `definitions()` returns frozen definitions in registration order, with the registry's name and exposure. `activeTools()` is every `direct` tool plus the activated names, in that order.
- `outputTrust` resolves to `untrusted` for an MCP tool or a `remoteAgent` tool and `trusted` otherwise, and a declared value wins. The session runner copies it into `tool_result.trust`.

**Decisions.**
- **A flag marks a remote-agent tool,** `remoteAgent: true`, because the plan's `ToolSource` union has no `agent:` source and a flag leaves that union as it is.
- **`preambleTokens()` takes no model.** The gateway's `estimateInputTokens()` counts characters and does not depend on the model, so the plan's `model` argument would do nothing. It takes the system prompt as an option instead.
- **`register()` takes `exposure` as optional,** because the registry defaults it per source, and `outputTrust` on a `RegisteredTool` is always resolved.
- **Tool search lives beside the registry,** with the activated set passed explicitly, so a run owns its own and the registry holds no per-run state.
- **The host context reaches `execute` through the wrapper's closure,** as the todo says. A caller can instead pass it as `RunOptions.app` and read it as `ctx.app`, which the harness plan records as the follow-up for N6; an `app` binds into signed approvals, so N6 decides.
- **No built-in or MCP tool exists yet,** so the tests register stand-ins. N21 and N24 register the real ones.

**Left out.** Wiring the `client_request` pattern to a `tool/call` server request (N28), MCP sources (N24), built-ins (N21) and permission checks (N12).
