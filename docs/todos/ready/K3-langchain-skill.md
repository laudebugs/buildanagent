# K3: LangChain skill, written, reviewed and tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K3` |
| Status | `ready` |
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

- [ ] Draft with the writing skill and type-check the setup snippet against the pinned packages
- [ ] Review with the review skill and apply fixes
- [ ] Run a fresh-agent build of the triage agent; fix the skill where the agent went wrong
- [ ] Push

## Acceptance criteria

- [ ] The fresh-agent build passes offline
- [ ] Review fixes applied

## Tests

The fresh-agent build, run with the LangChain harness.

## Docs to update

`.agents/skills/README.md`.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
