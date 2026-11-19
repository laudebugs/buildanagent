# T40: Example: a computer-use tool against a fake computer

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T40` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/openai-agents-sdk/examples/` that shows a model driving a computer-use tool whose actions go to a scripted fake computer that records each click and keystroke and returns a fixture screenshot, with an approval before a consequential action, so Chapter T35 ("Agents people can watch: UIs, browsers and taking over") has code behind its subject. The plan's code review found the gap: Chapter T35 teaches browser and computer use, and no `verify/` harness drives a browser or emits a computer call: the harness's reference says its scripted model "calls only function tools you define, never hosted, computer, shell, apply-patch or sandbox tools" ([OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md)).

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T35's todo, [T35](T35-chapter-agents-people-can-watch.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md), line 38: the scripted model "calls only function tools you define, never hosted, computer, shell, apply-patch or sandbox tools", and `ScriptedModel`'s helpers cover only `functionCall` and `assistantMessage`
- `@openai/agents-core` 0.21.0, `dist/runner/modelOutputs.js`: a model output of `type: 'computer_call'` goes to the agent's `computerTool`, or fails with "Model produced computer action without a computer tool."
- [OpenAI Agents SDK reference](../../reference/openai-agents-sdk/guide.md): computer use runs against an implementation you supply

## Scope

**In scope**

- One or more examples in `verify/openai-agents-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if the harness is covered

**Out of scope** (and which todo covers it)

- Chapter T35's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)
- A real browser (Playwright, or a hosted browser over CDP): a new dependency and a host-touching tool, so it is a separate change the owner approves once the [browser-use report](../../research/browser-use/browser-use.md)'s proposed plan changes are decided; no todo covers it yet

## Tasks

- [ ] Use the pinned SDK's own computer-use tool, `computerTool` in `@openai/agents` 0.21.0, with a `Computer` implementation written for the example.
- [ ] Script the model with `modelResponse()` and a raw output item of `type: 'computer_call'`, because `ScriptedModel`'s helpers cover only function calls and messages; the runner hands that item to the agent's `computerTool` (`dist/runner/modelOutputs.js`).
- [ ] Write the fake computer as an in-memory object: it records actions and returns a fixed image, and touches no screen, browser or file outside a temp directory.
- [ ] Assert with `check()` the sequence of actions the scripted model requests, and that a consequential action pauses for approval.
- [ ] Update the reference fact-check's note on the scripted tier's limit, since this example lifts it for computer tools in this harness.
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
- [OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md): the note on the scripted tier's limit, line 38

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.
- The scripted tier has never emitted a computer call ([OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md)), so the raw `computer_call` item may need fields the helpers do not document; read them from the pinned `.d.ts` and the runner, and record any surprise in the harness README and the reference fact-check

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
