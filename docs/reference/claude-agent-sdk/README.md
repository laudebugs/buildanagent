# Claude Agent SDK reference

TypeScript reference for `@anthropic-ai/claude-agent-sdk`, pinned to **0.3.327**, which includes the bundled Claude Code CLI. Docs were fetched 2026-11-18.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: architecture, install, the loop, options, tools, MCP, permissions, hooks, structured output, sessions, subagents, production checklist, and a step-by-step "build an agent" walkthrough |
| [fact-check.md](fact-check.md) | How accurate the upstream docs are: type-checks of all 385 TS blocks, mock-model runs, an API-surface diff and behavioral tests |
| `source/` | Mirror of the 32 upstream pages as Markdown. **Not committed:** the docs are © Anthropic and not openly licensed. Regenerate it below |
| [../../../verify/claude-agent-sdk/](../../../verify/claude-agent-sdk/) | Verification harness, mock Anthropic API, and our 7 verified examples |

## Regenerate the mirror and re-verify

```bash
cd verify/claude-agent-sdk
npm install
npm run fetch-docs      # -> docs/reference/claude-agent-sdk/source/ (from code.claude.com/docs/llms.txt)
npm run verify          # all tiers; writes verify/claude-agent-sdk/results/*.json
```

Upstream pages are also readable directly as Markdown, for example `https://code.claude.com/docs/en/agent-sdk/overview.md`. The page index is at `https://code.claude.com/docs/llms.txt`.

## Upgrading the pinned version

1. Bump `@anthropic-ai/claude-agent-sdk` in `verify/claude-agent-sdk/package.json`, using an exact version.
2. `npm install && npm run fetch-docs && npm run verify`.
3. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.
