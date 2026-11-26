# X10: Make `catalog-staleness.test.mjs` run under Bun without `tsx`'s loader

| Field | Value |
| --- | --- |
| ID | `X10` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | S (one sitting) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `scripts/ci/catalog-staleness.test.mjs` fails to even start under Bun, `Cannot find module 'tsx://...'`, because `tsx` hooks into Node's own loader API to import `.ts` files and Bun ships its own, separate TypeScript loading that doesn't recognize `tsx`'s scheme. Bun can import `.ts` natively, so this todo removes the dependency on `tsx`'s loader for this one file rather than trying to make `tsx` itself work under Bun.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 4: the measured failure.
- `scripts/ci/catalog-staleness.test.mjs`: read exactly how and why it currently imports through `tsx` (likely to import a `.ts` source file directly, such as `packages/gateway/src/catalog.ts`).
- `package.json`'s `test` script for `scripts/ci`, to see where `tsx`'s loader is registered (a `--import tsx` flag or similar) and whether other test files share the same registration.

## Scope

**In scope**

- Find the exact import that needs `tsx`'s loader and confirm Bun can resolve the same `.ts` file natively (Bun has first-class TypeScript support with no loader needed).
- Remove or make conditional whatever registers `tsx`'s loader for this file, so it imports the same way under Bun without breaking the Node path.
- Confirm `catalog-staleness.test.mjs` passes under both `node --test` and `bun test`.
- Check whether any other `scripts/ci/*.test.mjs` file shares the same `tsx` registration and would need the identical fix; note them if so, even if fixing them is out of scope.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7–X9, X11–X15).
- Removing `tsx` as a dependency project-wide; only this one test file's import path is in scope.

## Tasks

- [ ] Read `catalog-staleness.test.mjs` and trace which import needs `tsx`'s loader.
- [ ] Confirm Bun resolves the same `.ts` import natively, with no loader.
- [ ] Remove or guard the `tsx` loader registration so both runtimes import the file correctly.
- [ ] Run `catalog-staleness.test.mjs` under both `node --test` and `bun test`.
- [ ] Check the other 14 `scripts/ci/*.test.mjs` files for the same `tsx` dependency; note any found in the PR, even if not fixed here.

## Acceptance criteria

- [ ] `scripts/ci/catalog-staleness.test.mjs` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `catalog-staleness.test.mjs` is the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 4.

## Risks and open questions

- If `tsx`'s loader is registered globally for all of `scripts/ci` rather than per-file, removing it for one file may require a more targeted fix (a per-file import instead of a global flag).
- **Who decides.** None expected; this is a small, mechanical fix.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
