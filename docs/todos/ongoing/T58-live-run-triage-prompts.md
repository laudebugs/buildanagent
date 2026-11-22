# T58: Make the live run's triage capstones ask for the gated step, and record the patch step's fix

| Field | Value |
| --- | --- |
| ID | `T58` |
| Status | `ongoing` |
| Plan | [Book plan §5, BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T27](../done/T27-book-live-run.md) |
| Size | S |

## Goal

The owner's first live run (workflow run 45026707288, 2026-11-22) failed in both provider jobs. All five listed triage capstones ended with a failed check, and then each job's "Write the patch" step exited 128, so no live transcript reached the report job and the run produced no comparison. This todo fixes what the repository can fix. It makes each capstone's prompt ask for the path its checks test, so a real model has a reason to call the gated tool. It also makes the one Cloudflare check that compared a value the model wrote compare only what the example fixes. The workflow's pathspec fix goes to the owner as a diff, because agents don't edit `.github/workflows/`.

## Context

- [`scripts/live/run.mjs`](../../../scripts/live/run.mjs) and [`scripts/ci/live-diff.mjs`](../../../scripts/ci/live-diff.mjs): a failed check is already recorded in the live transcript and reported as a difference, and the run exits 0 whatever the examples do.
- [`.github/workflows/live-run.yml`](../../../.github/workflows/live-run.yml): the "Write the patch" step and the report job's checkout use the pathspec `verify/*/results/live`.
- The five capstones in [`apps/manual/src/data/live-examples.json`](../../../apps/manual/src/data/live-examples.json) and their mock transcripts in `verify/<sdk>/results/transcripts/`.
- Chapter 6, [`testing-offline-and-a-first-agent.md`](../../../apps/manual/src/content/chapters/testing-offline-and-a-first-agent.md), which lists the AI SDK capstone in full and the other capstones' gate regions.

## Scope

**In scope**

- The prompts of the AI SDK, LangChain, Pi and OpenAI Agents SDK capstones, so each asks for the lookup, the gated action and the typed result in the order the checks expect
- The Cloudflare capstone's check on the escalation, which compared the `reason` the model wrote
- The mock transcripts those changes rewrite
- The workflow diff, handed to the owner

**Out of scope**

- Editing `.github/workflows/live-run.yml`, which the owner commits
- Running anything against a real provider; only the owner's next live run confirms the fix

## Tasks

- [ ] Read the failed run's logs and reproduce each example offline
- [ ] Show that the pathspec never matches a file under `results/live/`, whether or not one exists
- [ ] Change the prompts and the Cloudflare check, keeping every line number the book's regions use
- [ ] Rerun the harnesses and commit the rewritten mock transcripts
- [ ] Write the workflow diff

## Acceptance criteria

- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass
- [ ] `pnpm --filter @buildanagent/manual check:book` passes
- [ ] Every changed example passes offline against its mock

## Tests

Each harness's `pnpm test` runs its capstone against the mock; `scripts/ci/results-drift.mjs` checks that the committed transcripts match a fresh run.

## Docs to update

The book plan's todo table and status line.

## Risks and open questions

A real model may still choose a different path, such as asking the customer before it refunds. The live run records that as a difference in its issue, which is what the run is for. Only the owner's next run shows which examples now keep the mock's flow.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
