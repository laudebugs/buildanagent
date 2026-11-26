# X9: Fix `@earendil-works/pi-schema` resolution under Bun

| Field | Value |
| --- | --- |
| ID | `X9` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | M (a few hours) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `@earendil-works/pi-schema` fails to resolve under Bun's handling of the workspace's `source` export condition: `sdk/test/workerd-validator.test.ts` (a whole suite) and `cli/test/bin.test.ts` both fail with `Cannot find package '@earendil-works/pi-schema'` or `Cannot find module`, resolving fine under Node. This todo finds why Bun's resolver disagrees with Node's here and fixes it.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 3: the measured failures.
- `@earendil-works/pi-schema`'s own `package.json`: its `exports` map and whether it declares a `source` condition at all.
- The workspace root's own `tsconfig`/`package.json` resolution settings that establish the `source` condition in the first place.
- Bun's module-resolution docs, for how it orders and interprets custom export conditions versus Node's resolver.

## Scope

**In scope**

- Reproduce the failure directly (`bun --bun x node -e "require('@earendil-works/pi-schema')"` or the equivalent import, inside `sdk` and `cli`) and get the exact resolution error.
- Compare `@earendil-works/pi-schema`'s `exports` map against what Bun actually requests versus what Node requests, to find the mismatch.
- Fix it: either in this repo's resolution config (a condition order Bun respects), in how `sdk`/`cli` import the package, or by filing upstream against `@earendil-works/pi-schema` if the package's own `exports` map is the problem.
- Confirm `sdk/test/workerd-validator.test.ts` and `cli/test/bin.test.ts` pass under Bun once fixed.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7, X8, X10–X15).

## Tasks

- [ ] Reproduce the exact resolution failure under Bun and capture the error.
- [ ] Inspect `@earendil-works/pi-schema`'s `exports` map and this repo's condition-order config side by side.
- [ ] Identify the mismatch and the smallest fix (repo-side config, import-site change, or upstream package fix).
- [ ] Apply the fix and re-run `sdk/test/workerd-validator.test.ts` and `cli/test/bin.test.ts` under both Node and Bun.

## Acceptance criteria

- [ ] `sdk/test/workerd-validator.test.ts` and `cli/test/bin.test.ts` pass under both Node and Bun, or CI plan §3h's gap 3 is updated with a confirmed, cited reason they can't.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `workerd-validator.test.ts` and `bin.test.ts` suites are the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 3.

## Risks and open questions

- If the mismatch is in `@earendil-works/pi-schema`'s own `exports` map, the fix may need to land upstream, and then wait on a release.
- **Who decides.** The owner decides whether to file upstream or work around it locally if upstream will be slow.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
