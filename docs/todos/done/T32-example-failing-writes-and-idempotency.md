# T32: Example: failing writes, idempotency keys and a crash between persist and execute

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T32` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T23 ("Side effects that can fail: outcomes, idempotency and plan approvals") has code behind its subject. The example shows a write tool that reports one of the five outcomes, an idempotency key persisted before the call, and a resume after a killed process that reports `unknown`, reconciles and writes once. The coverage review found the gap: Chapter T23's listings are both approval pause-and-resume, one repeats Chapter T14's, and no example shows outcomes, idempotency or the crash.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T23's todo, [T23](T23-chapter-side-effects-that-can-fail.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T23's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Write a small effect log inside the example (no package yet; E1–E4b replace it later).
- [x] Run the write in a child process and kill it between persisting the effect and recording the result; resume in a fresh process.
- [x] Assert that the resume reports `unknown`, reconciles against a fake server, and that the fake server saw exactly one write.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host beyond loopback and one effect log in a temp folder that the example makes and removes (the crash needs a log that outlives a process)
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
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts` shows a write tool that persists an idempotency key before it calls the server, reports an outcome, and survives a crash between the server's write and its result.

- **Three outcomes are shown.** A normal write reports `applied`, a repeat of it is answered from the log with no request, a write the fake server declines with a 402 reports `not_applied`, and a key whose last log entry is a start reads `unknown`. Any other failure, such as a 503, stays `unknown`. The type names all five outcomes, taken from the safety package's `OutcomeKind`.
- **The crash is real.** A child process runs the same tool and sends itself `SIGKILL` after the server replied and before it logged the outcome. The example asserts the exit signal, then that the key's last log entry is a start with no outcome.
- **The resume writes nothing twice.** A fresh run reads the log, asks the server, reports `applied` with `reconciled: true`, and the server received exactly one write request for the order, counted apart from its deduplicated writes.
- **The effect log is the example's own.** It is a JSON-lines file with two helpers. The AI SDK has no idempotency feature (row T32-2 in `docs/plans/reviews/fact-check-vercel-write-crash-example.md`), so the example shows what the tool must do around the SDK, and the chapter's switch todos replace the log with the safety package's.
- **The transcript holds the parent's calls only.** The child runs without `TRANSCRIPT_FILE`, so the recorder stays off there.
