# T37: Section: agent-to-agent protocols (A2A) in Chapter T21

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T37` |
| Status | `ongoing` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U19](../done/U19-research-a2a.md), [T21](T21-chapter-tools-at-scale.md), [T45](../done/T45-example-a2a-delegation.md) |
| Size | S |

## Goal

Add one section to Chapter T21 ("Tools at scale: the registry, deferred tools, MCP and skills") from research todo [U19](../done/U19-research-a2a.md)'s report. It is a section, not a chapter: A2A is an interoperability protocol beside MCP, so it belongs in the chapter that already explains MCP; one section keeps Chapter T21 from waiting on research.

U19's report settled the scope, and the owner approved its proposed changes on 2026-11-19 (owner decision 2026-11-19). The topic stays one section, placed right after the chapter's MCP section. The section teaches A2A as delegation to an agent whose plan someone else owns, in the five steps below, and its listing comes from T45's ADK example ([U19 report, Teach](../../research/a2a/agent-to-agent-protocols.md#section-t37-should-teach-a2a-as-delegation-to-an-opaque-peer-in-five-steps-and-stay-one-section)).

## Context

- [U19](../done/U19-research-a2a.md)'s [report](../../research/a2a/agent-to-agent-protocols.md) and [fact-check](../../research/a2a/fact-check-agent-to-agent-protocols.md)
- Chapter T21's todo, [T21](T21-chapter-tools-at-scale.md), and its fact-check file `apps/manual/fact-checks/tools-at-scale.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)
- [T45](../done/T45-example-a2a-delegation.md): the listing, both ends of A2A on ADK in one process, offline

## Scope

**In scope**

- One section in `apps/manual/src/content/chapters/tools-at-scale.md`, placed right after the chapter's MCP section
- Five steps, in this order (owner decision 2026-11-19):
  1. **What A2A standardizes:** the card at `/.well-known/agent-card.json`, `SendMessage`, a `Task` with nine states, and results as artifacts, delivered by blocking, polling, streaming or webhook. State the version as of November 2026: 1.0.0, patched as 1.0.1.
  2. **How it divides work with MCP:** after MCP 2026-07-28, duration no longer separates them, so the line is who plans the work. The step follows the MCP section, which already teaches `input_required`.
  3. **When to delegate at all:** the 3–10x token cost and U19's five rules, ending with exposure only for an outside caller.
  4. **What ships in TypeScript:** ADK's `toA2a` and `RemoteA2AAgent` on protocol 0.3, the official `@a2a-js/sdk` on 1.0, and the `A2A-Version` rule that keeps the two apart. Name 1.0 as the standard and 0.3 as what ADK ships, and show `@a2a-js/sdk` 1.3.0 code only once a harness runs it.
  5. **What to distrust:** the card's prose, the card's name and every reply, with the harness's `outputTrust: "untrusted"` default for remote-agent tools as the fix.
- The listing from [T45](../done/T45-example-a2a-delegation.md)'s `verify/google-adk/examples/09-a2a-delegation.ts`
- Rows for the section in `apps/manual/fact-checks/tools-at-scale.md`

**Analogy** (BK22): A2A, as firms contracting through a standard purchase order. Where the analogy breaks: an A2A task can stream updates and ask for more input, which a purchase order never does. A second break note, approved by the owner on 2026-11-19: a firm vets a supplier before it signs, whereas an Agent Card is unvetted self-description that the calling model reads as prose. Use the analogy only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- An A2A 1.0 listing: [T48](T48-example-a2a-1-0.md), held until a pinned SDK ships 1.0 support
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note that carries both breaks, and register it in `analogies.json`; otherwise explain the concept plainly.
- [ ] Cite T45's checks 2 and 5 only if T45 ran them; otherwise teach those behaviours from ADK's code and say so. T45 ran both on 2026-11-22 and both held ([its log](../../plans/reviews/fact-check-google-adk-a2a-example.md), rows T45-9 and T45-10), so the section may cite them. It also found two details the section should state: `RemoteA2AAgent`'s `agentCard` is a base URL resolved like a relative URL (an origin or a base ending in a slash, not the card URL; rows T45-5 and T45-14), and ADK's default client sends no bearer token on either transport, so a custom factory must authenticate both (rows T45-6 and T45-15).
- [ ] Fact-check every claim in the section against its primary source into `apps/manual/fact-checks/tools-at-scale.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] The chapter still builds with every check passing, the analogy check included
- [ ] `apps/manual/fact-checks/tools-at-scale.md` has the section's rows and the re-check rows, with an updated tally
- [ ] The pull request records the 5C and voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job.

## Docs to update

- The book plan's §4.3 row

## Risks and open questions

- U19 found that the topic fits one section, and the owner agreed on 2026-11-19, so the risk that it needs a chapter is closed.
- Every version and status in the section dates fast. Give each its "as of" month, and revisit the TypeScript step when T48's hold lifts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
