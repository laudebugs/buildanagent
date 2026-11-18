# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, OpenCode, Pi, etc.) working in this repository. `CLAUDE.md` is a symlink to this file, so edit `AGENTS.md` only.

## Project

**agent-speak** researches, and will later build, an AI agent and our own agent harness/SDK. The repo is mostly documentation. The only code is the per-SDK verification harnesses under `verify/`.

## Layout

- `README.md`: project overview and doc index.
- `docs/reference/<sdk>/`: per-SDK reference (`guide.md`, `fact-check.md`, `README.md`). `source/` holds mirrored upstream docs; the Claude mirror is gitignored because those docs are not openly licensed, so regenerate it with `npm run fetch-docs`.
- `verify/<sdk>/`: per-SDK verification harness (Node, exact-pinned deps). `npm run verify` type-checks and runs doc examples against a mock model; `npm test` runs our own examples in `examples/`. Generated folders (`extracted/`, `.tmp/`) are gitignored, while `results/` is committed.
- `docs/research/`: research reports.
  - `agent-sdks-and-harness-design.md`: the main report (SDK comparison, reference architecture, build-vs-buy).
  - `harness-architectures.md`: source-level notes on Pi, Codex, OpenAI Agents SDK sandbox agents and Cloudflare Agents/Think.
  - `fact-check-2026-11-18.md`: verification log for the main report.
  - `notes/`: raw research notes behind the report. Treat them as working material; the report and fact-check log supersede them where they disagree.

## Working on docs

- Cite a source for every factual claim, and prefer primary sources (official docs, repos, papers) over blogs.
- Mark claims taken from search summaries or secondary write-ups as such.
- When you correct a claim in a report, add a row to a fact-check log rather than silently rewriting it.
- Dates matter in this field. Write "as of <month year>" for versions, star counts and spec status.
- Use kebab-case filenames under `docs/`.

## Planned architecture (when code starts)

Follow the reference architecture in `docs/research/agent-sdks-and-harness-design.md`, with the refinements in `docs/research/fact-check-2026-11-18.md`:

1. Model gateway: streaming, retries, prompt caching, cost accounting.
2. Stateless harness loop with explicit stop conditions and hooks (before/after model step, before/after tool call, context transform, steering queue).
3. Append-only, tree-shaped session event log.
4. A small set of well-designed tools, plus an MCP client.
5. Layered context policy: between-turn, mid-turn and overflow-retry compaction.
6. File-based memory first.
7. Sandbox behind a pluggable interface, with separate sandbox and approval policies and no credentials inside the sandbox.
8. OTel `gen_ai.*` spans and an eval suite that measures against a mini-swe-agent baseline.

Each component should be removable so it can be ablated as models improve.

## Verifying SDK examples

- Pin SDK versions exactly in `verify/<sdk>/package.json`; reference docs state the version they were checked against.
- Mark guide claims backed by a runnable example as **[verified]**, and cite the upstream page for everything else.
- Mock models must never call tools that touch the host (shell, file edits).

## Git

- Commit messages: imperative mood, with a short summary line.
- Never commit secrets or `.env` files.
