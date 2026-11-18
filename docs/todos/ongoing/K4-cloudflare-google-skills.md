# K4: Cloudflare, Google ADK and Copilot skills, each tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K4` |
| Status | `ongoing` |
| Plan | [Agent skills §4](../../plans/agent-skills.md#4-todos) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [C4](../ready/C4-comparison-cloudflare-google.md) |
| Size | S |

## Goal

Write `.agents/skills/{cloudflare-agents,google-adk,copilot-sdk}/SKILL.md` in the format of [the skills plan §3](../../plans/agent-skills.md#3-what-each-skill-contains). Each is done when a fresh agent, given only the skill, builds the triage agent and passes that SDK's capstone test.

## Context

- The [SDK references plan](../../plans/sdk-references.md), sections S6, S7 and the language policy
- The five finished skills in `.agents/skills/` and the eight references

## Scope

**In scope**

- As named in the title; see the plan section for packages, docs, test model and behaviors

**Out of scope** (and which todo covers it)

- Skills for other languages

## Tasks

- [ ] Do the work the title names, following the plan section
- [ ] Draft any prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [ ] Run the local checks and push

## Acceptance criteria

- [ ] The deliverables named in the plan exist and pass review
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Cloudflare needs the Workers runtime locally (workerd); Google's TypeScript ADK lags its Python primary. Record both in the fact-checks.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
