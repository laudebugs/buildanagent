# K1: Skills folder, `.claude/skills` symlink, and the skill format

| Field | Value |
| --- | --- |
| ID | `K1` |
| Status | `ready` |
| Plan | [Agent skills §2](../../plans/agent-skills.md#2-layout) |
| Round / milestone | Round K (skills), M2 |
| Depends on | [C2](../ready/C2-deep-comparison.md) |
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

- [ ] Create `.agents/skills/README.md` describing the format (folder per skill, `SKILL.md` with `name` and `description` frontmatter)
- [ ] Create the relative symlink `.claude/skills -> ../.agents/skills` and confirm git stores it as a symlink
- [ ] Document both in AGENTS.md's layout section
- [ ] Push

## Acceptance criteria

- [ ] `ls -l .claude/skills` shows a relative symlink
- [ ] A Claude Code session lists skills from the folder
- [ ] AGENTS.md documents the layout

## Tests

Start a fresh session and check that it discovers a placeholder skill; remove the placeholder after.

## Docs to update

AGENTS.md.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
