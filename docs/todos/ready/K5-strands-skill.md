# K5: Strands skill, tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K5` |
| Status | `ready` |
| Plan | [Agent skills §4](../../plans/agent-skills.md#4-todos) |
| Round / milestone | M2d (added 2026-11-18) |
| Depends on | [C6](C6-comparison-strands.md) |
| Size | S |

## Goal

Write `.agents/skills/strands/SKILL.md` in the [skills format](../../../.agents/skills/README.md), and prove it by having a fresh agent build the triage agent from the skill alone.

## Context

- The Strands reference and comparison
- The eight existing skills as models

## Scope

**In scope**

- The skill and its row in the skills README

**Out of scope** (and which todo covers it)

- None

## Tasks

- [ ] Draft the skill with `/anthropic-skills:writing`; check its setup code type-checks against the pins
- [ ] Have a fresh agent build the triage agent from the skill alone and pass the capstone checks
- [ ] Apply the fresh agent's fixes and review with `/anthropic-skills:writing-review`

## Acceptance criteria

- [ ] The fresh-agent build passes offline
- [ ] The skill names the safety steps (no AWS credentials, explicit sandbox, host tools denied)

## Tests

The fresh-agent build, run with the Strands harness.

## Docs to update

`.agents/skills/README.md`.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, fact-checked, and reviewed whole with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; delivered through its own pull request, squash-merged after CI passes
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
