# X8: Give the book-example transcript capture a Bun-compatible hook

| Field | Value |
| --- | --- |
| ID | `X8` |
| Status | `ready` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | M (a few hours) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that Bun has no `module.registerHooks`, the Node API `scripts/transcripts/source-condition.mjs:5` calls. Every test that imports through that module throws `SyntaxError: Export named 'registerHooks' not found in module 'node:module'` under Bun: `sdk/test/book-examples.test.ts` in full, `gateway/test/book-examples.test.ts`'s four cases, and almost certainly `harness`'s seven. This todo finds a Bun-compatible way to do whatever `source-condition.mjs` needs `registerHooks` for, so book examples can run under either runtime.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 2: the measured failures.
- `scripts/transcripts/source-condition.mjs`: read what it actually does with the hook (likely intercepting module resolution so book examples import packages' `source` export condition instead of `dist/`) before assuming a fix.
- Node's `module.registerHooks` docs, for the exact API surface being replaced.
- Bun's own module-resolution and plugin docs, for whatever stands in for it (`Bun.plugin`, or a loader argument).

## Scope

**In scope**

- Read `source-condition.mjs` fully and write down, in the todo or the PR, exactly what it uses the hook for.
- Find a Bun-compatible mechanism that does the same thing (a `Bun.plugin` resolver, a different import-condition mechanism, or a runtime check that picks the right approach per engine).
- Apply it so `sdk/test/book-examples.test.ts`, `gateway/test/book-examples.test.ts` and `harness`'s book-examples tests pass under both Node and Bun, with no change to what a book example itself imports.
- If no Bun-compatible mechanism exists, record that as the finding instead of forcing a workaround that changes example behavior.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7, X9–X15).
- Changing what a book example imports or how it's written; this todo only changes the *harness* that runs examples, not the examples themselves.

## Tasks

- [ ] Read `scripts/transcripts/source-condition.mjs` and document what it does with `registerHooks`.
- [ ] Research Bun's equivalent mechanism (`Bun.plugin`, a loader flag, or similar).
- [ ] Implement a runtime-aware version (same behavior under Node, a Bun-compatible path under Bun), or confirm none is possible.
- [ ] Run `sdk/test/book-examples.test.ts`, `gateway/test/book-examples.test.ts` and `harness`'s book-examples tests under both `node --test`/`vitest run` and `bun --bun x vitest run` / `bun test`, confirming all pass on both.

## Acceptance criteria

- [ ] `sdk`, `gateway` and `harness`'s `book-examples.test.ts` suites pass under both Node and Bun, or CI plan §3h's gap 2 is updated to say why they can't.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.

## Tests

The existing `book-examples.test.ts` suites in `gateway`, `sdk` and `harness` are the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 2.

## Risks and open questions

- `registerHooks` may be doing something Bun's module system has no equivalent for at all, in which case this stays a confirmed, permanent gap rather than a fix.
- **Who decides.** The owner decides how much investigation is worth it before accepting the gap as permanent.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
