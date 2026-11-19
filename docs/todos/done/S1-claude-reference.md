# S1: Claude Agent SDK reference

| Field | Value |
| --- | --- |
| ID | `S1` |
| Status | `done` |
| Plan | [SDK references §4 S1](../../plans/sdk-references.md#s1-claude-agent-sdk-done) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | None |
| Size | L |

## Goal

A verified TypeScript reference for `@anthropic-ai/claude-agent-sdk@0.3.327`: a guide, a four-tier fact-check, a gitignored mirror and an offline harness.

## Context

- [docs/reference/claude-agent-sdk/](../../reference/claude-agent-sdk/)
- [verify/claude-agent-sdk/](../../../verify/claude-agent-sdk/)

## Scope

**In scope**

- Guide, fact-check, mirror script, harness with a mock Messages API, seven behavioral examples

**Out of scope** (and which todo covers it)

- Python SDK (not planned)

## Tasks

- [x] Mirror the 32 agent-sdk pages
- [x] Type-check 385 TypeScript blocks
- [x] Run 87 complete blocks against the mock API
- [x] Diff the API surface against sdk.d.ts
- [x] Write seven behavioral examples
- [x] Write, review and fix the guide and fact-check

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/verify-claude-agent-sdk test` passes offline

## Tests

`verify/claude-agent-sdk/examples/` (7 examples).

## Docs to update

Done.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
