# Q1: Turn on the strict compiler flags and the Biome caps the guidelines require

| Field | Value |
| --- | --- |
| ID | `Q1` |
| Status | `ongoing` |
| Plan | [Guidelines, Known gaps](../../guidelines/README.md#known-gaps) |
| Round / milestone | Q (code quality, added 2026-11-19) |
| Depends on | [B3](../done/B3-scripted-model.md) |
| Size | M |

## Goal

Make the compiler and Biome enforce the [TypeScript guideline](../../guidelines/typescript.md), so its rules stop depending on review alone, and fix the code they flag.

## Context

- [typescript.md](../../guidelines/typescript.md): the ten compiler flags, the portability rules and the Biome caps
- [Known gaps](../../guidelines/README.md#known-gaps): the first two rows, which this todo closes
- Lamina PDF's root `biome.json` and `tsconfig.base.json`, which the guideline adapts

## Scope

**In scope**

- `tsconfig.base.json`: add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax` and `erasableSyntaxOnly`, for `packages/*` only if `verify/*` would break
- Biome: `noExcessiveCognitiveComplexity` (15), `noExcessiveLinesPerFunction` (60, test files exempt), `useThrowOnlyError`, `noDefaultExport` and `noRestrictedGlobals` for DOM-only globals, as errors in `packages/`
- A portability test that fails on `node:*` imports, `Buffer`, `process`, `require` or `__dirname` in `packages/*/src`, outside the offline guards
- Splitting `assertStreamContract()` and `ScriptedModel`'s stream method into named steps if they break the caps

**Out of scope** (and which todo covers it)

- knip, dependency-cruiser and jscpd (Q2)
- The error classes' `code` and `isX()` guards (B11)

## Acceptance criteria

- [ ] `pnpm typecheck` passes with all ten flags on for `packages/*`
- [ ] `pnpm check` fails on a function in `packages/*/src` over complexity 15 or 60 lines, and on a `throw` of a non-`Error` (one test case each, removed after checking)
- [ ] The portability test fails when a `node:fs` import is added to `packages/gateway/src/types.ts`, and passes on `main`'s code
- [ ] The first two Known gaps rows are removed
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Tests

The portability test, under `packages/gateway/test/`.

## Docs to update

[typescript.md](../../guidelines/typescript.md) (drop the "as of November 2026" note on the flags), [Known gaps](../../guidelines/README.md#known-gaps), AGENTS.md coding standards if a command changes.

## Risks and open questions

`exactOptionalPropertyTypes` may conflict with how B3's `ScriptedModel` spreads options; fix the code, not the flag.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
