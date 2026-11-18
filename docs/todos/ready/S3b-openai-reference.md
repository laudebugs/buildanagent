# S3b: OpenAI Agents SDK: guide and fact-check, written and reviewed

| Field | Value |
| --- | --- |
| ID | `S3b` |
| Status | `ready` |
| Plan | [SDK references §4 S3](../../plans/sdk-references.md#s3-openai-agents-sdk) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S3a](../done/S3a-openai-verify.md) |
| Size | M |

## Goal

Write `docs/reference/openai-agents-sdk/guide.md` and `fact-check.md` from S3a's verified facts, run the writing review, fix every finding, and ship.

## Context

- S3a's results and examples
- The [Pi guide](../../reference/pi/guide.md) and [fact-check](../../reference/pi/fact-check.md) as the structure to mirror

## Scope

**In scope**

- The guide, the fact-check, `docs/reference/openai-agents-sdk/README.md`

**Out of scope** (and which todo covers it)

- The comparison (C1, C2)

## Tasks

- [ ] Draft both documents with `/anthropic-skills:writing`, marking each claim **[verified: NN]** or citing its upstream page
- [ ] Fact-check the drafts against the source and the package; correct and log anything wrong
- [ ] Run `/anthropic-skills:writing-review` on both documents
- [ ] Apply every fix, then re-check each changed claim against its source
- [ ] Update the root README SDK table and the plan's todo table
- [ ] Run the local checks and push

## Acceptance criteria

- [ ] Both documents exist, with thesis-first introductions and conclusion headings
- [ ] Every **[verified]** claim maps to a passing example
- [ ] The review's findings are all fixed
- [ ] Local checks pass

## Tests

None beyond S3a's examples.

## Docs to update

Root README; [SDK references plan §5](../../plans/sdk-references.md#5-todos).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
