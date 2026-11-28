# B24: Example: a cascade whose check decides what the cascade costs

| Field | Value |
| --- | --- |
| ID | `B24` |
| Status | `ready` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](T76-chapter-fast-and-slow-calls.md)) |
| Depends on | [B5](../done/B5-usage-cost-catalog.md), [B11](../done/B11-loop-core.md), [B13](../done/B13-interceptors-observers.md) |
| Size | M |

## Goal

Add `packages/sdk/examples/14-cascade-with-check.ts`, which runs ten scripted scheduling tasks through a fast model and escalates to a slow one when a check fails, once with a schema-only check and once with a schema-plus-rule check. It shows that a cascade needs no new SDK feature, because a `shouldStop` hook can check the fast model's answer and ask again, and a `beforeModelCall` hook can send that second ask to a slow `model` from `createModel()`. It gives the chapter's cascade section its listing.

## Context

- [The model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md#one-new-part-ii-chapter-should-follow-events-and-hooks-and-teach-the-seven-rules-through-five-offline-examples) holds this example's specification, and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md) holds the sources for every number the example stands in for. The owner approved the report's six decisions on 2026-11-28 ("approved all of them").
- [Examples guideline](../../guidelines/examples.md): how a tested example, its `// #region` markers and its transcript are written.

## Scope

**In scope**

- `packages/sdk/examples/14-cascade-with-check.ts`, with `// #region` markers for the book, and its recorded transcript under `packages/sdk/results/transcripts/`
- The mechanism: `shouldStop` runs the check on the fast model's text answer and, when the check fails, returns `{ continue: <re-ask> }`. Once the slow model has answered, it returns nothing, so a slow answer that also fails the check ends the run instead of re-asking until `maxSteps`. `beforeModelCall` then returns `{ model: slow, messages: <the original task only> }` for the re-ask, so the slow call sends a fresh prompt. A patch's `messages` replaces what that one call sends, and the run's transcript keeps its own, which keeps the 2,000-input-token and $0.006-per-slow-call figures valid. `beforeModelCall` alone cannot escalate, because it runs before a call and a text answer ends the run. `packages/sdk/examples/12-weak-check.ts` is the starting point for the house style of a check
- Ten scripted scheduling tasks, each using 2,000 input and 200 output tokens. A fast scripted model priced as Haiku 5.5 ($0.10 and $0.50 per million tokens) costs $0.0003 a call. A slow scripted model priced as Sonnet 5.5 ($2 and $10) costs $0.006 a call
- The fast model gets seven answers right, two schema-invalid and one valid but wrong
- Run 1, a schema-only check: two tasks escalate, the wrong answer is accepted, and the cost is $0.015. Run 2, a schema-plus-rule check: three tasks escalate, ten of ten end correct, and the cost is $0.021, against $0.06 for slow-only
- A comment that says the scripted counts stand in for TypeSafe's 72 of 74 wrong answers passing a schema check and prove nothing about a real model

**Out of scope** (and which todo covers it)

- The chapter that lists this example: [T76](T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [ ] Write the scripted models and the ten tasks, with the three outcome classes fixed in the script.
- [ ] Write the check as a function of the answer, the `shouldStop` hook that runs it on the fast model's answer and returns `{ continue }` when it fails and nothing once the slow model has answered, and the `beforeModelCall` hook that returns the slow `model` and the original task as `messages` for that re-ask. Start from `12-weak-check.ts`.
- [ ] Price each run from the catalog's rates, not from constants in the example.
- [ ] Add the regions, the transcript and the test that asserts the counts and costs.

## Acceptance criteria

- [ ] The test asserts both runs' escalation counts, the correct-answer counts and the costs above ($0.015, $0.021 and $0.06)
- [ ] The comment names TypeSafe's cookbook as the evidence the counts imitate and says the example measures no real model
- [ ] The example runs offline and the results-drift check passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/` runs the example. The transcript is committed with the change that caused it.

## Docs to update

- `packages/sdk/README.md` if it lists its examples
- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- The hook must choose the model per call without changing the cached prefix of the session in a way the example hides. The example states that a real escalation restarts on a new model and loses its cache, which [B26](B26-example-switch-or-stay.md) prices.
- Priced numbers move with the catalog. The test reads the catalog's rates, so a price change fails it, and the comment gives the November 2026 prices.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
