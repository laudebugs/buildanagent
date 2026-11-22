# N22: In-process extensions: composition, project trust and content-hash pins

| Field | Value |
| --- | --- |
| ID | `N22` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](../ongoing/N11-tool-registry.md), [N12](N12-permission-pipeline.md) |
| Size | M |

## Goal

Let TypeScript extensions add interceptors, observers and tools under declared composition rules, and load project-supplied ones only in a trusted project with a matching content hash.

## Context

- [harness guide §7](../../guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution): tiers, composition, trust gates loading, pinning
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch

## Scope

**In scope**

- `Extension`, `composeExtensions()` with the composition rules of §3.5
- `TrustStore` (a file of trusted project roots) and `loadProjectExtensions()`
- `extensions.lock.json` with a SHA-256 per extension; a mismatch refuses the load
- Headless and untrusted: skip with a notice
- `extension_loaded` entries

**Out of scope** (and which todo covers it)

- Skills (N23)
- MCP servers (N24), and pinning MCP tool definitions, which N25 owns on this lock file's format

## Tasks

- [ ] Hash every file in the extension's directory in sorted order.
- [ ] Write the docs sentence that trust is not a sandbox.

## Acceptance criteria

- [ ] Two extensions' `beforeToolCall`: one denying and one allowing yields deny; any ask yields ask
- [ ] Two `transformContext` extensions chain in registration order
- [ ] An untrusted project's extension does not load, and a trusted one with a changed file is refused
- [ ] Headless runs skip project extensions by default
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/extensions/compose.test.ts`, `trust.test.ts`, `lock.test.ts`.

## Docs to update

`packages/harness/README.md`: writing an extension. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
