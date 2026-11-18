# Agent skills

Skills that coding agents (Claude Code, Codex, OpenCode, Pi) load when a task needs them. This folder is the source of truth; `.claude/skills` is a relative symlink to it, so Claude Code discovers the same files.

## Format

- **One folder per skill,** named in kebab-case, such as `vercel-ai-sdk/`.
- **A `SKILL.md` in each folder,** starting with YAML frontmatter:

  ```markdown
  ---
  name: vercel-ai-sdk
  description: Use when writing, reviewing or testing TypeScript that imports `ai` or `@ai-sdk/*` …
  ---
  ```

  `name` matches the folder. `description` says *when* to load the skill, because agents decide from the description alone.
- **Short enough to load in full.** A skill links to the references in `docs/reference/<sdk>/` for detail instead of copying them.
- **Pinned.** Each SDK skill states the version it was checked against, and the reference's upgrade steps include updating the skill.

## Skills

| Skill | Use when |
|---|---|
| [claude-agent-sdk](claude-agent-sdk/SKILL.md) | Code imports `@anthropic-ai/claude-agent-sdk` |
| [pi](pi/SKILL.md) | Code imports `@earendil-works/pi-*` |
| [openai-agents-sdk](openai-agents-sdk/SKILL.md) | Code imports `@openai/agents` |
| [vercel-ai-sdk](vercel-ai-sdk/SKILL.md) | Code imports `ai` or `@ai-sdk/*` |
| [langchain](langchain/SKILL.md) | Code imports `langchain` or `@langchain/*` |
