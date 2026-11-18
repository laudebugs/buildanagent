# K3: LangChain skill, written, reviewed and tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K3` |
| Status | `done` |
| Plan | [Agent skills §4](../../plans/agent-skills.md#4-todos) |
| Round / milestone | Round K (skills), M2b |
| Depends on | [S5b](../done/S5b-langchain-reference.md) |
| Size | S |

## Goal

Write `.agents/skills/langchain/SKILL.md` in the same five sections as the other SDK skills, and prove it by having a fresh agent build the triage agent from the skill alone.

## Context

- The LangChain reference (S5b), and the K2 skill-test lessons (testing recipes, mock call splits, home-folder defaults)

## Scope

**In scope**

- The skill and its row in `.agents/skills/README.md`

**Out of scope** (and which todo covers it)

- None

## Tasks

- [x] Draft with the writing skill and type-check the setup snippet against the pinned packages
- [x] Review with the review skill and apply fixes
- [x] Run a fresh-agent build of the triage agent; fix the skill where the agent went wrong
- [x] Push

## Acceptance criteria

- [x] The fresh-agent build passes offline
- [x] Review fixes applied

## Tests

The fresh-agent build, run with the LangChain harness.

## Docs to update

`.agents/skills/README.md`.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The skill's setup snippet type-checks against the pinned packages. A fresh agent given only the skill built the triage agent and passed on the first attempt, with no wrong claims found. Its report added four clarifications: pass `fakeModel()` straight to `createAgent`, `fakeModel()` takes the tool path for `responseFormat`, a call rejected by human approval never reaches `wrapToolCall`, and the runner does not type-check.
