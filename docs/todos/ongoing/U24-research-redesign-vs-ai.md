# U24: Research: redesign versus AI for one workflow

| Field | Value |
| --- | --- |
| ID | `U24` |
| Status | `ongoing` |
| Plan | [Build guides §4d, U24](../../plans/build-guides.md#u24-research-redesign-versus-ai-added-2026-11-23) |
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

- [ ] Gather primary sources first; mark anything taken from a secondary write-up as such.
- [ ] Draft each section with `/anthropic-skills:writing`, and fact-check it into the log before drafting the next.
- [ ] Run `/anthropic-skills:writing-review` on the whole report, fix every finding, and re-check every claim a fix touched.
- [ ] Add the folder to AGENTS.md's research list and README's docs table.

## Acceptance criteria

- [ ] The report answers the research question in its thesis, and every number has a fact-check row
- [ ] The log marks every claim ✅, ✏️ or ⚠️
- [ ] The worked example is labelled illustrative and its arithmetic can be checked in the text
- [ ] Every relative link resolves
- [ ] `pnpm check` passes

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
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check` passes locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
