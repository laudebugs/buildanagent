# T48: Example: A2A 1.0 delegation, once a pinned SDK ships 1.0 support

> **On hold (owner, 2026-11-19): do not start until an SDK we pin releases A2A 1.0 support.** Two releases would lift the hold: Google ADK with pull request [google/adk-js#1365](https://github.com/google/adk-js/pull/1365) merged, which moves it to `@a2a-js/sdk` `^1.3.0`, or `@openai/agents` with `@openai/agents/a2a`, which exists only on a branch as of November 2026. Our weekly SDK-update job opens the upgrade pull request when either ships ([CI plan §3c](../../plans/ci.md#3c-weekly-sdk-updates-added-2026-11-19)). The owner lifts the hold once that pull request merges.

| Field | Value |
| --- | --- |
| ID | `T48` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T45](T45-example-a2a-delegation.md) |
| Size | M |

## Goal

Write a type-checked, mock-run example that shows A2A 1.0, the version the standard has used since 12 March 2026, in whichever pinned SDK ships it first. T45 shows A2A on ADK at protocol 0.3, because no SDK we pin spoke 1.0 as of November 2026, and U19 advised that Section T37 should show `@a2a-js/sdk` 1.3.0 code only once a harness runs it ([U19 report, Examples](../../research/a2a/agent-to-agent-protocols.md#one-new-example-on-adk-would-give-t37-its-listing-and-a-10-example-should-wait-for-a-release)). The owner approved this todo on 2026-11-19, held on the upstream release.

## Context

- [U19 report, Examples](../../research/a2a/agent-to-agent-protocols.md#one-new-example-on-adk-would-give-t37-its-listing-and-a-10-example-should-wait-for-a-release): the three behaviours a 1.0 example should assert
- [U19 report, SDKs](../../research/a2a/agent-to-agent-protocols.md#one-of-our-eight-sdks-ships-a2a-in-typescript-and-it-speaks-03-not-10): ADK's 0.3 types leak into its public API, so its move to 1.0 breaks callers, and `@a2a-js/sdk` 1.3.0's `legacyCompat` talks to 0.3 peers
- [T45](T45-example-a2a-delegation.md): the 0.3 example this one extends or replaces
- [Section T37](T37-section-a2a.md), whose listing this example would update

## Scope

**In scope**

- One example in the harness of the SDK that ships 1.0 first, `verify/google-adk/examples/` or `verify/openai-agents-sdk/examples/`, at the next free number, asserting its behaviour with `check()`
- A change to T45's example, if the ADK upgrade breaks it, so that both still run or the 0.3 example is retired with a reason

**Out of scope** (and which todo covers it)

- Section T37's prose; a follow-up to T37 updates the listing once this example lands
- An A2A client or server in our own harness: the [harness plan's non-goals](../../plans/build-harness.md#1-goal-and-non-goals) exclude it from v1

## Tasks

- [ ] Confirm that the pinned release speaks A2A 1.0, from its `.d.ts` and its card's protocol version.
- [ ] Assert with `check()` that a request carries the `A2A-Version: 1.0` header, that task states use the `TASK_STATE_*` names, and that the 0.3 fallback still reaches a 0.3 peer.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim against the pinned `.d.ts`, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in its harness's `pnpm test`, offline, with every `check()` passing
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in the chosen harness, and the root `pnpm test`.

## Docs to update

- The harness's README: the new example
- The book plan's §4.3 row for A2A, and a follow-up note on T37

## Risks and open questions

- The release that ships 1.0 may differ from the open pull request or branch that U19 read. Re-read the shipped `.d.ts` before writing a check, and drop a check the release does not support.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
