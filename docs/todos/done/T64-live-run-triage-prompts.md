# T64: Make the live list's triage capstones ask for the gated step their checks test, and hand the owner the workflow fix

| Field | Value |
| --- | --- |
| ID | `T64` |
| Status | `done` |
| Plan | [Book plan §5, BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T27](../done/T27-book-live-run.md) |
| Size | S |

## Goal

The owner's first live run (workflow run 45026707288, 2026-11-22) failed in both provider jobs. All five listed triage capstones ended with a failed check, and the patch step then exited 128, so the run produced no comparison. This todo fixes what the repository can fix. It makes each capstone's prompt ask for the path its checks test, so a real model has a reason to call the gated tool. It also changes the Cloudflare capstone's escalation check to compare only the customer, which the example fixes, and not the reason, which the model words itself. The result check still compares the priority, because the ticket describes a full outage and `p1` is right. The workflow's pathspec fix goes to the owner as a diff, because agents don't edit `.github/workflows/`.

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

- [x] Read the failed run's logs and reproduce each example offline
- [x] Show that the pathspec never matches a file under `results/live/`, whether or not one exists
- [x] Change the prompts and the Cloudflare check, keeping every line inside the book's regions where it was (the Cloudflare check sits below its file's only region, so the lines after it move)
- [x] Rerun the harnesses and commit the rewritten mock transcripts
- [x] Write the workflow diff

## Acceptance criteria

- [x] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass
- [x] `pnpm --filter @buildanagent/manual check:book` passes
- [x] Every changed example passes offline against its mock

## Tests

Each harness's `pnpm test` runs its capstone against the mock; `scripts/ci/results-drift.mjs` checks that the committed transcripts match a fresh run.

## Docs to update

The book plan's todo table and status line.

## Risks and open questions

A real model may still choose a different path, such as asking the customer before it refunds. The live run records that as a difference in its issue. Only the owner's next run shows which examples now keep the mock's flow.

## Outcome

**The patch step never matched a file.** A wildcard pathspec must match a whole path, so `'verify/*/results/live'` matches no file under that directory, and `git add` exits 128 even when the run wrote transcripts. The run did write the transcripts: the report counted each example's checks, and `run.mjs` reads those counts from the transcript. No change to `run.mjs` can fix the exit 128, because the pathspec misses files inside a directory even when it exists. The report job's `git checkout HEAD -- 'verify/*/results/live' …` has the same fault. The fix for both steps went to the owner as a diff of `live-run.yml`: stage `verify/`, diff `':(glob)verify/*/results/live/**'`, and check the transcripts out only when the commit changed one.

**Each capstone's prompt now asks for the path its checks test.** A failed check already reached the comparison (the recorder writes `pass: false`, `live-diff.mjs` reports it, and `run.mjs` exits 0), so the fix belongs in the prompts. Each real model made two calls, a lookup and an answer, where the mock made three. The LangChain, OpenAI Agents SDK and Pi prompts also ask for one escalation and a result whether or not a person allows it, because those examples always reject or block it, and a model that asked again would fail the call-order checks. The LangChain example reads its typed result with optional chaining, so a run that ends without one records the failed check instead of throwing a `TypeError` first. The Cloudflare capstone failed on a check that compared the escalation's reason, which a real model words itself. Its check now requires exactly one escalation, for customer C-9, whatever the reason says. The new check spans four lines, so the SDK README's code-line count for the Cloudflare capstone moved from 122 to 125.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
