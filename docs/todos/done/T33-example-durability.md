# T33: Example: state that survives a restart and a scheduled wake

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T33` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/cloudflare-agents/examples/` so Chapter T24 ("Durable and portable agents, and how work reaches them") has code behind its subject. The example shows an agent whose SQL state and schedule survive hibernation and a restart in workerd. The coverage review found the gap: `05-think.ts` shows the Think turn API, not durability, and `verify/` has no AWS or Vercel harness.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T24's todo, [T24](T24-chapter-durable-and-portable-agents.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/cloudflare-agents/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T24's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Write the example in the Cloudflare harness's workerd test setup: write state, schedule a wake, hibernate, and assert both after the wake.
- [x] Write in the harness README, and in Chapter T24's todo, that AWS and Vercel durability is not runnable in `verify/`, and point at N47 and N48 for when it will be.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/cloudflare-agents`, and the root `pnpm test`.

## Docs to update

- `verify/cloudflare-agents/README.md`: the new example
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

`verify/cloudflare-agents/examples/10-durable-wake.ts` shows an agent whose state and schedule survive eviction, and whose schedule wakes the evicted agent with no request.

- **The wake is real.** The agent stores a note in `this.state` and schedules a callback. The harness evicts the Durable Object, the example sends no request for 6.5 seconds, and the callback's row shows it ran on a new instance (its start count is 2, which the example checks) before the example's first read.
- **State and schedule survive, memory does not.** After the wake the note is back from storage, the in-memory field is 0, the callback ran once with its payload, and the one-shot schedule is removed. Rows T33-1 to T33-5 in `docs/plans/reviews/fact-check-cloudflare-durable-wake-example.md` check each claim against the pinned docs or the run, and the log says which.
- **It adds to `03-scheduling.ts` and `08-hibernation.ts`.** Those show a schedule firing and state surviving eviction apart. This one joins them: the alarm fires into an evicted object.
- **AWS and Vercel stay prose.** `verify/` has no AWS or Vercel harness, so the harness README and Chapter T24's todo say so and name N47a and N48a as where those behaviours get built.
- **No transcript.** The example makes no model call, so the recorder has nothing to write.
