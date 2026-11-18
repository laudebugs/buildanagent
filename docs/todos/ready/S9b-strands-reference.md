# S9b: Strands Agents: guide and fact-check, written and reviewed

| Field | Value |
| --- | --- |
| ID | `S9b` |
| Status | `ready` |
| Plan | [SDK references §4, S9](../../plans/sdk-references.md#s9-strands-agents-added-2026-11-18) |
| Round / milestone | M2d (added 2026-11-18) |
| Depends on | [S9a](S9a-strands-verify.md) |
| Size | M |

## Goal

Write `docs/reference/strands/guide.md`, `fact-check.md` and `README.md` from the S9a harness, following steps 6–8 of the [SDK process](../../../AGENTS.md#process-for-documenting-an-sdk).

## Context

- The S9a results and drafts in `verify/strands/results/`
- The other eight references as the structure to mirror

## Scope

**In scope**

- The guide (including a gated triage agent and a TypeScript parity section), the fact-check, and the README

**Out of scope** (and which todo covers it)

- The comparison and gap report (C6) and the skill (K5)

## Tasks

- [ ] Re-verify every draft finding against the source and the mirror
- [ ] Draft both documents with `/anthropic-skills:writing`
- [ ] Review both whole with `/anthropic-skills:writing-review`, apply the fixes, and re-check changed claims
- [ ] Rerun `pnpm run verify`

## Acceptance criteria

- [ ] Both documents pass review; every [verified] claim is backed by an example in `verify/strands/examples/`
- [ ] The guide states the pinned versions and the safety steps a reader must take

## Tests

`pnpm run verify` in `verify/strands/`.

## Docs to update

Root README docs table; the SDK references plan.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, fact-checked, and reviewed whole with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; delivered through its own pull request, squash-merged after CI passes
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
