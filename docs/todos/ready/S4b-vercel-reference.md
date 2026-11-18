# S4b: Vercel AI SDK: guide and fact-check, written and reviewed

| Field | Value |
| --- | --- |
| ID | `S4b` |
| Status | `ready` |
| Plan | [SDK references §4 S4](../../plans/sdk-references.md#s4-vercel-ai-sdk) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S4a](../ready/S4a-vercel-verify.md) |
| Size | M |

## Goal

Write the Vercel AI SDK guide and fact-check from S4a's facts, review them, fix every finding, and ship. This todo completes milestone M1.

## Context

- S4a's results and examples
- The three earlier references as the structure to mirror

## Scope

**In scope**

- The guide, the fact-check and the reference README

**Out of scope** (and which todo covers it)

- The comparison (C1, C2)

## Tasks

- [ ] Draft with `/anthropic-skills:writing`
- [ ] Fact-check the drafts and log corrections
- [ ] Review with `/anthropic-skills:writing-review`
- [ ] Apply the fixes and re-check changed claims
- [ ] Update the root README and the plan
- [ ] Run the local checks and push

## Acceptance criteria

- [ ] Both documents exist and pass review
- [ ] Every **[verified]** claim maps to a passing example
- [ ] Local checks pass

## Tests

None beyond S4a's examples.

## Docs to update

Root README; the SDK references plan; the roadmap (M1 done).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
