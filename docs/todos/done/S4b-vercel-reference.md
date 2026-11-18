# S4b: Vercel AI SDK: guide and fact-check, written and reviewed

| Field | Value |
| --- | --- |
| ID | `S4b` |
| Status | `done` |
| Plan | [SDK references §4 S4](../../plans/sdk-references.md#s4-vercel-ai-sdk) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S4a](../done/S4a-vercel-verify.md) |
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

None beyond S4a's examples.

## Docs to update

Root README; the SDK references plan; the roadmap (M1 done).

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `guide.md`, `fact-check.md` and `README.md` written with `/anthropic-skills:writing`, reviewed with `/anthropic-skills:writing-review`, and fixed. The review caught two false claims of mine: §11 said the harness verified no MCP package, and F8 said `experimental_toolApprovalSecret` appears on no page. Both were corrected against the source, and the approval-signing gotcha was added to the guide.
- Milestone M1 is done.
