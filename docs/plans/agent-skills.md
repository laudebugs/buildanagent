# Plan: one agent skill per SDK, so coding agents use each SDK the verified way (Round K)

- **Status:** Draft
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): a skill for each agent SDK in `.agents/skills`, symlinked to `.claude/skills`
- **Builds on:** the four references from [Round S](sdk-references.md) and the [comparison](sdk-comparison.md)
- **Todos:** Round K on the [todo board](../todos/README.md); §4 lists them.

## 1. Goal

A coding agent working in this repo (Claude Code, Codex, OpenCode, Pi) loads a skill when a task touches one of the four SDKs. The skill gives it the verified way to build with that SDK: the setup, the patterns that work, the gotchas the fact-checks found, and how to test offline. The agent then writes code that matches the references instead of guessing from training data.

## 2. Layout

```
.agents/skills/                 # the source of truth, readable by any agent
  claude-agent-sdk/SKILL.md
  pi/SKILL.md
  openai-agents-sdk/SKILL.md
  vercel-ai-sdk/SKILL.md
.claude/skills -> ../.agents/skills   # symlink, so Claude Code discovers the same files
```

- **One folder per skill,** named in kebab-case, each with a `SKILL.md` whose frontmatter has `name` and a `description` that says when to load it ("Use when writing or reviewing code that uses @openai/agents…").
- **The symlink is relative,** so it works in every clone. `AGENTS.md` documents it the way it documents `CLAUDE.md`.
- **Skills link to the references** rather than copying them, and they stay short enough to load in full.

## 3. What each skill contains

1. **When to use it,** and when another SDK fits better (from the comparison).
2. **A minimal working setup** at the pinned version, copied from a verified example.
3. **The patterns that hold:** tools, gating, structured output, sessions, testing with the SDK's mock model.
4. **The gotchas,** each from a fact-check finding, such as Claude's draft-07 schemas or Pi's ambient-credential default.
5. **How to verify:** the `pnpm --filter … test` command for the SDK's harness.

K2 drafts each skill with `/anthropic-skills:writing` and reviews it with `/anthropic-skills:writing-review`. A skill is done when a fresh agent session, given only the skill, builds the triage agent and passes that SDK's capstone test.

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| K1 | Skills folder, `.claude/skills` symlink, and the skill format | C2 |
| K2 | Four SDK skills, written, reviewed and tested by a fresh agent | K1 |

## 5. Risks

- **Skills that go stale.** A skill pinned to one SDK version misleads after an upgrade. Mitigation: each skill states its version, and the upgrade steps in each reference's README add "update the skill".

## 6. Open questions

- Should a fifth skill cover "building on our own harness" once it exists? Decide in the next phase.
