# C5: TypeScript gap report

| Field | Value |
| --- | --- |
| ID | `C5` |
| Status | `ongoing` |
| Plan | [SDK references, TypeScript gap report](../../plans/sdk-references.md#typescript-gap-report-added-2026-11-18) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [S8b](../done/S8b-copilot-reference.md) |
| Size | M |

## Goal

Write `docs/comparison/typescript-gaps.md`: for each SDK whose primary language isn't TypeScript, what the TypeScript package lacks, has in weaker form, or has documented only for the primary language. Add a short parity section to each affected fact-check that links to it.

## Context

- The [SDK references plan](../../plans/sdk-references.md): the language policy, S8 and the TypeScript gap report
- The finished references and their fact-checks

## Scope

**In scope**

- As named in the title; see the plan section

**Out of scope** (and which todo covers it)

- The comparison update (C4) and skills (K4)

## Tasks

- [ ] Do the work the plan section describes, citing primary sources at recorded versions
- [ ] Draft prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [ ] Run the local checks and push

## Acceptance criteria

- [ ] The deliverables exist, every claim has a source, and review fixes are applied
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Primary-language docs may be blocked by the network policy; ask the owner to allow specific hosts.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
