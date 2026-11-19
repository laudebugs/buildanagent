# T30: Example: deferred tools and skills

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T30` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/claude-agent-sdk/examples/` so Chapter T21 ("Tools at scale: the registry, deferred tools, MCP and skills") has code behind its subject. The example shows a tool definition loaded only when the model asks for it, and a skill read into context on demand. The coverage review found the gap: `pi/03-tool-selection` sets the active tool set but does not defer loading, and no example shows skills.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T21's todo, [T21](T21-chapter-tools-at-scale.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/claude-agent-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T21's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Confirm against the [Claude Agent SDK reference](../../reference/claude-agent-sdk/guide.md) and the pinned `.d.ts` which harness documents deferred tools and skills; the Claude harness's mock already runs its tool-search machinery ([`verify/claude-agent-sdk/README.md`](../../../verify/claude-agent-sdk/README.md)). Use Pi instead if its skills are the better documented.
- [x] Write one example per feature, each asserting with `check()` what reached the model and when.
- [x] Keep every tool read-only inside a temp directory, by the SDK process's rule.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/claude-agent-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/claude-agent-sdk/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **Two examples, one harness.** `verify/claude-agent-sdk/examples/08-deferred-tools.ts` and `09-skills.ts` run against the mock with every `check()` passing. The Claude harness documents both features, so Pi was not needed. Example 08 shows a default run in which the first request names three MCP tools without their schemas and offers `ToolSearch`, then carries one definition after the search. Its second run sets `alwaysLoad: true` and sends all three up front, with no `ToolSearch`. Example 09 shows a skill's name and description in the first request, its body in the `Skill` tool's result and every later request, and a skill left out of `skills` never reaching the model.
- **Region markers for Chapter T21.** Example 08 has the regions `deferred-server`, `deferred-run`, `deferred-checks` (notes `no-definition`, `names-only`, `select`, `one-loaded`) and `eager-run`. Example 09 has `skill-files`, `skills-run` and `skills-checks` (notes `listed`, `body-withheld`, `body-stays`).
- **Mock and helper.** `scripts/mock-anthropic.mjs` gains a `[use-skill:<name>]` marker: when the prompt carries it and `Skill` is offered, the mock calls `Skill` once. `examples/lib/mock-log.ts` reads the request log. The mock still never calls a host tool, and each example lists only the built-ins it needs (`tools: ["ToolSearch"]`, `tools: ["Skill"]`). Skill files live in a temp directory, never in the user's home.
- **No transcript.** The harness mocks over HTTP and has no transcript recorder yet, so these examples record none; [T49](../ready/T49-book-http-mock-transcripts.md) adds one, and Chapter T21 lists the regions without a replay until then.
- **Results committed.** `results/run-examples.json` gains entries for `08-deferred-tools.ts` and `09-skills.ts`, with the neutral `/home/user/agent-speak/` path, so the results-drift check passes after `pnpm test`.
- **Observations of 0.3.327, not in its `.d.ts`.** `ToolSearch` is not offered when nothing is deferred, a skill is listed only with `settingSources: ["project"]`, and `tools: []` turns deferral off (the guide's note), so example 08 keeps `ToolSearch` with `tools: ["ToolSearch"]`.
- Fact-check rows 535–549 in `docs/plans/reviews/fact-check-build-book.md` cover the claims, with our choices and inferences marked as ours.
