# Cloudflare Agents reference

TypeScript reference for the [Cloudflare Agents SDK](https://github.com/cloudflare/agents), pinned to **`agents@0.33.0`** with `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2`. These are the latest npm releases as of November 2026, and all were published by 2026-11-04. All three are MIT-licensed. TypeScript is the SDK's primary language. The owner added Cloudflare as the sixth SDK on 2026-11-18.

| File | What it is |
|---|---|
| `guide.md` | Our reference (todo S6b, not written yet) |
| `fact-check.md` | How accurate the docs are, in four tiers (todo S6b, not written yet) |
| [`source/`](source/) | The docs mirror. `source/agents/` comes from `cloudflare/agents` at tag `agents@0.33.0` (`docs/agents`, root and package READMEs, and the server sources of 19 linked examples), with `docs/think` from `@cloudflare/think@0.23.0` and the ai-chat README from `@cloudflare/ai-chat@0.12.2` (MIT, `LICENSE`). `source/cloudflare-docs/` holds the `developers.cloudflare.com/agents/` pages from `cloudflare/cloudflare-docs` commit `6897a9f` (2026-11-18), with content under CC-BY-4.0 (`LICENSE`), code under MIT (`LICENSE-CODE`), and an `ATTRIBUTION.md`. `_manifest.json` records every repo, tag, commit and the fetch date |
| [../../../verify/cloudflare-agents/](../../../verify/cloudflare-agents/) | Verification harness: esbuild bundles run in workerd through Miniflare, mock models, and our 9 verified examples |

The cloudflare-docs pages render a branch, not a release. They run ahead of 0.33.0 in places (names that exist only on the `cloudflare/agents` main branch) and behind it in others (import paths that no release has). `verify/cloudflare-agents/results/typecheck-docs.json` marks the first kind `ahead-of-release`.

## Regenerate the mirror and re-verify

```bash
pnpm install                  # at the repo root: installs every harness, including workerd
cd verify/cloudflare-agents
pnpm run fetch-docs           # -> docs/reference/cloudflare-agents/source/ (tags and commit pinned in scripts/fetch-docs.mjs)
pnpm run verify               # all tiers; writes verify/cloudflare-agents/results/*.json
```

## Upgrading the pinned version

1. Bump `agents`, `@cloudflare/think` and `@cloudflare/ai-chat` in `verify/cloudflare-agents/package.json` to exact releases at least two weeks old, with `miniflare`, `@cloudflare/workers-types` and `COMPAT_DATE` in `scripts/workerd.mjs` matching one workerd release.
2. Update the tags in `AGENTS_TAGS` and `DOCS_COMMIT` in `scripts/fetch-docs.mjs`, then run `pnpm install`, `pnpm run fetch-docs` and `pnpm run verify`.
3. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.
