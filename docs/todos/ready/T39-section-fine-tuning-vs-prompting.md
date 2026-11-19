# T39: Section: fine-tuning versus prompting in Chapter T11

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T39` |
| Status | `ready` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U21](../done/U21-research-fine-tuning-vs-prompting.md), [T11](T11-chapter-talking-to-a-model.md), [T28](../done/T28-example-streaming-usage.md) |
| Size | S |

## Goal

Add one section to Chapter T11 ("Talking to a model: messages, streams, tokens, instructions and model choice") from research todo [U21](../done/U21-research-fine-tuning-vs-prompting.md)'s report. It is a section, not a chapter: the question arises the moment a reader chooses a model, which Chapter T11 teaches.

U21's report settled the scope, and the owner approved its proposed changes on 2026-11-19 (owner decision 2026-11-19). The topic stays one section. It teaches four points, and its listing is T28's tuned-versus-cached pricing example ([U21 report, Teach](../../research/fine-tuning/fine-tuning-vs-prompting.md#chapter-t11s-section-should-teach-four-points-and-stays-a-section)).

## Context

- [U21](../done/U21-research-fine-tuning-vs-prompting.md)'s [report](../../research/fine-tuning/fine-tuning-vs-prompting.md) and [fact-check](../../research/fine-tuning/fact-check-fine-tuning-vs-prompting.md), including the [MAP reread](../../research/fine-tuning/notes/map-reread.md): MAP's 70% is 14 of 20 interviewed teams, not a survey figure
- [T28](../done/T28-example-streaming-usage.md): the listing, a tuned model priced against a cached prompt, offline
- Chapter T11's todo, [T11](T11-chapter-talking-to-a-model.md), and its fact-check file `apps/manual/fact-checks/talking-to-a-model.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)

## Scope

**In scope**

- One section in `apps/manual/src/content/chapters/talking-to-a-model.md`
- Four points, in this order (owner decision 2026-11-19):
  1. **Tuning changes how a model behaves more than what it knows.** In controlled studies retrieval beats tuning for facts, and tuning on new facts raises hallucination, although two MAP teams tuned for domain knowledge. For formats, labels and tone, tuning works (Ovadia et al.; Gekhman et al.; OpenAI's matrix; MAP).
  2. **Prompt and measure first, and tune to move one job to a smaller model.** All three providers put prompting and evals first, careful prompting beat tuned specialists in medicine, and in U21's reading the agent-tuning papers buy a small model that does one agent's job (Medprompt; GEPA; FireAct; SWE-RL).
  3. **A tuned model is a new model with its own price and a short life.** It costs up to twice the base rate per token on OpenAI, it retires with its base model 16 to 30 months after that model's release, and, by U21's conclusion, it needs the safety evals of a new model (OpenAI pricing and deprecations; Google model versions; Qi et al.).
  4. **Deployed agents mostly prompt.** In MAP, 14 of 20 interviewed teams prompted off-the-shelf models, and the teams that tuned gave latency, volume, domain knowledge or cost as their reasons. The vendors that train agent models with reinforcement learning tie them to their own harness (MAP; Cursor; Cognition).
- The provider status of November 2026 (OpenAI closing its tuning service, Anthropic offering none in its own API, Google alone tuning its current models) in one dated note, so a later edition changes one place; every vendor result labelled as one
- The listing from [T28](../done/T28-example-streaming-usage.md)'s tuned-versus-cached pricing example
- Rows for the section in `apps/manual/fact-checks/talking-to-a-model.md`

**Analogy** (BK22): fine-tuning versus prompting, as sending an employee on a year-long course versus handing a skilled contractor a clear brief. Where the analogy breaks: a fine-tuned model also needs the brief; tuning changes defaults, not the need for instructions. A second break note, approved by the owner on 2026-11-19: the course's certificate expires when the base model retires, and the employee must then retake the course. Use the analogy only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- Any listing that creates a real tuning job: it needs a network and a provider account, and its output would date the book fastest (U21)
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note, and register it in `analogies.json`; otherwise explain the concept plainly.
- [ ] Fact-check every claim in the section against its primary source into `apps/manual/fact-checks/talking-to-a-model.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] The chapter still builds with every check passing, the analogy check included
- [ ] `apps/manual/fact-checks/talking-to-a-model.md` has the section's rows and the re-check rows, with an updated tally
- [ ] The pull request records the 5C and voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job.

## Docs to update

- The book plan's §4.3 row

## Risks and open questions

- U21 found that the topic fits one section, and the owner agreed on 2026-11-19, so the risk that it needs a chapter is closed.
- OpenAI stops all new training jobs on 6 January 2027, so the dated provider note may be out of date before the section ships. Re-read the three providers' pages when drafting.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
