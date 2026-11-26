# X12: Fix `sdk-updates.test.mjs`'s `assert.throws` misuse

| Field | Value |
| --- | --- |
| ID | `X12` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | S (one sitting) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `scripts/ci/sdk-updates.test.mjs:417` calls `assert.throws(fn, bad)` for several `bad` inputs including `""`, which Bun's `node:assert` shim rejects (`The argument 'error' may not be an empty object. Received ''`) while Node accepts it. But the real bug is older than Bun: a string second argument to `assert.throws` is a custom failure *message*, not an error matcher, so this call was never actually checking what `parseBumps` threw, under either runtime. This todo fixes the test to check the thrown error for real, which incidentally also makes it pass under Bun.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 6: the measured failure and the underlying test bug.
- Node's `assert.throws` docs: the difference between a string message argument and an error-matching argument (a constructor, a RegExp, or an object/function validator).
- `scripts/ci/sdk-updates.test.mjs`'s `parseBumps` and the loop at line 417, to see what each `bad` input is meant to prove.

## Scope

**In scope**

- Rewrite the `assert.throws(fn, bad)` calls so the second argument actually validates the thrown error (for example, a RegExp or validator function matching the expected message), with a separate string passed as `assert.throws`'s own third argument when a custom failure message is still wanted.
- Confirm the rewritten assertions still fail if `parseBumps` is reverted to not throw, so the test is proven to test something.
- Confirm the suite passes under both Node and Bun.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7–X11, X13–X15).
- Changing `parseBumps` itself; this is a test-only fix.

## Tasks

- [ ] Read the full loop at `scripts/ci/sdk-updates.test.mjs:417` and each `bad` input's intent.
- [ ] Rewrite each `assert.throws` call to validate the actual thrown error.
- [ ] Temporarily break `parseBumps` to confirm the rewritten assertions catch it, then revert.
- [ ] Run `sdk-updates.test.mjs` under both `node --test` and `bun test`.

## Acceptance criteria

- [ ] `scripts/ci/sdk-updates.test.mjs` passes under both Node and Bun.
- [ ] Each `assert.throws` call validates the thrown error, not just a message string.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `sdk-updates.test.mjs` is rewritten in place; no new test file.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 6.

## Risks and open questions

- None expected; this is a small, mechanical test fix.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
