# K1: Skills folder, `.claude/skills` symlink, and the skill format

| Field | Value |
| --- | --- |
| ID | `K1` |
| Status | `done` |
| Plan | [Agent skills §2](../../plans/agent-skills.md#2-layout) |
| Round / milestone | Round K (skills), M2 |
| Depends on | [C2](../done/C2-deep-comparison.md) |
| Size | S |

## Goal

Create `.agents/skills/` as the source of truth for repo skills, symlink `.claude/skills` to it, and document the skill format, so K2 can write the four SDK skills.

## Context

- The [agent skills plan](../../plans/agent-skills.md)
- How CLAUDE.md already symlinks to AGENTS.md

## Scope

**In scope**

- The folder, the relative symlink, a skill-format note in AGENTS.md

**Out of scope** (and which todo covers it)

- The four skills (K2)

## Tasks

- [x] Create `.agents/skills/README.md` describing the format (folder per skill, `SKILL.md` with `name` and `description` frontmatter)
- [x] Create the relative symlink `.claude/skills -> ../.agents/skills` and confirm git stores it as a symlink
- [x] Document both in AGENTS.md's layout section
- [x] Push

## Acceptance criteria

- [x] `ls -l .claude/skills` shows a relative symlink
- [x] A Claude Code session lists skills from the folder
- [x] AGENTS.md documents the layout

## Tests

Start a fresh session and check that it discovers a placeholder skill; remove the placeholder after.

## Docs to update

AGENTS.md.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`.agents/skills/` with a README on the format; `.claude/skills` is a relative symlink stored by git as mode 120000; AGENTS.md documents both. Claude Code lists all four skills from the folder.
