# T31: Example: a sandbox or permission behaviour the SDK itself enforces

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T31` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/claude-agent-sdk/examples/` or `verify/copilot-sdk/examples/` so Chapter T22 ("Permissions, sandboxes and credentials, and the lethal trifecta") has code behind its subject. The example shows a call the SDK's own sandbox or permission policy refuses before it runs, offline and without touching the host. The coverage review found the gap: `copilot-sdk/00-sandbox.ts` describes itself as a "Harness self-check, not an SDK behavior", so Chapter T22 has no SDK sandbox behaviour to show.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T22's todo, [T22](T22-chapter-permissions-sandboxes-and-credentials.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/claude-agent-sdk/examples/` or `verify/copilot-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T22's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Find, in the reference guides and pinned `.d.ts`, an SDK sandbox or permission setting that can be shown offline under the [SDK process](../../../AGENTS.md#process-for-documenting-an-sdk)'s rule that mock models never call host-touching tools.
- [x] Write the example so the refused call never executes: assert the denial and that the target file or host is untouched.
- [x] If no SDK can show a real sandbox offline, write that limit into the chapter todo and the harness README instead of faking one.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/claude-agent-sdk` or `verify/copilot-sdk`, whichever holds the example, and the root `pnpm test`.

## Docs to update

- `verify/claude-agent-sdk/README.md` or `verify/copilot-sdk/README.md`, whichever holds the example: the new example
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

`verify/claude-agent-sdk/examples/10-refusals-are-recorded.ts` shows a call the SDK's permission policy refuses before it runs, offline and without touching the host. A tool that no rule allows, called with no `canUseTool` callback to ask, never runs. The model's next request carries the refusal as an error result, and the run ends `success` with the call in `result.permission_denials`. A second run with an allowing rule runs its tool and records nothing.

- **The SDK enforces and records it.** `permission_denials` is the result's authoritative record of refusals, per the pinned `sdk.d.ts`, and the example asserts the tool's name and input in it. Rows T31-1 to T31-7 in `docs/plans/reviews/fact-check-claude-refusals-example.md` check each claim against the types and the run.
- **No sandbox is shown, and the limit is written down.** The SDK's `sandbox` option isolates command execution, and the mock never calls built-in host tools such as `Bash`, so an offline sandbox example would have to run a real shell command. The harness README and the book plan's T22 row say so, and the chapter keeps the sandbox tier as prose.
- **The mock needed the tool to come first.** The mock loads the first deferred MCP tool through `ToolSearch`, so the refused tool sits alone on its own server. The example uses two servers instead of editing the mock.
- **The transcript is recorded as the `claude` user.** The harness README says the CLI refuses `bypassPermissions` as root. Two runs wrote the same transcript for the new example, and the other nine transcripts did not change.
