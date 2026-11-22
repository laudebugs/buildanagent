# T65: Put our own SDK's triage agent in the book's live run, on both providers

| Field | Value |
| --- | --- |
| ID | `T65` |
| Status | `done` |
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

- [x] Claim the todo and record the design in BK18
- [x] Give each live transcript a provider folder, `results/live/<provider>/<example>.json`, and let the list name a file once per provider
- [x] Add `packages/sdk` to the live run's harness tables
- [x] Write the SDK's live mode: the runner, the live model behind `scripted()`, the guarded transport and the recorder
- [x] Make the triage agent ask for the path its checks test
- [x] List the example on both providers and recompute the projection
- [x] Test it offline against the stub, which learns OpenAI's Chat Completions API
- [x] Update the docs and hand over the workflow change

## Acceptance criteria

- [x] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass
- [x] `node --test scripts/ci/live-run.test.mjs` passes, including a run of our SDK's example against the stub on both providers
- [x] `pnpm --filter @buildanagent/manual check:book` passes, and Chapter 7's listings of our SDK's triage agent drop "verified against mock models only" once a run commits a live transcript of it (changed after the medium review: the criterion first asked for the caption to go before any run had compared the file, row T65-26)
- [x] `pnpm test` in `packages/sdk` still fails a book example that reaches a non-loopback host or runs with a provider key set

## Tests

`scripts/ci/live-run.test.mjs` runs the whole list, our SDK's entries included, against the loopback stub and compares each live flow with its mock. New tests check the SDK's live mode alone: it refuses a run without `run.mjs`'s environment, refuses a host tool and a call past the cap before it is sent, and keeps the offline setup in force for every fetch but its own provider's.

## Docs to update

The book plan (BK18 and the todo table), its fact-check log, `apps/manual/README.md` and the seven `verify/*` READMEs that name the live transcript's path. `packages/sdk/README.md` stays as it is, because it is the package's npm README and the live mode is repository tooling outside the published files. AGENTS.md's layout line still says `results/live/` without the provider folder; it is left for the owner, since this todo doesn't change agent instructions.

## Risks and open questions

A real model may still choose a different path, such as escalating without looking the customer up. The live run records that as a difference. Until the owner commits the workflow change, a run doesn't commit the SDK's live transcripts.

## Outcome

**Our SDK joins the live list as an eighth harness, on both providers.** `packages/sdk/examples/13-triage-agent.ts` is listed on `claude-haiku-5-5` and on `gpt-5.4-mini`, so one run sends the same agent through our gateway's Anthropic Messages adapter and its OpenAI Chat Completions adapter. The list projects $0.3247 a run, under the $0.50 target, and each provider's share stays far under its $0.50 half of the cap (fact-check rows T65-4 and T65-5).

**Each live transcript now has a provider folder.** One file on two providers needs two transcripts, and the two provider jobs' patches would otherwise collide on one path. So `results/live/<provider>/<example>.json` replaces `results/live/<example>.json` everywhere: `exampleOf()`, `run.mjs`, `live-diff.mjs`, the results-commit check and the transcript writer. The list may now name a file once per provider, its projection keys each entry by file and provider, and the live diff reports each entry's outcome by file and provider. The results-commit check refuses a transcript whose provider differs from its folder's, and the report job's `merge` step, before any patch applies, refuses a provider job's patch that touches anything but that provider's listed live transcripts, so one job can't write the other's folder. The five transcripts the owner's run of 2026-11-22 committed moved, unchanged, into their folders (rows T65-6, T65-11, T65-12, T65-14 and T65-17).

**Every live-run guarantee holds.** The key reaches the example only in the file `run.mjs` writes, which `scripts/live/live.ts` reads and deletes; the runner's environment is an allowlist. Our gateway's real adapter receives the key explicitly and sends HTTP only through `ProviderConfig.transport`, the gateway's own seam, so no package code is patched. Before each request leaves, the transport refuses any endpoint but the provider's, a host tool, another model, an output allowance above `maxTokens`, a body field outside the adapter's known set and an OpenAI `n` other than 1, and checks the cost guard against the catalog. Our adapters stop reading at the answer's final event and cancel the body, so the transport settles the guard there, from the streamed usage. An answer that ends, fails or is cancelled before its final event costs its projection, whatever usage it streamed so far. Our gateway retries a request that fails before any output, and the transport charges every attempt, a refused one at its projection, while the examples' `calls` and the transcript count only the run's calls, so a 429 that succeeds on retry changes neither the checks nor the flow. It passes on none of the provider's headers but a failed answer's numeric retry delays. When the example times out, its runner deletes the earlier live transcript, so the report never shows an old run as this one. The examples' offline setup still loads, after the live mode has kept the process's own fetch: a provider key variable still stops an example, every other `fetch` still reaches only the loopback interface, and real model requests turn on only when the live model is built (rows T65-2, T65-3, T65-13, T65-15, T65-16 and T65-20 to T65-22).

**The triage agent asks for the path its checks test.** As T64 did for the verify capstones, the ticket now asks the model to look the customer up, escalate and submit the triage, and the escalation check passes for exactly one escalation with a non-empty reason instead of comparing the reason the script wrote (row T65-18). The line numbers stay as they were, so the book's regions and notes don't move.

**No gateway example joins the list.** Every SDK call runs through the gateway's adapter, its stream parser, its usage normalisation and its pricing, and each Anthropic call carries the gateway's cache breakpoints, so the SDK's run already exercises the gateway's live path and records the usage the provider reports. The gateway's own two examples check the exact text and token counts their scripts stream, which a real model doesn't reproduce (rows T65-8 and T65-9).

**The workflow needs one change from the owner.** `live-run.yml` stages only `verify/` and diffs only `verify/*/results/live/**`, so until it also stages `packages/` and diffs `packages/*/results/live/**` a run commits none of the SDK's live transcripts (row T65-10). Until then the comparison reports both SDK entries as missing a committed transcript, saying that the run reached them, and opens its issue on every run (row T65-25). The same change should run `live-run.mjs patch` on each artifact before its patch applies: `merge` reads every artifact's patch only when at least one artifact carries a report, so a run in which neither job left one applies its patches unchecked by job (row T65-14). The whole updated file went to the owner with this todo's report.

**What only a real run can confirm:** that `gpt-5.4-mini` accepts the gateway's Chat Completions request with tools and `max_completion_tokens`, that both providers stream the usage the guard settles from, and that a real model keeps the mock's three calls.

**A listing counts as compared only once its live transcript is committed.** The book first counted every listed file as compared, so Chapter 7's captions of our triage agent dropped "verified against mock models only" before any run had compared it (row T65-26). Now a listed file counts only once a run has committed its live transcript on at least one provider, and only such an entry can move the comparison date. Until the workflow change lands and a run commits the SDK's transcripts, Chapter 7's listings of our triage agent keep the mock-only caption, and their entries neither move the date nor hold it back (rows T65-23 and T65-24).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
