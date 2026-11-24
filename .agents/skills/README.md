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
| [cloudflare-agents](cloudflare-agents/SKILL.md) | Code imports `agents`, `@cloudflare/think` or `@cloudflare/ai-chat` |
| [google-adk](google-adk/SKILL.md) | Code imports `@google/adk` |
| [copilot-sdk](copilot-sdk/SKILL.md) | Code imports `@github/copilot-sdk` |
| [building-a-workflow-with-a-model](building-a-workflow-with-a-model/SKILL.md) | Planning, evaluating or running a workflow in which a model does part of a job on structured data, such as a spreadsheet import |
| [anatomy](anatomy/SKILL.md) | Drawing an isometric figure for the book in `apps/manual`; vendored, see below |

## The anatomy skill is vendored, not ours

`anatomy/` is a copy of the MIT-licensed [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) at commit `1482e84`, which the owner approved vendoring on 2026-11-19. Its `SKILL.md` stays as upstream wrote it, so it keeps its own references and does not follow the format above. Leave its files unchanged, and update it only by copying a newer upstream commit, as [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) describes. The book's figure scripts reach its kit through `apps/manual/figures/lib/isokit.ts`.

Agents in this repository never publish a figure to the anatomy community gallery and never read session logs. The copy leaves out the gallery's publishing and session scripts, though its `SKILL.md` still mentions them.
