# K4: Cloudflare, Google ADK and Copilot skills, each tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K4` |
| Status | `done` |
| Plan | [Agent skills §4](../../plans/agent-skills.md#4-todos) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [C4](../done/C4-comparison-cloudflare-google.md) |
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

- [x] Do the work the title names, following the plan section
- [x] Draft any prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [x] Run the local checks and push

## Acceptance criteria

- [x] The deliverables named in the plan exist and pass review
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Cloudflare needs the Workers runtime locally (workerd); Google's TypeScript ADK lags its Python primary. Record both in the fact-checks.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Each skill's setup type-checks against its pinned packages. A fresh agent given only the skill built the triage agent and passed on the first attempt for all three, with no wrong claims except one understatement: the Cloudflare skill listed three of Think's seven workspace tools (the reference lists all seven). The `activeTools` allowlist, untested when the skill was written, was verified by the Cloudflare build. Each tester's notes were applied after checking them against the harness code.
