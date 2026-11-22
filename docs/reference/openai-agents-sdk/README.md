# OpenAI Agents SDK reference

TypeScript reference for the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js), pinned to **`@openai/agents@0.22.0`**, the newest release at least one week old on 2026-11-22. Docs mirrored from git tag `v0.22.0`.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: the loop, tracing, agent options, tools, handoffs, guardrails, human approval, sessions, structured output, streaming, sandbox agents, offline testing, providers, a production checklist and a step-by-step "build an agent" walkthrough |
| [fact-check.md](fact-check.md) | How accurate the docs are: type-checks of 182 sources, offline runs, an API-surface diff and behavioral tests |
| [`source/`](source/) | Mirror of the 32 English docs pages, the `examples/docs` files they embed, and the MIT `LICENSE`, at tag `v0.22.0`. Committed, because the license allows redistribution |
| [../../../verify/openai-agents-sdk/](../../../verify/openai-agents-sdk/) | Verification harness, scripted-model runner, and our 9 verified examples |

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/openai-agents-sdk
pnpm run fetch-docs     # -> docs/reference/openai-agents-sdk/source/ (from tag v<pinned version>)
pnpm run verify         # all tiers; writes verify/openai-agents-sdk/results/*.json
```

## Upgrading the pinned version

1. Bump every `@openai/agents*` version in `verify/openai-agents-sdk/package.json` to the same exact release, at least one week old.
2. `pnpm install`, then `pnpm run fetch-docs && pnpm run verify` inside `verify/openai-agents-sdk`.
3. Check the sandbox tool names in `scripts/scripted-model.mjs` against the new release, so the scripted model still denies them.
4. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.
