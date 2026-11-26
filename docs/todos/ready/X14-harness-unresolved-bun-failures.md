# X14: Root-cause `harness`'s remaining Bun failures

| Field | Value |
| --- | --- |
| ID | `X14` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6, X7, X8 |
| Size | L (a day: split it if you can) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured 34 Bun-only failures in `packages/harness` (plus a jump from 104 to 160 skipped tests), but only root-caused 8 of them (the Cloudflare test, attributed to gap 1) with any confidence; about 26 more, spread across `test/server/stdio.test.ts`, `test/mcp/hardening.test.ts`, `test/server/framing-interop.test.ts`, several `*-second-process.test.ts` files, `test/sandbox/none.test.ts`, `test/extensions/skills.test.ts` and `test/capstone.test.ts`, were only grouped by file, not individually diagnosed. This todo finds out which of them are instances of gaps already fixed by [X7](X7-bun-miniflare-workerd.md) and [X8](X8-bun-module-registerhooks.md), and root-causes whatever is left.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26): the full per-file failure grouping and the skip-count jump (104 → 160).
- [X7](X7-bun-miniflare-workerd.md) and [X8](X8-bun-module-registerhooks.md): run this todo after both land, so failures their fixes resolve aren't re-investigated here.
- `harness`'s own test files listed above, for what each actually exercises (stdio framing, MCP hardening, sandboxing, second-process permission checks, skills, the capstone end-to-end test).

## Scope

**In scope**

- Re-run `packages/harness`'s suite under Bun after X7 and X8 land, to see how many of the 34 failures remain.
- For each remaining failure, find its root cause: a new Bun gap, or an instance of a cause X6 already found elsewhere (Miniflare/workerd, `registerHooks`, `pi-schema`, the allowlisted-`PATH` gap) that happens to also touch `harness`.
- Explain the skip-count jump from 104 to 160: find which test file's `describe`/setup throws before its cases register under Bun, hiding failures that a bare skip count doesn't show.
- Record every remaining failure's cause in CI plan §3h, replacing the current "not individually root-caused" note.
- Fix what's cheaply fixable; for anything that needs its own larger fix, split it into a further todo (X16 onward) rather than scope-creeping this one.

**Out of scope** (and which todo covers it)

- Fixing gaps 1–8 themselves (X7–X13); this todo only re-measures `harness` after they land and investigates what's left.

## Tasks

- [ ] Confirm X7 and X8 have landed; re-run `packages/harness`'s suite under Bun.
- [ ] For each remaining failing file, reproduce one failing test with verbose output and trace its actual error.
- [ ] Find the cause of the skip-count jump (104 → 160): which file's setup throws under Bun before registering its cases.
- [ ] Classify every remaining failure: instance of an existing gap, or new.
- [ ] Fix what's cheap; split anything larger into a new todo.
- [ ] Update CI plan §3h's `harness` row and its "not individually root-caused" note with the final count and causes.

## Acceptance criteria

- [ ] Every one of `harness`'s Bun failures (after X7 and X8 land) has a recorded cause in CI plan §3h: fixed, a known gap, or a new todo.
- [ ] The skip-count jump from 104 to 160 is explained.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

`packages/harness`'s existing suite is the evidence; new tests only if a fix needs one to avoid regressing.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), the `harness` table row and the "not individually root-caused" note.

## Risks and open questions

- This may surface more gaps than X6 counted, since the skip-count jump suggests some failures are currently hidden.
- **Who decides.** The owner decides how far to split further fixes versus accepting some failures as permanent Bun gaps.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
