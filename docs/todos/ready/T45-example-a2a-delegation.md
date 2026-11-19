# T45: Example: delegation to a remote agent over A2A on ADK, both ends offline

| Field | Value |
| --- | --- |
| ID | `T45` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [U19](../done/U19-research-a2a.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/google-adk/examples/` so Section T37 (agent-to-agent protocols in Chapter T21) has code behind its subject. The example runs both ends of A2A in one process, offline: a "billing" agent exposed through `toA2a` on `127.0.0.1`, and a parent agent that delegates to it through a `RemoteA2AAgent`. U19's research found that ADK is the only one of our eight SDKs whose released TypeScript package can show both ends, so a listing from any other SDK would teach code that no pinned package of ours runs ([U19 report, Examples](../../research/a2a/agent-to-agent-protocols.md#one-new-example-on-adk-would-give-t37-its-listing-and-a-10-example-should-wait-for-a-release)). The owner approved this example, and its new dependency, on 2026-11-19.

## Context

- [U19 report, Examples](../../research/a2a/agent-to-agent-protocols.md#one-new-example-on-adk-would-give-t37-its-listing-and-a-10-example-should-wait-for-a-release): the five checks, and why checks 2 and 5 are still unrun
- [U19 report, SDKs](../../research/a2a/agent-to-agent-protocols.md#one-of-our-eight-sdks-ships-a2a-in-typescript-and-it-speaks-03-not-10): ADK 2.5.0 speaks protocol 0.3, and its `basePath` typings drift from its code
- [U19 SDK notes, Google ADK](../../research/a2a/notes/sdk-support.md#google-adk-googleadk-250): the loopback route, `allowCrossOriginRpc` and the card host rule
- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and the section's todo, [T37](T37-section-a2a.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk) and [coding standards](../../../AGENTS.md#coding-standards): mock models, exact pins, the one-week age rule
- `verify/google-adk/examples/lib/check.ts`: the `ScriptedLlm` and `check()` helpers this example reuses

## Scope

**In scope**

- `verify/google-adk/examples/09-a2a-delegation.ts`, the next free number, asserting its behaviour with `check()`
- `@a2a-js/sdk` 0.3.14 as a direct, exact-pinned dependency of `verify/google-adk`. pnpm does not hoist ADK's transitive copy, and the lockfile already resolves 0.3.14. Version 0.3.14 was published on 2026-07-09, so it meets the one-week rule (`npm view @a2a-js/sdk time`)
- `// #region` and `// book:note` markers for the section's listing
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- An A2A 1.0 example: [T48](T48-example-a2a-1-0.md), held until a pinned SDK ships 1.0 support
- Section T37's prose: [T37](T37-section-a2a.md)
- An A2A client or server in our own harness: the [harness plan's non-goals](../../plans/build-harness.md#1-goal-and-non-goals) exclude it from v1

## Tasks

- [ ] Add `"@a2a-js/sdk": "0.3.14"` to `verify/google-adk/package.json` with `pnpm add --filter @buildanagent/verify-google-adk @a2a-js/sdk@0.3.14`, and confirm that the lockfile still resolves one copy.
- [ ] Drive a "billing" agent with `ScriptedLlm`, and expose it through `toA2a` on `127.0.0.1` with `bearerTokenUserBuilder`. Set `basePath` explicitly, because the typings document a default of `"a2a"` while the code mounts at the root.
- [ ] Delegate to it from a parent agent through a `RemoteA2AAgent` that reads the loopback card, under an `InMemoryRunner`.
- [ ] Assert U19's five checks with `check()`:
  1. the card is served at `/.well-known/agent-card.json` with `protocolVersion: "0.3.0"` and two interfaces, JSON-RPC and HTTP+JSON;
  2. the parent's run yields the remote agent's reply as an event, through the same interface as an in-process subagent;
  3. a request without the bearer token never reaches the agent, which ADK documents as surfacing "as an HTTP 500 rather than a 401";
  4. `toA2a` with neither authentication nor `allowUnauthenticated: true` refuses to mount the server;
  5. a remote tool marked long-running ends the turn with an `input-required` status.
- [ ] Close the server in a `finally` block, and bind only to loopback.
- [ ] Record in the example's header that ADK speaks protocol 0.3 as of November 2026, and whether checks 2 and 5 behaved as U19 read them in the compiled code.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or compiled code, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] `verify/google-adk/package.json` pins `@a2a-js/sdk` at exactly `0.3.14`
- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with all five checks passing, or the header and T37 record which check failed and why
- [ ] No socket listens on any address but loopback, and no mock model calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/google-adk`, and the root `pnpm test`.

## Docs to update

- `verify/google-adk/README.md`: the new example and the new dependency
- The book plan's §4.3 row for A2A, and T37's listing
- The [ADK reference fact-check](../../reference/google-adk/fact-check.md#u19-a2a-findings-the-basepath-default-drifts-and-the-guide-uses-the-old-card-path-2026-11-19), if a check shows a finding it records to be wrong

## Risks and open questions

- Checks 2 and 5 rest on compiled code that U19 read but did not run. If either fails, record the limit in the example's header and in T37, and keep the checks that pass, instead of writing an example that only pretends.
- ADK's open pull request #1365 would move it to `@a2a-js/sdk` `^1.3.0`. If our weekly SDK-update job brings that release before this todo starts, re-plan the example for protocol 1.0 and fold T48 into it.
- An HTTP server inside a test may leave the process open. Close it and give the run a timeout.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
