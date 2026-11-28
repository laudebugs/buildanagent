# T76: Chapter: Fast and slow calls: effort, decision models, cascades and when a router pays

| Field | Value |
| --- | --- |
| ID | `T76` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T18](../done/T18-chapter-the-model-gateway.md), [T19](../done/T19-chapter-events-and-hooks.md), [T26](../done/T26-book-checked-inline-code.md), [B24](B24-example-cascade-with-check.md), [B25](B25-example-decision-gate.md), [B26](B26-example-switch-or-stay.md), [B27](B27-example-cost-per-solved-task.md), [B28](B28-example-plan-buffer.md) |
| Size | M |

## Goal

Write the chapter "Fast and slow calls: effort, decision models, cascades and when a router pays" (`fast-and-slow-calls`) for Part II, after Events and hooks. Its reader is a builder who has shipped an agent and wants to know when a call should be fast, when it should be slow, and when anything should pick between them. **Research question:** set by the [model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md), approved on 2026-11-28: how should an agent choose between fast and slow calls, and when does a model router pay for itself?

## Context

- [The report](../../research/model-routing/system-1-system-2-and-model-routing.md) and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md): the seven rules, the five patterns, the routing evidence and the chapter outline below. Its chapter section gives the five sections, the scenario opening and the exercise.
- [The model gateway](../../../apps/manual/src/content/chapters/the-model-gateway.md) (the cache model) and [Events and hooks](../../../apps/manual/src/content/chapters/events-and-hooks.md) (the hook that swaps a model per call): the two chapters this one builds on.
- [Choosing the shape](../../../apps/manual/src/content/chapters/choosing-the-shape.md): it uses "router" for input routing to specialists, so this chapter says **model router** for the other meaning and **cascade** for a check-then-escalate loop.
- `apps/manual/README.md`: how a chapter passes `check:book`.

## Scope

**In scope**

- `apps/manual/src/content/chapters/fast-and-slow-calls.md` with `opening: scenario`, and its entry in `apps/manual/src/outline.ts` between `events-and-hooks` and `the-session-log-and-context`. The entry is added with the chapter, not before, because every outline entry today has its file and the entry renumbers every later chapter
- Five sections, each headed by its conclusion: (1) a call is fast or slow by what it emits, and a decision model is a fast call with typed answers, opening on a scenario in which an agent spends a reasoning model's budget confirming a refund's order id; (2) lower the effort before you change the model, and change it without losing the cache; (3) ask a decision model fixed-set questions, keep arithmetic and consent in code, and measure calibration on your own data; (4) a cascade escalates on a check that code can run, and a weak check costs more than it saves; (5) a router needs a baseline it can beat, a priced cache and a result on your own traffic
- Listings from the five examples: `packages/sdk/examples/14-cascade-with-check.ts` (B24), `15-decision-gate.ts` (B25), `packages/gateway/examples/05-switch-or-stay.ts` (B26), `packages/sdk/examples/16-cost-per-solved-task.ts` (B27) and `17-plan-buffer.ts` (B28)
- An exercise that asks the reader to change a threshold and predict which tasks escalate, as the gateway chapter does for its budget
- `apps/manual/fact-checks/fast-and-slow-calls.md`, the chapter's claims log, and register entries for each new source

**Out of scope** (and which todo covers it)

- The five examples: [B24](B24-example-cascade-with-check.md) to [B28](B28-example-plan-buffer.md)
- A typed `effort` option on the gateway: a design question in the [build SDK plan](../../plans/build-sdk.md#62-no-question-is-open-and-one-item-waits-for-a-later-round), not this chapter

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

- **Where a listing may come from.** [BK8](../../plans/build-book.md) takes a chapter's listings from `verify/*/examples` and adds our packages as tabs. These five examples exist only in our packages, so the chapter lists `packages/` files with no third-party tab. Check that `::listing` accepts a `packages/` path with no `verify/` twin; if it does not, propose the smallest change to the owner.
- **Recheck at each model release (owner decision 6, 2026-11-28).** Anthropic's page says to "Recheck at every model release, because releases move both the capability gap and the price ratio" ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)). Each time Anthropic or OpenAI ships a model, someone rereads the report's prices, effort rules and cache claims against the vendors' pages and logs the result in the report's fact-check log. The chapter's "as of" dates say when it was last true.
- The five sections rest on vendor claims and on papers measured on math, one simulator and one web benchmark. The chapter labels each as such.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
