# T65: Put our own SDK's triage agent in the book's live run, on both providers

| Field | Value |
| --- | --- |
| ID | `T65` |
| Status | `ongoing` |
| Plan | [Book plan §5, BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T27](../done/T27-book-live-run.md), [T49](../done/T49-book-http-mock-transcripts.md), [T61](../done/T61-chapter-testing-offline-and-a-first-agent-on-our-packages.md), [T64](../done/T64-live-run-triage-prompts.md) |
| Size | M |

## Goal

The book's occasional live run compares real model flows with the mock transcripts, but it knows only the `verify/*` harnesses. Our own SDK's triage agent, which Chapter 7 lists in full, is still "verified against mock models only". This todo gives `packages/sdk` a live mode and lists its triage agent on Anthropic and on OpenAI, so the same example runs through our gateway's two adapters against real APIs. Every guarantee the live run already makes stays in force: the key arrives only in a file, a cost guard checks each call before it is sent, and ordinary tests stay offline.

## Context

- [Book plan BK18](../../plans/build-book.md#bk18-an-occasional-live-run-compares-real-flows-with-the-mock-transcripts-accepted): the live run's decisions, cost cap and the harness table.
- [`scripts/live/`](../../../scripts/live/): `run.mjs` runs the list, `config.mjs` checks it, `live.ts` reads the key and holds the cost guard's entry points, `budget.ts` prices calls, `harness.mjs` gives a runner its `--live` mode.
- [`scripts/ci/live-diff.mjs`](../../../scripts/ci/live-diff.mjs) and [`scripts/ci/live-run.mjs`](../../../scripts/ci/live-run.mjs), with their tests in [`scripts/ci/live-run.test.mjs`](../../../scripts/ci/live-run.test.mjs).
- [`packages/sdk/examples/13-triage-agent.ts`](../../../packages/sdk/examples/13-triage-agent.ts) and its mock transcript in `packages/sdk/results/transcripts/`.
- [`packages/gateway/src/runtime-types.ts`](../../../packages/gateway/src/runtime-types.ts): `ProviderConfig.transport`, the seam through which an adapter sends HTTP.
- [`apps/manual/README.md`, "Changing the live list"](../../../apps/manual/README.md#changing-the-live-list).

## Scope

**In scope**

- A live mode for `packages/sdk`'s book examples: a runner, `packages/sdk/scripts/run-examples.mjs`, that only `scripts/live/run.mjs` drives, and a live branch of the examples' `scripted()` helper that sends each call through our gateway's real adapter
- The live list's checks accepting a `packages/*` example and the same file on both providers, with each provider's live transcript in its own folder
- The triage agent's prompt and escalation check, so a real model has a reason to escalate and the check doesn't compare the reason the model words itself
- The list entries, the recomputed projection and the book's marks
- Tests next to the live run's existing tests

**Out of scope**

- Editing `.github/workflows/live-run.yml`: the owner commits the change this todo hands over
- A gateway example in the list (see the outcome for why)
- Running anything against a real provider: only the owner's next live run does that

## Tasks

- [ ] Claim the todo and record the design in BK18
- [ ] Give each live transcript a provider folder, `results/live/<provider>/<example>.json`, and let the list name a file once per provider
- [ ] Add `packages/sdk` to the live run's harness tables
- [ ] Write the SDK's live mode: the runner, the live model behind `scripted()`, the guarded transport and the recorder
- [ ] Make the triage agent ask for the path its checks test
- [ ] List the example on both providers and recompute the projection
- [ ] Test it offline against the stub, which learns OpenAI's Chat Completions API
- [ ] Update the docs and hand over the workflow change

## Acceptance criteria

- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass
- [ ] `node --test scripts/ci/live-run.test.mjs` passes, including a run of our SDK's example against the stub on both providers
- [ ] `pnpm --filter @buildanagent/manual check:book` passes, and Chapter 7's listings of our SDK's triage agent no longer say "verified against mock models only"
- [ ] `pnpm test` in `packages/sdk` still fails a book example that reaches a non-loopback host or runs with a provider key set

## Tests

`scripts/ci/live-run.test.mjs` runs the whole list, our SDK's entries included, against the loopback stub and compares each live flow with its mock. New tests check the SDK's live mode alone: it refuses a run without `run.mjs`'s environment, refuses a host tool and a call past the cap before it is sent, and keeps the offline setup in force for every fetch but its own provider's.

## Docs to update

The book plan (BK18 and the todo table), `apps/manual/README.md`, `packages/sdk/README.md`, the seven `verify/*` READMEs that name the live transcript's path, and AGENTS.md's layout line.

## Risks and open questions

A real model may still choose a different path, such as escalating without looking the customer up. The live run records that as a difference. Until the owner commits the workflow change, a run doesn't commit the SDK's live transcripts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
