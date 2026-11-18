# Vercel AI SDK reference

TypeScript reference for the [Vercel AI SDK](https://github.com/vercel/ai), pinned to **`ai@7.0.162`**, the newest release at least two weeks old on 2026-11-18, with `@ai-sdk/openai@4.0.108` and `@ai-sdk/anthropic@4.0.96`. Docs mirrored from git tag `ai@7.0.162`. The scope is the agent-relevant core the owner chose: AI SDK Core, agents, harnesses, the core reference, the OpenAI and Anthropic provider pages and the Node cookbook.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: the loop, model routing, tools and stop conditions, `ToolLoopAgent`, `prepareStep`, tool approval, structured output, streaming, MCP, what lives outside the core, offline testing, telemetry, a production checklist and the triage-agent capstone |
| [fact-check.md](fact-check.md) | How accurate the docs are: type-checks of 741 blocks, offline runs, an API-surface diff and behavioral tests |
| [`source/`](source/) | Mirror of the 74 in-scope pages and the Apache-2.0 `LICENSE`, at tag `ai@7.0.162`. Committed, because the license allows redistribution; `_manifest.json` lists every page |
| [../../../verify/vercel-ai-sdk/](../../../verify/vercel-ai-sdk/) | Verification harness, mock-model runner, and our 9 verified examples |

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/vercel-ai-sdk
pnpm run fetch-docs     # -> docs/reference/vercel-ai-sdk/source/ (from tag ai@<pinned version>)
pnpm run verify         # all tiers; writes verify/vercel-ai-sdk/results/*.json
```

## Upgrading the pinned version

1. Bump `ai` in `verify/vercel-ai-sdk/package.json` to an exact release at least one week old (or the latest fixed release if the current pin has a known vulnerability), and bump every `@ai-sdk/*` package to the version published with it (the one whose `ai` or `@ai-sdk/provider` dependency matches).
2. `pnpm install`, then `pnpm run fetch-docs && pnpm run verify` inside `verify/vercel-ai-sdk`.
3. Check that the docs site still renders `__MODEL__` as `"anthropic/claude-sonnet-5.5"`, and update `MODEL` in `scripts/extract-examples.mjs` if it changed.
4. Re-review the hand classifications in `scripts/typecheck-examples.mjs` (`CONTEXT_IDS`).
5. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.
