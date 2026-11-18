# S5b: LangChain: guide and fact-check, written and reviewed

| Field | Value |
| --- | --- |
| ID | `S5b` |
| Status | `done` |
| Plan | [SDK references §4 S5](../../plans/sdk-references.md#s5-langchain-added-2026-11-18) |
| Round / milestone | Round S (SDK references), M2b |
| Depends on | [S5a](../done/S5a-langchain-verify.md) |
| Size | M |

## Goal

Write the LangChain guide and fact-check from S5a's facts, review them, fix every finding, and ship.

## Context

- S5a's results and examples
- The four earlier references as the structure to mirror

## Scope

**In scope**

- `docs/reference/langchain/guide.md`, `fact-check.md` and `README.md`

**Out of scope** (and which todo covers it)

- The comparison update (C3) and the skill (K3)

## Tasks

- [x] Draft with `/anthropic-skills:writing`
- [x] Fact-check the drafts and log corrections
- [x] Review with `/anthropic-skills:writing-review`
- [x] Apply the fixes and re-check changed claims
- [x] Update the root README and the plan
- [x] Run the local checks and push

## Acceptance criteria

- [x] Both documents exist and pass review
- [x] Every **[verified]** claim maps to a passing example
- [x] Local checks pass

## Tests

None beyond S5a's examples.

## Docs to update

Root README; the SDK references plan.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`guide.md`, `fact-check.md` and `README.md` written and reviewed. Re-checking the drafts against the sources corrected two claims of mine: `createFilesystemMiddleware` comes from `deepagents`, so it is not missing from langchain (the API diff now separates other packages' factories), and the message-content finding covers nine blocks, not eleven.
