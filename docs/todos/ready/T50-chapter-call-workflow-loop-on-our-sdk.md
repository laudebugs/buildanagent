# T50: Move Chapter 1's listings onto our own SDK

| Field | Value |
| --- | --- |
| ID | `T50` |
| Status | `ready` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T10](../done/T10-chapter-call-workflow-loop.md), [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Move the listings of Chapter 1, "Use the least autonomy that works: a call, a workflow, then a loop" (`call-workflow-loop`), from the `verify/` examples onto `@buildanagent/gateway` and `@buildanagent/sdk`. BK8 says the chapters list `verify/` code until our own packages can show the same thing. It also says that the pull request which completes a chapter's last `switchTo` todo opens this follow-up. Chapter 1's only `switchTo` todo is B11, the loop core, and `book:switch-report` now prints "Chapter 1 (call-workflow-loop): B11 done; ready to move to our own packages." The reader then learns the loop from the code the rest of the book builds on.

## Context

- [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted): the switch rule, and the note that this todo first widens the listing rule to name `packages/`.
- [Book plan BK9's T4 result](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed): a listing must sit in a harness that `apps/manual/src/data/harnesses.json` lists, with an exact pin, so a listing from `packages/` fails today as "in no harness".
- [T10's Outcome](../done/T10-chapter-call-workflow-loop.md#outcome): the chapter's six listings, its four replays, its figures and its fact-check log.
- [B11's Outcome](../done/B11-loop-core.md#outcome): what the loop core delivered: `run()`, `runOrThrow()`, the `RunResult` union with its stop reasons, the closed `AgentEvent` union, and `maxSteps`, which defaults to 20 and counts model calls.
- `packages/sdk/README.md`, `packages/gateway/README.md` and `packages/sdk/examples/`: the existing order-agent example, which `packages/sdk/test/examples.test.ts` runs, shows how we write our examples and run them offline.
- `apps/manual/src/book/transcripts.ts` and `scripts/transcripts/`: the transcript format a replay reads, which today only `verify/*/results/transcripts/` supplies.

## Scope

**In scope**

Each listing in `apps/manual/src/content/chapters/call-workflow-loop.md`, and what replaces it:

| Listing | Today | On our packages |
| --- | --- | --- |
| `#one-call` (replay) | `verify/vercel-ai-sdk/examples/01-generate-text.ts`, region `call` | One gateway `complete()` call (B4) |
| `#workflow` (replay) | `verify/google-adk/examples/02-workflow-agents.ts`, region `sequential` | A writer call, then a reviewer call, in an order plain TypeScript sets; our SDK has no workflow agent class, so the code itself is the workflow |
| `#weather-tool` | `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, region `tool` | The same tool on `defineTool()` (B10) |
| `#tool-loop` (replay) | `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, region `loop` | `run()` with that tool and an explicit `maxSteps` (B11) |
| `#scripted-mock` | `verify/vercel-ai-sdk/examples/lib/check.ts`, region `scripted` | `ScriptedModel` from `@buildanagent/sdk/testing` (B3) |

- New examples under `packages/sdk/examples/` (or `packages/gateway/examples/` for the one call), with `// #region` and `// book:note` markers, run offline by the package's `test`.
- Widen the listing rule so a listing may come from `packages/`, in three places: the coverage check, the harness table (or a sibling table) and the caption's pin. For our packages, the pin is the workspace version (`0.1.0-alpha.4` as of November 2026) rather than an exact third-party pin.
- Transcripts for the new examples, in the format of `scripts/transcripts/events.ts`, recorded by the package's tests and committed beside those tests. The transcripts keep the three replays working, and the results-drift check covers them.
- The prose around each listing and its notes, the exercises, the "How these examples run without a key" section, and the inline code that names `generateText`, `stopWhen`, `SequentialAgent` or `LoopAgent`, each of which must resolve again under BK17.
- `figures/call-workflow-loop/loop-bench.ts`: it lights six steps in the order of the AI SDK loop's transcript, so check that order against the new transcript and redraw if it differs.

**Out of scope** (and which todo covers it)

- `#pi-hello` (`verify/pi/examples/01-hello-session.ts`): the chapter shows a harness keeping a session and bringing its own tools, which our harness does only once its session runner lands ([N6](N6-session-runner.md)). The listing stays on Pi until a later todo moves it; if the owner wants that move, the chapter's `switchTo` gains N6.
- The other chapters' listings: each moves in its own follow-up when its `switchTo` todos are done.

## Tasks

- [ ] Widen the listing rule to accept `packages/`, with a test for a listing from `packages/sdk/examples/` and one for a file in no package, and update `apps/manual/README.md` and BK9's T4 result.
- [ ] Add a transcript recorder for our packages' examples, writing transcripts in the existing format, and commit the transcripts.
- [ ] Write the five replacement examples with their regions and notes, each run offline by the package's `test`.
- [ ] Switch each listing in the table above, rewrite its notes and the prose that names AI SDK or ADK identifiers, and keep each replay.
- [ ] Rewrite the exercises for `run()` and `maxSteps`, and keep the call-count prediction.
- [ ] Check `loop-bench`'s step order against the new loop transcript; rebuild and audit the figure if it changes.
- [ ] Fact-check every changed claim into `apps/manual/fact-checks/call-workflow-loop.md` as a new block, with corrections as their own rows, and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] Every listing in the table above comes from `packages/`, and `#pi-hello` is the chapter's only `verify/` listing
- [ ] The notes on each switched listing describe the new code, and the three replays on switched listings read our packages' committed transcripts
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [ ] The fact-check log has a block of rows for the switch, and its tally matches its rows
- [ ] The pull request records the writing review's 5C scores, before and after
- [ ] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, and `figures:audit` pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The listing-rule tests in `apps/manual/test/`, the new examples in `packages/sdk/test/examples.test.ts` (or the gateway's equivalent), and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): BK8 and BK9's T4 result, for the widened rule; the §4.1 row for Chapter 1's examples
- `apps/manual/README.md`: how a listing names a file in `packages/`
- The chapter's source register entries, if the AI SDK or ADK sources leave the chapter

## Risks and open questions

- The comparison with other SDKs is part of what Chapter 1 teaches. Dropping the AI SDK and ADK listings may lose that comparison; tabs could keep one of them beside ours. The owner decides.
- Our packages are alpha (`0.1.0-alpha.4` as of November 2026), so their APIs may change under the chapter. The type-check and the results-drift check catch each change, but each one then needs a chapter update.
- The replay recorder is new code; if it grows past this todo, split it into its own todo that this one depends on.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
