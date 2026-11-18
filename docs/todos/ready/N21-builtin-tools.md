# N21: Built-in tools: `read`, `write`, `edit`, `bash` and `fetch` through the sandbox

| Field | Value |
| --- | --- |
| ID | `N21` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N11](N11-tool-registry.md), [N15](N15-sandbox-interface.md), [N20](N20-credential-proxy.md), [N8](N8-write-cap-masking.md) |
| Size | M |

## Goal

Ship the small built-in tool set the eval baseline needs, each running only through a `Sandbox` or the egress proxy, each result passing the write cap.

## Context

- [harness guide §4](../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension): every tool passes the pipeline and the write cap
- [AGENTS.md planned architecture](../../../AGENTS.md#planned-architecture-when-code-starts): a small set of well-designed tools
- [build-harness.md §5.1](../../plans/build-harness.md#51-every-test-runs-offline-on-the-sdks-scripted-model-and-no-test-touches-the-host): host tools only against the fake in tests

## Scope

**In scope**

- `builtinTools(sandbox, proxy)` returning `read`, `write`, `edit`, `bash`, `fetch` as `RegisteredTool`s
- `read` that can open spill files by path
- `edit` as exact string replacement with a unique-match rule
- `bash` with a timeout and output through the write cap
- `fetch` through `EgressProxy.fetch` only
- Path checks against `writeRoots` before calling the sandbox

**Out of scope** (and which todo covers it)

- Search tools (grep, glob): P3 or later, if evals show the need

## Tasks

- [ ] Run every test of `write`, `edit` and `bash` against `fakeSandbox()`.
- [ ] Mark `read` and `fetch` `firstParty` read-only for scheduling.

## Acceptance criteria

- [ ] With `fakeSandbox()`, a scripted model's `bash` call records the command and touches no host file
- [ ] `edit` with two matches returns an error result and changes nothing
- [ ] A `fetch` to a non-allowlisted host returns an error result
- [ ] `read` of a spill path returns the full output
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/tools/builtins.test.ts`.

## Docs to update

`packages/harness/README.md`: each tool's contract. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Tool descriptions affect model behaviour; version them and let N39 compare.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
