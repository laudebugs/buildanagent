# U24: Research: redesign versus AI for one workflow

| Field | Value |
| --- | --- |
| ID | `U24` |
| Status | `done` |
| Plan | [Build guides §4d, U24](../../plans/build-guides.md#u24-research-redesign-versus-ai-for-one-workflow-added-2026-11-23) |
| Round / milestone | Research (added 2026-11-23) |
| Depends on | None |
| Size | L |

## Goal

Answer the owner's question: should we use an AI chat, a workflow or an agent to solve a problem that redesigning the app would solve? The owner wants to measure some of the workflows they run. Their hypothesis is that agents can simplify a workflow, but for plain workflows the gain from a model in the loop is often marginal, and a redesign (defaults, fewer steps, better search) may fix the real problem. The owner's four-question graphic ends in four outcomes: redesign, plain code, one model call in a fixed workflow, agent. **Research question:** What does the evidence say about when a model in the loop beats a redesign, how should the owner measure one workflow before and after, and what decision rule should Chapter 1 teach?

## Context

- [Chapter 1, "Use the least autonomy that works"](../../../apps/manual/src/content/chapters/call-workflow-loop.md): the four questions it already asks and the Anthropic quotation it opens with
- [The fine-tuning report](../../research/fine-tuning/fine-tuning-vs-prompting.md) and its [fact-check log](../../research/fine-tuning/fact-check-fine-tuning-vs-prompting.md): the model for structure, depth and tone, and a full reread of MAP
- [AGENTS.md, the five document steps](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), including the rule that a paper claim is checked against the whole paper

## Scope

**In scope**

- A report in `docs/research/redesign-vs-ai/` with a fact-check file beside it
- A before-and-after measurement method for one workflow, with a worked example on made-up numbers
- A decision rule that matches the owner's four outcomes, and proposed text for Chapter 1

**Out of scope** (and which todo covers it)

- Editing Chapter 1 or any plan: proposed in the report, decided by the owner
- Running a real measurement of the owner's workflows

## Tasks

- [x] Gather primary sources first; mark anything taken from a secondary write-up as such.
- [x] Draft each section with `/anthropic-skills:writing`, and fact-check it into the log before drafting the next.
- [x] Run `/anthropic-skills:writing-review` on the whole report, fix every finding, and re-check every claim a fix touched.
- [x] Add the folder to AGENTS.md's research list and README's docs table.

## Acceptance criteria

- [x] The report answers the research question in its thesis, and every number has a fact-check row
- [x] The log marks every claim ✅, ✏️ or ⚠️
- [x] The worked example is labelled illustrative and its arithmetic can be checked in the text
- [x] Every relative link resolves
- [x] `pnpm check` passes

## Tests

None beyond `pnpm check`, `pnpm fact-check-logs` and the link check; the report is prose.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout and the [README](../../../README.md) docs table
- The [build guides plan](../../plans/build-guides.md): the U24 section and todo row

## Risks and open questions

- Some papers sit behind publishers; a claim read only at an abstract or a secondary write-up is ⚠️.
- The owner's graphic is not in the repo, so the report proposes its own four questions.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check` passes locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

The report is [redesign-vs-ai.md](../../research/redesign-vs-ai/redesign-vs-ai.md), with its [fact-check log](../../research/redesign-vs-ai/fact-check-redesign-vs-ai.md) (122 claims: 87 ✅, 13 ✏️, 22 ⚠️, after the first code-review round). Its thesis is that no study we verified compares a model with a redesign, that defaults, fewer steps and search show large effects with no model, and that the owner can settle the question for one workflow with a pre-registered four-arm paired measurement. It adds three randomized model-versus-search studies. It proposes four questions that give the owner's four outcomes, with every path listed, one section for Chapter 1 and six plan changes. Two papers were paywalled and are checked at their abstracts only. The code-review rounds and the writing review stay open until the pull request's rounds finish.
