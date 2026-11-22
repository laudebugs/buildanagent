# T34: Example: tracing spans and an LLM judge

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T34` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T25 ("Evals, observability and release") has code behind its subject. The example shows a run's OpenTelemetry spans captured in memory, and a scripted judge model that scores an answer from 0.0 to 1.0 against a rubric with a pass-fail grade. The coverage review found the gap: no example covers spans or an LLM judge.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T25's todo, [T25](../done/T25-chapter-evals-observability-and-release.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T25's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Use the harness's pinned `@ai-sdk/otel` with an in-memory span exporter, pinned exactly under the version rule, and assert span names and token attributes.
- [x] Script a second mock model as the judge; assert that the grading code parses its score and grade and rejects malformed output.
- [x] Say in the example's header that the judge is scripted, so the example tests the grading code, not a model's judgement.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/vercel-ai-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/vercel-ai-sdk/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts` shows a run's OpenTelemetry spans held in memory and a scripted judge whose verdicts the grading code parses.

- **The spans form one tree.** A tool loop gives one agent span, a span for each step, and a span for each model call and tool call under the steps. The example checks the names, every parent link, the token counts on each model call (100 in, 20 out) and the total on the agent span (200 in, 40 out). Rows T34-1 to T34-7 in `docs/plans/reviews/fact-check-vercel-tracing-judge-example.md` check each claim against the pinned types and docs or the run.
- **The span exporter is a new pinned dependency.** `@opentelemetry/sdk-trace` 2.12.1, more than a week old, replaces `@opentelemetry/sdk-trace-base`, which npm marks deprecated in its favour.
- **The judge is scripted, and the header says so.** The example tests the grading code. The README lists the defects it rejects, and the pass mark is checked on both sides.
- **The transcript holds both models' calls.** Two agent calls and nine judge calls are recorded, and a second run wrote the same file.
