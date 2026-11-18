# S2: Pi reference

| Field | Value |
| --- | --- |
| ID | `S2` |
| Status | `done` |
| Plan | [SDK references §4 S2](../../plans/sdk-references.md#s2-pi-done) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S1](../done/S1-claude-reference.md) |
| Size | L |

## Goal

A verified TypeScript reference for Pi 1.5.2 (`@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`): a guide, a four-tier fact-check, a committed mirror from tag `v1.5.2` and an offline harness on pi-ai's faux provider.

## Context

- [docs/reference/pi/](../../reference/pi/)
- [verify/pi/](../../../verify/pi/)

## Scope

**In scope**

- Guide, fact-check, mirror, harness with a faux-model preload and network guard, eight behavioral examples

**Out of scope** (and which todo covers it)

- None

## Tasks

- [x] Mirror the docs, READMEs and examples from tag v1.5.2
- [x] Type-check 334 sources, with an extension-view profile
- [x] Run 20 complete examples offline
- [x] Diff settings, session entries, RPC commands and extension events
- [x] Write eight behavioral examples
- [x] Write, review and fix the guide and fact-check

## Acceptance criteria

- [x] `pnpm --filter @agent-speak/verify-pi test` passes offline

## Tests

`verify/pi/examples/` (8 examples).

## Docs to update

Done.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
