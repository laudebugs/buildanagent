# X3: Make type-check results independent of TypeScript's spelling suggestions

| Field | Value |
| --- | --- |
| ID | `X3` |
| Status | `ongoing` |
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

- [ ] Normalize errors where each harness parses tsc output
- [ ] Rerun each harness's verify; confirm the fact-checks' counts are unchanged, or record any change in that fact-check
- [ ] Rerun `verify.yml` on GitHub and confirm the drift check passes

## Acceptance criteria

- [ ] `verify.yml` passes on GitHub with no result changes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The drift check itself, locally and on the runner.

## Docs to update

The CI plan; any fact-check whose counts move.

## Risks and open questions

Other non-determinism may surface once this is fixed; record it here.

## Definition of done

- [x] Claimed: created in `ongoing/`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
