# T42: Example: a subagent with its own context

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T42` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/openai-agents-sdk/examples/` that shows an orchestrator that calls a subagent as a tool, the subagent working in its own context and returning only a summary, and the token usage of each, so Chapter T17 ("Choosing the shape: buy, adopt or build, how to plan, and when subagents pay") has code behind its subject. The coverage review found the gap: Chapter T17 teaches subagents and their cost, and the only multi-agent example, `03-handoff.ts`, hands the conversation over instead of isolating context.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T17's todo, [T17](T17-chapter-choosing-the-shape.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/openai-agents-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if the harness is covered

**Out of scope** (and which todo covers it)

- Chapter T17's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [ ] Use the pinned SDK's agents-as-tools pattern (`agent.asTool()` in `@openai/agents` 0.21.0) or the Claude Agent SDK's subagents, whichever its reference documents better.
- [ ] Assert with `check()` that the subagent's messages never enter the orchestrator's transcript, that only the summary does, and that the usage of both runs is reported.
- [ ] Script both models so the example shows the token multiplier the chapter cites without a real model.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [ ] No mock model in the example calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/openai-agents-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/openai-agents-sdk/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
