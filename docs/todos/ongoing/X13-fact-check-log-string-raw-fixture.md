# X13: Rewrite `fact-check-log.test.mjs`'s `String.raw` fixtures for Bun

| Field | Value |
| --- | --- |
| ID | `X13` |
| Status | `ongoing` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | S (one sitting) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `scripts/ci/fact-check-log.test.mjs`'s two failures both come from fixtures written as `` String.raw`...✅...` ``: Bun's transpiler mangles the literal ✅ before `String.raw` ever sees it, turning it into the six characters `✅` instead of the real character. This is a quirk in the *test file's own source*, not in `fact-check-log.mjs` itself, which behaves identically on both runtimes. This todo rewrites the two fixtures to avoid the pattern, with no change to the script under test.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 8: the measured failure and its confirmed cause.
- `scripts/ci/fact-check-log.test.mjs:92,102`: the two fixtures to rewrite.
- `scripts/ci/fact-check-log.mjs`'s `cells()` function: confirm it is genuinely unaffected (X6 already did; re-confirm with the fix).

## Scope

**In scope**

- Rewrite the two `String.raw` fixtures at lines 92 and 102 so they hold the same test input without a literal non-ASCII character inside a `String.raw` template literal (for example, using `✅` directly in the source instead of the real ✅, or building the string with a plain (non-raw) template literal, or string concatenation).
- Confirm both fixtures still exercise the same code path and produce the same expected result.
- Confirm the suite passes under both Node and Bun.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7–X12, X14–X15).
- `fact-check-log.mjs` itself; it needs no change.

## Tasks

- [ ] Read the two fixtures at `scripts/ci/fact-check-log.test.mjs:92,102` and what each is meant to test.
- [ ] Rewrite each to avoid a literal non-ASCII character inside `String.raw`.
- [ ] Confirm the rewritten fixtures still produce the same expected output under Node.
- [ ] Run `fact-check-log.test.mjs` under both `node --test` and `bun test`.

## Acceptance criteria

- [ ] `scripts/ci/fact-check-log.test.mjs` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `fact-check-log.test.mjs` is rewritten in place; no new test file.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 8.

## Risks and open questions

- None expected; this is a small, mechanical test fix.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
