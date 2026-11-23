# Cloudflare Agents reference

TypeScript reference for the [Cloudflare Agents SDK](https://github.com/cloudflare/agents), pinned to **`agents@0.33.0`** with `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2`, on `ai@7.0.173`. These are the latest npm releases as of November 2026, all published by 2026-11-04, and all three are MIT-licensed. TypeScript is the SDK's primary language. The owner added Cloudflare as the sixth SDK on 2026-11-18.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: the Agent class as a Durable Object, state, SQL, routing, scheduling, hibernation, the `AIChatAgent` and Think chat loops on the AI SDK, tool approval, MCP server and client, workflows, testing in workerd, a production checklist and the triage-agent capstone |
| [fact-check.md](fact-check.md) | How accurate the docs are: type-checks of 1,927 blocks, runs of 204 blocks and 19 linked examples in workerd, an API-surface diff, behavioral tests and 18 findings |
| [`source/`](source/) | The docs mirror. `source/agents/` comes from `cloudflare/agents` at tag `agents@0.33.0` (`docs/agents`, root and package READMEs, and the server sources of 19 linked examples), with `docs/think` from `@cloudflare/think@0.23.0` and the ai-chat README from `@cloudflare/ai-chat@0.12.2` (MIT, `LICENSE`). `source/cloudflare-docs/` holds the `developers.cloudflare.com/agents/` pages from `cloudflare/cloudflare-docs` commit `6897a9f` (2026-11-18), with content under CC-BY-4.0 (`LICENSE`), code under MIT (`LICENSE-CODE`), and an `ATTRIBUTION.md`. `_manifest.json` records every repo, tag, commit and the fetch date |
| [../../../verify/cloudflare-agents/](../../../verify/cloudflare-agents/) | Verification harness: esbuild bundles run in workerd through Miniflare, mock models, and our 9 verified examples |

The cloudflare-docs pages render a branch, not a release, and the repo's `docs/` on main differ from the tag on 24 pages. Some pages use subpaths and helpers that no release or branch exports (fact-check F7 and F11–F13). The `docs/` folder inside the npm package matches the tag mirror, so the tag is the baseline.

The harness runs on `miniflare@5.20261113.0-beta` (it began on `5.20261103.0-beta`), a deliberate exception to the stable-releases rule. The newest stable miniflare before the cutoff, 4.20260730.0, predates the workerd that `agents@0.33.0` needs, and the newest stable wrangler, 4.157.0, itself depended on the `5.20261103.0-beta` build when the harness was written ([harness README](../../../verify/cloudflare-agents/README.md#why-the-local-runtime-is-a-miniflare-beta)).

## Regenerate the mirror and re-verify

```bash
pnpm install                  # at the repo root: installs every harness, including workerd
cd verify/cloudflare-agents
pnpm run fetch-docs           # -> docs/reference/cloudflare-agents/source/ (tags and commit pinned in scripts/fetch-docs.mjs)
pnpm run verify               # all tiers; writes verify/cloudflare-agents/results/*.json
```

## Upgrading the pinned version

1. Bump `agents`, `@cloudflare/think` and `@cloudflare/ai-chat` in `verify/cloudflare-agents/package.json` to exact releases at least two weeks old, with `miniflare`, `@cloudflare/workers-types` and `COMPAT_DATE` in `scripts/workerd.mjs` matching one workerd release. Move `miniflare` back to a stable release once one supports that workerd.
2. Update the tags in `AGENTS_TAGS` and `DOCS_COMMIT` in `scripts/fetch-docs.mjs`, then run `pnpm install`, `pnpm run fetch-docs` and `pnpm run verify`.
3. Re-check F1 (`runTurn` drops `body`), F2 (`initialState` fires `onStateChanged`), F4 (Think's workspace tools) and F10 (the `hibernate` option) against the new release. Review every `ahead-of-release` entry in `results/typecheck-docs.json` by hand, because the script matches any text on main, internal helpers included.
4. Diff `results/*.json` against the previous run, then update `guide.md` and `fact-check.md`.

## Update to the 2026-11-22 pins

The weekly sweep moved `ai` to 7.0.173, the `@ai-sdk/*` packages, `@cloudflare/workers-types` to 5.20261116.1 and `miniflare` to 5.20261113.0-beta (`workerd@1.20261113.1`) and left `agents`, `@cloudflare/think` and `@cloudflare/ai-chat` unchanged, so the mirror stays at tag `agents@0.33.0`. A rerun of `pnpm run verify` matched the earlier results, and the three claims that cite the moved packages still hold, with one type name corrected in F9 ([fact-check](fact-check.md#update-to-the-2026-11-22-pins)).
