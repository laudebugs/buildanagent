# LangChain.js reference

TypeScript reference for [LangChain.js](https://github.com/langchain-ai/langchainjs) v1 agents, pinned to **`langchain@1.6.1`** with `@langchain/core@1.3.4`, `@langchain/langgraph@1.6.0`, `@langchain/anthropic@1.6.0` and `@langchain/openai@1.8.0`: the newest releases at least two weeks old on 2026-11-18. The owner added LangChain as the fifth SDK on 2026-11-18.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: `createAgent` and its graph, model ids, tools, middleware, human approval, structured output, threads and stores, the recursion limit, streaming, testing with `fakeModel()`, a production checklist and the triage-agent capstone |
| [fact-check.md](fact-check.md) | How accurate the JS docs are: type-checks of 713 blocks, offline runs, an API-surface diff and behavioral tests |
| [`source/`](source/) | Mirror of 44 pages and the 97 snippets they import, with the MIT `LICENSE`, from `langchain-ai/docs` at commit `9d9747d` (2026-11-17). The docs repo has no release tags, so the mirror records a commit; `_manifest.json` lists every file |
| [../../../verify/langchain/](../../../verify/langchain/) | Verification harness, scripted-model runner, and our 10 verified examples |

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/langchain
pnpm run fetch-docs     # -> docs/reference/langchain/source/ (commit pinned in scripts/fetch-docs.mjs)
pnpm run verify         # all tiers; writes verify/langchain/results/*.json
```

## Upgrading the pinned version

1. Bump the five packages in `verify/langchain/package.json` to exact releases at least one week old, or to the latest fixed release if a pin has a known vulnerability.
2. Update `COMMIT` in `scripts/fetch-docs.mjs` to the docs commit you want, then `pnpm install`, `pnpm run fetch-docs` and `pnpm run verify`.
3. Re-check F1 (bare model ids) and F4 (`ToolRuntime.store`) against the new release, and the `ahead-of-release` list in `results/typecheck-docs.json`.
4. Diff `results/*.json` against the previous run, then update `guide.md`, `fact-check.md` and the LangChain skill.
