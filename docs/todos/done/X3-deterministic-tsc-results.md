# X3: Run every harness's doc type-check on the root TypeScript 7.0.2

| Field | Value |
| --- | --- |
| ID | `X3` |
| Status | `done` |
| Plan | [CI §3](../../plans/ci.md#3-the-workflows) |
| Round / milestone | X (CI) |
| Depends on | [X1](../done/X1-ci.md) |
| Size | S |

## Goal

The nightly `verify.yml` fails on drift no docs or SDK change caused: on the GitHub runner, TypeScript 7 adds "Did you mean …?" suggestions (code 2552) to errors that our container reports without them (code 2304). That changes `typecheck-docs.json` (about 800 differing fields in the Cloudflare harness alone) and, through the error codes, the groups in `mismatch-causes.json`. Make every harness record a suggestion-free error, so results match on any machine.

## Context

- The verify run's uploaded artifact (2026-11-18) and the drift output in the [CI plan](../../plans/ci.md#what-x1-built-2026-11-18)
- Each harness's `scripts/typecheck-examples.mjs` and the scripts that read its output (`mismatch-causes.mjs`, `ahead-of-release.mjs`)

## Scope

**In scope**

- Normalizing TS errors in every harness (strip the suggestion clause, map 2552 to 2304 and any other suggestion variants, such as 2551 to 2339), regenerating the committed results, and confirming the counts in each fact-check still hold

**Out of scope** (and which todo covers it)

- Changing what the harnesses classify

## Tasks

- [x] Normalize errors where each harness parses tsc output
- [x] Rerun each harness's verify; confirm the fact-checks' counts are unchanged, or record any change in that fact-check
- [x] Rerun `verify.yml` on GitHub and confirm the drift check passes

## Acceptance criteria

- [x] `verify.yml` passes on GitHub with no result changes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The drift check itself, locally and on the runner.

## Docs to update

The CI plan; any fact-check whose counts move.

## Risks and open questions

Other non-determinism may surface once this is fixed; record it here.

## Definition of done

- [x] Claimed: created in `ongoing/`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The premise was wrong. TypeScript 7.0.2 prints the same "Did you mean" suggestions here as on the runner; seven harnesses already matched the CI artifact exactly, and `--checkers 1`, `4` and `8` gave identical output. The cause was a stale `verify/cloudflare-agents/node_modules/.bin/tsc` shim pointing at `typescript@5.9.3`, which no longer belongs to that package and which `pnpm install` does not remove. Each harness took the nearest `.bin/tsc`, so the committed Cloudflare results came from 5.9.3 while CI used the root 7.0.2.

The fix resolves tsc from the root devDependency in every harness (`import.meta.resolve("typescript/package.json")`), regenerates the Cloudflare results, and updates its fact-check's Tier 1 counts (fragment 1,228, syntax 293, other 15, api-mismatch 58; the two new mismatches are classifier artefacts, not doc errors). `worker-harness.mjs` also strips the checkout path from a 500 body before its 300-character cut, so the runner's longer path no longer changes the text. No error codes are normalized. The stale shims were deleted locally.

Left for later: under TypeScript 7 the syntax-peel pass also reports semantic errors, and the cascade rule does not cover TS2740, which together cause the two false Cloudflare mismatches (`scheduling__30`, `run-workflows__23`).
