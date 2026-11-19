# T27: An occasional live run against real APIs, with flow diffs and the last-comparison date

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T27` |
| Status | `ready` |
| Plan | [Book plan §5, BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md) |
| Size | M |

## Goal

Check now and then that the mock transcripts still match how the real APIs behave, without ever giving CI a key. A workflow the owner starts by hand runs selected examples against the real APIs with the owner's key and records live transcripts beside the mock ones. A script then reports differences in flow: the tool calls made, the stop reason and the `check()` results. Every listing page states that its listings are verified against mock models and gives the date of the last live comparison.

## Context

- [Book plan BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted): the owner's decision.
- [GitHub, environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): required reviewers, deployment branches, and secrets released only after approval.
- [`sdk-updates.yml`](../../../.github/workflows/sdk-updates.yml) and `scripts/ci/sdk-updates.mjs`: how a workflow opens pull requests with results in this repo.
- [AGENTS.md, running third-party code](../../../AGENTS.md#coding-standards) and the [SDK process](../../../AGENTS.md#process-for-documenting-an-sdk): allowlisted environments, and no model-called tool that touches the host.
- T5's transcript format and recorders.

## Scope

**In scope**

- A live mode in each covered harness: the example points at the real API with an explicit key, writes `results/live/<example>.json` in the transcript format and still runs its `check()` calls
- `live-run.yml`: `workflow_dispatch` only, one job in a protected `live-run` environment that requires the owner's approval and allows only `main`
- `scripts/ci/live-diff.mjs`: compares each live transcript's flow with its mock transcript
- An issue on any difference, and a pull request with the live transcripts and the run date
- The listing component's line: listings verified against mock models, with the last live comparison's date

**Out of scope** (and which todo covers it)

- Any provider call in CI's `ci.yml`, `verify.yml` or the book job (never, by BK18)
- Live editing in the browser (BK9 tier 4, later)

## Tasks

- [ ] **Owner prerequisite, not a builder task.** The owner creates the `live-run` environment with themselves as required reviewer and `main` as the only deployment branch, and adds two keys there as environment secrets, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (the owner's answer, 2026-11-19: "I'll add the OPENAI key too - added"). As of 2026-11-19 the three GitHub environments, `book-preview`, `book-production` and `live-run`, exist, and `live-run` holds both secrets, so this todo and T9 rely on those names; as of 2026-11-19 `live-run` has the owner as required reviewer and allows only protected branches (`main`); the pre-run check confirms both through the API before each run and stops if either is gone. No key ever passes through chat, a file or a log. This todo documents the exact names in `apps/book/README.md`.
- [ ] Run each harness on the provider its pinned packages reach (BK18's table): `claude-agent-sdk` on Anthropic natively; `openai-agents-sdk` on OpenAI natively; `copilot-sdk` through BYOK `provider` on either, with no GitHub sign-in and without its no-network namespace; `vercel-ai-sdk` and `cloudflare-agents` through the pinned `@ai-sdk/anthropic` 4.0.96 or `@ai-sdk/openai` 4.0.108; `langchain` through `@langchain/anthropic` 1.6.0 or `@langchain/openai` 1.8.0; and `pi` through `@earendil-works/pi-ai` 1.5.2. Keep `google-adk` mock-only: TypeScript 2.5.0 reaches Gemini only, and adding a provider package or a Gemini credential is a separate change the owner approves, not part of this todo.
- [ ] Choose the examples to run live from those harnesses: those Part I chapters replay, whose tools are in-process functions with no host access. List them in `apps/book/src/data/live-examples.json`, with the provider and model each uses.
- [ ] Add the live mode to each covered harness behind an explicit flag. Pass the key in an allowlisted environment, never `...process.env`. Deny built-in host tools by name and type, as the SDK process requires for mocks.
- [ ] Enforce the owner's cost rule (2026-11-19: "A run may cost at most $1, but should aim to be less than $.50"): before each model call, project its cost from the price catalog and a token estimate, as D9 and E5 do, and abort the run with a report when the next call would take the total past $1.00.
- [ ] Choose the examples, models and `maxTokens` so a run's projected total stays under the $0.50 target, and record that projection in `live-examples.json`.
- [ ] Write `live-diff.mjs`: compare the sequence of tool names and argument keys, the stop reason and each `check()` result; ignore text, ids and timing. Test it with `node --test`.
- [ ] Write `live-run.yml` with `on: workflow_dispatch` only, `permissions` limited to what opening one issue and one pull request needs, and actions locked in `actions.lock`.
- [ ] Make the workflow open an issue listing each flow difference, never fail on one, and open a pull request with the live transcripts and the run date, as `sdk-updates.yml` does.
- [ ] Show the line on every page with a listing: "Listings on this page are verified against mock models; last compared with live APIs on <date>", or "not yet compared with live APIs" before the first run. A listing from an excluded harness or example says "verified against mock models only" instead. Before the first run.

## Acceptance criteria

- [ ] No run can spend more than $1.00: a test with a fixture price table shows the run aborting, with a report, before the call that would cross the cap; the selected examples project under $0.50
- [ ] Every run's report shows the amount spent against the $1.00 cap and the $0.50 target
- [ ] `apps/book/README.md` names the `live-run` environment and the secrets `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` exactly, and `live-run.yml` references no other provider key
- [ ] `live-examples.json` names a provider for each listed example that its harness's pinned packages reach, and every listing from `google-adk` or an unlisted example shows "verified against mock models only"
- [ ] `live-run.yml` has `workflow_dispatch` as its only trigger and references the `live-run` environment; no other workflow references a provider-key secret
- [ ] `live-diff.mjs` reports a changed tool call, a changed stop reason and a changed `check()` result, and ignores changed text, in its tests
- [ ] A flow difference opens an issue and leaves the run green
- [ ] Every page with a listing shows the mock-verification line with the last live comparison's date, or says that none has run
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`node --test scripts/ci/*.test.mjs` for the diff script, with fixture transcripts for each kind of difference. The live run itself runs only by hand, and its first run is recorded in the pull request it opens.

## Docs to update

- `apps/book/README.md`: how to start a live run and read its issue
- [AGENTS.md](../../../AGENTS.md) layout: `live-run.yml` in the workflows line, and `results/live/` beside the other results
- Each covered harness's README: the live mode

## Risks and open questions

- **Cost.** Each run spends the owner's money; the pre-call cap stops any run at $1.00, the example choice aims under $0.50, and the report shows spent against both. A projection can undercount a long answer, so `maxTokens` bounds every call.
- **Key handling.** The key lives only in the protected environment, reaches only the approved job, and passes to each example through an allowlisted environment; transcripts must be scanned for the key before they are committed.
- **Nondeterminism.** Real models vary between runs, so the diff compares flow, not text, and one run's difference is a prompt to look, not proof of drift.
- **A difference opens an issue rather than failing CI**, by the owner's decision, so a provider's change never blocks unrelated work.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
