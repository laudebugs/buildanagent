# X10: Make `catalog-staleness.test.mjs` run under Bun without `tsx`'s loader

| Field | Value |
| --- | --- |
| ID | `X10` |
| Status | `done` |
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

- [x] Read `catalog-staleness.test.mjs` and trace which import needs `tsx`'s loader.
- [x] Confirm Bun resolves the same `.ts` import natively, with no loader.
- [x] Remove or guard the `tsx` loader registration so both runtimes import the file correctly.
- [x] Run `catalog-staleness.test.mjs` under both `node --test` and `bun test`.
- [x] Check the other 14 `scripts/ci/*.test.mjs` files for the same `tsx` dependency; note any found in the PR, even if not fixed here.

## Acceptance criteria

- [x] `scripts/ci/catalog-staleness.test.mjs` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `catalog-staleness.test.mjs` is the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 4.

## Risks and open questions

- If `tsx`'s loader is registered globally for all of `scripts/ci` rather than per-file, removing it for one file may require a more targeted fix (a per-file import instead of a global flag).
- **Who decides.** None expected; this is a small, mechanical fix.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`scripts/ci/catalog-staleness.test.mjs` now starts and passes under Bun, because Bun imports the gateway catalog with no `tsx` loader.

- **Cause.** The test loaded `packages/gateway/src/catalog.ts` with a static `import { tsImport } from "tsx/esm/api"`. `tsx` registers hooks on Node's module loader, so under Bun the import failed with `Cannot find module 'tsx://...'`, and the run ended at 0 pass, 1 fail, 1 error. Node needs `tsx` here because the source's relative imports use `.js` specifiers that Node's type stripping doesn't map back to `.ts`.
- **Fix.** Commit `f83841de` replaces the static import with `process.versions.bun ? await import(CATALOG_SOURCE) : await (await import("tsx/esm/api")).tsImport(CATALOG_SOURCE, import.meta.url)`, with a comment that gives the reason. Under Bun 1.4.4 the plain import loads the source, whose relative imports use `.js` specifiers, with no loader: a one-line Bun script importing the file returned a `staleCatalogEntries` function.
- **Runs (Bun 1.4.4).** `node --test scripts/ci/catalog-staleness.test.mjs` passes 6 of 6, and `bun test` passes 6 of 6 in three runs.
- **Other files.** Two more files in `scripts/ci/` use `tsx`, and neither calls `tsImport`, so this fix doesn't apply: `transcripts.test.mjs:209` passes `--import tsx` to a spawned `node`, and `live-run.test.mjs:536` resolves `tsx` to run child processes. The other 12 test files don't mention it. Gaps 1 to 9 other than gap 4 stay with their own todos.
- **Docs.** [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) gap 4 records the fix, the todo table shows X10 as done, and fact-check rows X10-1 to X10-5 in [`fact-check-ci.md`](../../plans/reviews/fact-check-ci.md) cover the new claims.
- **Checks.** The `pnpm check`, `pnpm typecheck` and `pnpm test` box stays unticked. `pnpm check` and `pnpm typecheck` pass locally, but the root `pnpm test` stops at `verify/copilot-sdk` on macOS, which lacks `unshare`, so CI has to run it. `.github/workflows/ci.yml` runs the root `pnpm test` (`pnpm -r --if-present test`, which skips `scripts/ci/*.test.mjs`) and, in a separate step named "Test the CI scripts and the packed packages", `node --test scripts/ci/*.test.mjs`, which covers this file.

The two code-review rounds and the writing review are still to run on the pull request.
