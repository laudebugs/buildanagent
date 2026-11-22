# T40: Example: a computer-use tool against a fake computer

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T40` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/openai-agents-sdk/examples/` so Chapter T35 ("Agents people can watch: UIs, browsers and taking over") has code behind its subject. The example shows a model driving a computer-use tool whose actions go to a scripted fake computer that records each click and keystroke and returns a fixture screenshot, with an approval before a consequential action. The plan's code review found the gap: Chapter T35 teaches browser and computer use, and no `verify/` harness drives a browser or emits a computer call. The harness's reference says its scripted model "calls only function tools you define, never hosted, computer, shell, apply-patch or sandbox tools" ([OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md)).

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T35's todo, [T35](../done/T35-chapter-agents-people-can-watch.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md), line 38: the scripted model "calls only function tools you define, never hosted, computer, shell, apply-patch or sandbox tools", and `ScriptedModel`'s helpers cover only `functionCall` and `assistantMessage`
- `@openai/agents-core` 0.21.0, `dist/runner/modelOutputs.js`: a model output of `type: 'computer_call'` goes to the agent's `computerTool`, or fails with "Model produced computer action without a computer tool."
- [OpenAI Agents SDK reference](../../reference/openai-agents-sdk/guide.md): computer use runs against an implementation you supply

## Scope

**In scope**

- One or more examples in `verify/openai-agents-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T35's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)
- A real browser (Playwright, or a hosted browser over CDP): a new dependency and a host-touching tool, so it is a separate change the owner approves after deciding the plan changes the [browser-use report](../../research/browser-use/browser-use.md) proposes; no todo covers it yet

## Tasks

- [x] Use the pinned SDK's own computer-use tool, `computerTool` in `@openai/agents` 0.21.0, with a `Computer` implementation written for the example.
- [x] Script the model with `modelResponse()` and a raw output item of `type: 'computer_call'`, because `ScriptedModel`'s helpers cover only function calls and messages; the runner hands that item to the agent's `computerTool` (`dist/runner/modelOutputs.js`).
- [x] Write the fake computer as an in-memory object: it records actions and returns a fixed image, and touches no screen, browser or file outside a temp directory.
- [x] Assert with `check()` the sequence of actions the scripted model requests, and that a consequential action pauses for approval.
- [x] Update the reference fact-check's note on the scripted tier's limit, since this example lifts it for computer tools in this harness.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/openai-agents-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/openai-agents-sdk/README.md`: the new example
- The plan's §4 row for the chapter
- [OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md): the note on the scripted tier's limit, line 38

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.
- The scripted tier has never emitted a computer call ([OpenAI Agents SDK fact-check](../../reference/openai-agents-sdk/fact-check.md)), so the raw `computer_call` item may need fields the helpers do not document; read them from the pinned `.d.ts` and the runner, and record any surprise in the harness README and the reference fact-check

## Outcome

`verify/openai-agents-sdk/examples/13-computer-use-approval.ts` gives an agent the SDK's own `computerTool()` and an in-memory fake `Computer` that records each action and returns a fixture screenshot. The scripted model emits raw `computer_call` items through `modelResponse()`, and the runner hands them to the tool. Its checks pass offline: the computer receives the click, then a batched type and keypress, in order, with one screenshot per call; `needsApproval` is asked about all four actions; the run pauses at the Pay click with that click not yet on the computer; `approve()` after a `RunState` round trip lets it through once; `reject()` leaves the computer untouched; and the model is offered only the computer tool. The SDK supports this offline, so no limit needed recording. Two findings go to the chapter and the README: an action that throws gives the model an empty screenshot, and the example proves the SDK's loop and approval flow, not a real model's or browser's behaviour. The transcript recorder now writes computer calls and results as tool calls and results, which changed no other transcript. The example's verdict joins `results/run-examples.json`, and its transcript is `results/transcripts/13-computer-use-approval.json`; two runs wrote it byte for byte. The claims are logged in [the example's fact-check log](../../plans/reviews/fact-check-openai-computer-use-example.md), rows T40-1 to T40-12. The writing review is left for the pull request, after the code reviews.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
