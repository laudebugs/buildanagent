# X13: Rewrite `fact-check-log.test.mjs`'s `String.raw` fixtures for Bun

| Field | Value |
| --- | --- |
| ID | `X13` |
| Status | `done` |
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

- [x] Read the two fixtures at `scripts/ci/fact-check-log.test.mjs:91,102` (the todo said 92; the first fixture was at line 91) and what each is meant to test.
- [x] Rewrite each to avoid a literal non-ASCII character inside `String.raw`.
- [x] Confirm the rewritten fixtures still produce the same expected output under Node.
- [x] Run `fact-check-log.test.mjs` under both `node --test` and `bun test`.

## Acceptance criteria

- [x] `scripts/ci/fact-check-log.test.mjs` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node. Not ticked: `pnpm check` and `pnpm typecheck` pass locally, but root `pnpm test` needs Linux's `unshare`, so CI's run of it stands in (see Outcome).

## Tests

The existing `fact-check-log.test.mjs` is rewritten in place; no new test file.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 8.

## Outcome

- **The two fixtures are now ordinary double-quoted strings.** `scripts/ci/fact-check-log.test.mjs` lines 91 and 102 held `` String.raw`...✅...` ``. Under Bun 1.4.4, `String.raw` with ✅ yields the six characters `\u2705` (JSON-printed as `"\\u2705"`), so the two tests failed. The measured evidence covers ✅, – and —, not every non-ASCII character. The new strings double their backslashes (commit `b0fff06a`). Commit `da9cbcb4` adds a comment above the first fixture ("Plain strings, not String.raw, wherever a fixture holds ✅") that gives the reason and shifts the fixtures to lines 92 and 103. A trailing comment on the second fixture points back to that comment.
- **The tests read the same input, and `cells()` is unaffected.** Under Node each new string is `===` to its old `String.raw` value. `fact-check-log.mjs` is unchanged. Both fixtures go through `log()` and `cells()`, and the first test also calls `cells()` directly, so the passing suite re-confirms that `cells()` behaves the same.
- **Both runtimes pass.** Before: `bun test` gave 22 pass, 2 fail. After: `node --test` passes 24 of 24, and `bun test` passes 24 of 24 in three runs (Bun 1.4.4).
- **`RANGE_SEP` has the same pattern and depends on its string reaching `RegExp`.** `fact-check-log.mjs` line 45 writes `–` and `—` inside `String.raw`, and Bun rewrites them to escapes. The string goes to `RegExp`, which reads those escapes as the same dashes (`new RegExp(s).test(" – ")` is true under both runtimes), so the script behaves the same. Reading `\u2013` as the en dash is defined `RegExp` behaviour, so the script is correct, but it stays correct only while that string goes to `new RegExp`. [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) records it.
- **Root `pnpm test` was not run here, so its two checkboxes stay unticked.** It stops at `verify/copilot-sdk`, which needs Linux's `unshare` and can't run on macOS; CI runs it. `pnpm check` and `pnpm typecheck` passed locally.

## Risks and open questions

- None expected; this is a small, mechanical test fix.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step. Not ticked: `pnpm check` and `pnpm typecheck` pass locally, but root `pnpm test` needs Linux's `unshare`, so CI's run of it stands in (see Outcome).
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
