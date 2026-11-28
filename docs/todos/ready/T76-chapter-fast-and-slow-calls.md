# T76: Chapter: Fast and slow calls: effort, decision models, cascades and when a router pays

| Field | Value |
| --- | --- |
| ID | `T76` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T18](../done/T18-chapter-the-model-gateway.md), [T19](../done/T19-chapter-events-and-hooks.md), [T26](../done/T26-book-checked-inline-code.md), [B24](../done/B24-example-cascade-with-check.md), [B25](../done/B25-example-decision-gate.md), [B26](../done/B26-example-switch-or-stay.md), [B27](B27-example-cost-per-solved-task.md), [B28](B28-example-plan-buffer.md) |
| Size | M |

## Goal

Write the chapter "Fast and slow calls: effort, decision models, cascades and when a router pays" (`fast-and-slow-calls`) for Part II, after Events and hooks. Its reader is a builder who has shipped an agent and wants to know when a call should be fast, when it should be slow, and when anything should pick between them. **Research question:** set by the [model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md), approved on 2026-11-28: how should an agent choose between fast and slow calls, and when does a model router pay for itself?

## Context

- [The report](../../research/model-routing/system-1-system-2-and-model-routing.md) and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md): the seven rules, the five patterns, the routing evidence and the chapter outline. Its chapter section gives the five sections, the scenario opening and the exercise.
- [The model gateway](../../../apps/manual/src/content/chapters/the-model-gateway.md) (the cache model) and [Events and hooks](../../../apps/manual/src/content/chapters/events-and-hooks.md) (the hook that swaps a model per call): the two chapters this one builds on.
- [Choosing the shape](../../../apps/manual/src/content/chapters/choosing-the-shape.md): it uses "router" for input routing to specialists, so this chapter says **model router** for the other meaning and **cascade** for a check-then-escalate loop.
- `apps/manual/README.md`: how a chapter passes `check:book`.

## Scope

**In scope**

- `apps/manual/src/content/chapters/fast-and-slow-calls.md` with `opening: scenario`, and its entry in `apps/manual/src/outline.ts` between `events-and-hooks` and `the-session-log-and-context`. The entry is added with the chapter, not before, because every outline entry today has its file and the entry renumbers every later chapter
- Five sections, each headed by its conclusion, and each carrying what the report assigns to it:
  1. A call is fast or slow by what it emits, and a decision model is a fast call with typed answers. Open on a scenario in which an agent spends a reasoning model's budget confirming a refund's order id. Carry the four uses of "System 1" in the papers, the three terms from the report and the Haiku 5.5 example of one model on both paths.
  2. Lower the effort before you change the model, and change it without losing the cache. Carry rules 4, 5 and 7, Anthropic's cost-per-solved-task measure, top-level against per-message effort, and the model and platform limits. The limits are:
     - the cache split: a new top-level effort can invalidate the prompt cache, and per-message effort keeps the prefix
     - OpenAI's `configuration_update` item
     - the beta's 400 errors on Sonnet 5.5 with `between_tools` thinking and on Haiku 5.5 with thinking disabled
     - our gateway's lack of a typed effort (only the raw `reasoning_effort` in the OpenAI chat adapter)
     - OpenRouter's statement that a model switch "costs extra while the new model rebuilds the prompt cache"

     The talking-to-a-model chapter's model-choice section keeps only the effort step (decision 5), so this material moved here from it. Its claims are rows 209 to 215 of [that chapter's log](../../../apps/manual/fact-checks/talking-to-a-model.md); re-read each at its source
  3. Ask a decision model fixed-set questions, keep arithmetic and consent in code, and measure calibration on your own data. Carry rules 1 and 2, the security paragraph, and TypeSafe, Clef and OpenAI's API as three wire shapes of one idea. This section names decision models as a way to answer fixed-set questions without an LLM loop (decision 1)
  4. A cascade escalates on a check that code can run, and a weak check costs more than it saves. Carry rules 3 and 6, the TypeSafe and timeout-cascade numbers as vendor and paper evidence, and the planner-and-executor split
  5. A router needs a baseline it can beat, a priced cache and a result on your own traffic. Carry the routing section of the report in one page, ending on the rule "pick a fixed tier first, then measure what a router adds"
- Two claims the chapter must not make. A decision model is not a security boundary: the report says "Neither fast nor slow thinking makes an agent safe against manipulation, so a decision model is not a security boundary." And a probability states intent, not consent: "A probability states intent, not consent." The report's banking example gave a hesitant "yeah, go ahead I guess" a 0.99 for `approve_transfer`, so approvals, sandboxes and credentials stay with the chapters that cover them
- Listings from the five examples: `packages/sdk/examples/14-cascade-with-check.ts` (B24), `15-decision-gate.ts` (B25), `packages/gateway/examples/05-switch-or-stay.ts` (B26), `packages/sdk/examples/16-cost-per-solved-task.ts` (B27) and `17-plan-buffer.ts` (B28)
- An exercise that asks the reader to change a threshold and predict which tasks escalate, as the gateway chapter does for its budget
- `apps/manual/fact-checks/fast-and-slow-calls.md`, the chapter's claims log, and register entries for each new source

**Out of scope** (and which todo covers it)

- The five examples: [B24](../done/B24-example-cascade-with-check.md) to [B28](B28-example-plan-buffer.md)
- A typed `effort` option on the gateway: a design question in the [build SDK plan](../../plans/build-sdk.md#62-one-question-is-open-and-one-item-waits-for-a-later-round), not this chapter

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the report only, before drafting.
- [ ] Vet any analogy and register the ones the chapter uses in `analogies.json` (BK22); the chapter may use none.
- [ ] Add the `outline.ts` entry and confirm the later chapters' numbers and every reference to them still resolve.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; fact-check every claim against its primary source into the chapter's log before drafting the next section; commit the section and its rows together (BK21).
- [ ] Define "fast call", "slow call", "decision model", "model router" and "cascade" once, and use each term for one concept.
- [ ] Read each paper the chapter cites in full before citing it (AGENTS.md, the owner's rule of 2026-11-20), and say "as of <month year>" on every price, version and status.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix with `/anthropic-skills:writing`, re-check touched claims and log them.
- [ ] Recheck the report at the release of any Anthropic or OpenAI model that lands before this todo ends (see Risks).

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every inline identifier resolves or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [ ] The front matter's `opening` is `scenario` and `check:book` passes the opening-rotation rule (the fourth `scenario` of 19 chapters, under the cap of five)
- [ ] The chapter's log has one block of rows per section, plus re-check rows, with a ✅/✏️/⚠️ tally
- [ ] The pull request records the writing review's scores, before and after
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm --filter @buildanagent/manual check:book` pass

## Tests

The book's build and `check:book` in the CI `book` job.

## Docs to update

- The book plan's §4.2 row, if the sources or examples change
- The glossary, the source register and the analogy register

## Risks and open questions

- **Where a listing may come from.** [BK8](../../plans/build-book.md) takes a chapter's listings from `verify/*/examples` and adds our packages as tabs. The owner made this chapter an exception on 2026-11-28: its five listings come from `packages/` alone, with no `verify/` twin, because the cascade, the decision gate, the cache arithmetic, cost per solved task and the plan buffer are our own patterns over our SDK's hooks, not features a third-party SDK documents. The chapter may still cite or list an existing `verify/` example where one shows the same mechanism. Check that `::listing` accepts a `packages/` path with no `verify/` twin; if it does not, propose the smallest change to the owner.
- **Recheck at each model release during this todo (owner decision 6, 2026-11-28).** Anthropic's page says to "Recheck at every model release, because releases move both the capability gap and the price ratio" ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). AGENTS.md holds the standing rule for the report. If Anthropic or OpenAI ships a model before this todo ends, recheck the report first, then recheck the chapter's claims and "as of" dates, which say when it was last true.
- The five sections rest on vendor claims and on papers measured on math, one simulator and one web benchmark. The chapter says which of the two each claim rests on.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
