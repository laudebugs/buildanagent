# X15: Root-cause `live-run.test.mjs`'s confirmed Bun failures

| Field | Value |
| --- | --- |
| ID | `X15` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | M (a few hours) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `scripts/ci/live-run.test.mjs` has 5 confirmed, Bun-only failures (of its 7 total; the other 2 need Linux's `unshare -rn` and fail under Node too). None of the 5 were individually root-caused — X6 only confirmed they're real and distinct from the file's separate, pre-existing Node-side hang (a promise left pending after the event loop resolves, unrelated to Bun). This todo finds each failure's actual cause and fixes what it can.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 9: the measured failures and the separate Node-hang note.
- `scripts/ci/live-run.test.mjs`: read what each of the 5 failing tests actually exercises (real timers, a cost-cap retry loop, per X6's notes).
- Whatever gaps X7–X13 fix: check whether any of the 5 failures are instances of those causes before assuming a sixth, distinct one.

## Scope

**In scope**

- Run `scripts/ci/live-run.test.mjs` under `bun test` and identify the 5 failing tests by name.
- For each, reproduce it individually (`bun test --test-name-pattern=...` or equivalent) and capture its actual error.
- Classify each: an instance of a gap X7–X13 already fixes, or a new, distinct Bun gap.
- Fix what's cheaply fixable; record anything that needs a larger fix or looks like a permanent Bun limitation.
- Update CI plan §3h's gap 9 with the individual causes, replacing "not yet individually root-caused."

**Out of scope** (and which todo covers it)

- The file's separate Node-side hang bug (the pending-promise issue); that's a pre-existing Node bug unrelated to Bun and not part of this todo's scope.
- The 2 failures that need Linux's `unshare -rn`; those are pre-existing and already explained.
- Any other X6 gap (X7–X14).

## Tasks

- [ ] Run `live-run.test.mjs` under `bun test`; list the 5 failing test names.
- [ ] Reproduce and diagnose each individually.
- [ ] Cross-check each against X7–X13's fixes to rule out duplicates.
- [ ] Fix what's fixable; record the rest with a cited cause.
- [ ] Update CI plan §3h's gap 9.

## Acceptance criteria

- [ ] Each of the 5 confirmed Bun failures in `live-run.test.mjs` has an individually recorded cause in CI plan §3h: fixed, a duplicate of another gap, or a confirmed, cited new gap.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

`scripts/ci/live-run.test.mjs`'s existing suite is the evidence; no new tests unless a fix needs one to avoid regressing.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 9.

## Risks and open questions

- Some of the 5 may turn out to be timing-sensitive (real timers, a cost-cap retry loop) rather than deterministic, which would make them harder to fix cleanly than the other gaps.
- **Who decides.** The owner decides how much investigation each failure is worth before accepting it as a permanent gap.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
