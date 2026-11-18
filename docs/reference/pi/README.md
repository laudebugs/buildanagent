# Pi reference

TypeScript reference for [Pi](https://github.com/earendil-works/pi), pinned to **1.5.2** (`@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`). Docs mirrored from git tag `v1.5.2` on 2026-11-18.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: the three layers, sessions and events, tools, extensions as the only gate, steering, the session tree, compaction, structured output, CLI modes, offline testing with the faux provider, a production checklist and a step-by-step "build an agent" walkthrough |
| [fact-check.md](fact-check.md) | How accurate Pi's docs are: type-checks of 334 TypeScript sources, offline runs, an API-surface diff and behavioral tests |
| [`source/`](source/) | Mirror of `packages/coding-agent/docs`, the three package READMEs and `packages/coding-agent/examples` at tag `v1.5.2`, with Pi's MIT `LICENSE`. Committed, because the license allows redistribution |
| [../../../verify/pi/](../../../verify/pi/) | Verification harness, faux-model runner and our 8 verified examples |

Read the mirror, or the docs at the matching git tag, rather than docs.pi.dev/latest: the live site renders the repo's main branch, which runs ahead of the npm release (fact-check, F1).

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/pi
pnpm run fetch-docs     # -> docs/reference/pi/source/ (from tag v<pinned version>)
pnpm run verify         # all tiers; writes verify/pi/results/*.json
```

## Upgrading the pinned version

1. Bump all `@earendil-works/*` versions in `verify/pi/package.json` to the same exact release, along with `typebox` if `pi-coding-agent` changed it.
2. `pnpm install`, then `pnpm run fetch-docs && pnpm run verify` inside `verify/pi`.
3. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.
