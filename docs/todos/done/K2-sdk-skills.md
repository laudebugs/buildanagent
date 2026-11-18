# K2: Four SDK skills, written, reviewed and tested by a fresh agent

| Field | Value |
| --- | --- |
| ID | `K2` |
| Status | `done` |
| Plan | [Agent skills §3](../../plans/agent-skills.md#3-what-each-skill-contains) |
| Round / milestone | Round K (skills), M2 |
| Depends on | [K1](../done/K1-skills-folder.md) |
| Size | L |

## Goal

Write one skill per SDK in `.agents/skills/`, each built from its reference and the comparison, and prove each one by having a fresh agent session build the triage agent from the skill alone.

## Context

- The four references
- The comparison's 'when to choose' guidance
- The [plan §3](../../plans/agent-skills.md#3-what-each-skill-contains)

## Scope

**In scope**

- `claude-agent-sdk`, `pi`, `openai-agents-sdk` and `vercel-ai-sdk` skills

**Out of scope** (and which todo covers it)

- A skill for our own harness (next phase)

## Tasks

- [x] Draft each `SKILL.md` with `/anthropic-skills:writing`, following the plan's five sections
- [x] Review each with `/anthropic-skills:writing-review` and apply the fixes
- [x] For each skill, start a fresh agent session with only the skill and ask it to build the triage agent; run the SDK's capstone test against the result
- [x] Fix the skill wherever the fresh agent went wrong
- [x] Push

## Acceptance criteria

- [x] Four skills exist with valid frontmatter
- [x] Each skill's fresh-agent build passes that SDK's capstone test
- [x] Review fixes applied

## Tests

The fresh-agent build per skill, checked with the SDK's harness.

## Docs to update

AGENTS.md; each reference README's upgrade steps gain 'update the skill'.

## Risks and open questions

A fresh-agent test needs a separate session; record how each test was run.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Four skills written, reviewed against the writing rules, and their setup snippets type-checked against the pinned packages. Four fresh agents, each given only one skill, built the triage agent offline and passed on the first attempt. Their reports drove fixes: testing recipes for each mock, a call-split note for Vercel approvals, an input-guardrail snippet for OpenAI, corrected tool-search advice and `permission_denials` for Claude. The Pi tester found a real defect, `ModelRuntime.create()` writing `~/.pi/agent/auth.json`, now Pi fact-check F6 with a logged correction to the Pi guide.
