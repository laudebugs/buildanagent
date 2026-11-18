# GitHub Copilot SDK reference

TypeScript reference for the [GitHub Copilot SDK](https://github.com/github/copilot-sdk), pinned to **`@github/copilot-sdk@1.0.31`** (MIT, published 2026-11-10), which bundles the Copilot runtime **1.0.109**. The SDK drives that runtime, the engine behind Copilot CLI, over JSON-RPC. It ships in six official languages from one repository: Node.js/TypeScript, Python, Go, .NET, Java and Rust (as of November 2026).

| File | What it is |
|---|---|
| `guide.md`, `fact-check.md` | To come in S8b |
| [`source/`](source/) | Mirror of `github/copilot-sdk` at tag `v1.0.31` (commit `15de061`, 2026-11-10): `docs/`, the Node.js README, docs and examples, the TS/JS samples, the other languages' READMEs, and the MIT `LICENSE`. `_manifest.json` lists every file |
| [../../../verify/copilot-sdk/](../../../verify/copilot-sdk/) | Verification harness: the real runtime against a mock model through the BYOK provider, in a network namespace, with 9 behavioral examples |

## Sources and license

- The npm package's `repository` field names `github/copilot-agent-runtime`, which is not public as of November 2026 (the GitHub API returns no access). The public `github/copilot-sdk` repository is the SDK's published snapshot, tagged `v<version>` for each release, so the mirror comes from tag `v1.0.31`.
- `github/copilot-sdk` is MIT-licensed, so the mirror is committed.
- The runtime (the `copilot-runtime` binary and `runtime.node` in the optional `@github/copilot-sdk-<platform>` packages, and `@github/copilot`) is under the GitHub Copilot CLI License ("SEE LICENSE IN LICENSE.md" in `@github/copilot@1.0.109`). That license covers only the software: it permits installing, running and redistributing unmodified copies as part of an application, and forbids standalone redistribution. Nothing from the CLI package (its README is its only document) is mirrored, and no runtime binary is committed; pnpm installs it under `node_modules/`.

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/copilot-sdk
pnpm run fetch-docs     # -> docs/reference/copilot-sdk/source/ (tag pinned in scripts/fetch-docs.mjs)
pnpm run verify         # all tiers; writes verify/copilot-sdk/results/*.json
```

## Upgrading the pinned version

1. Bump `@github/copilot-sdk` in `verify/copilot-sdk/package.json` to an exact release at least one week old, or to the latest fixed release if the pin has a known vulnerability. The runtime version comes with it (`copilotCliVersion` in the SDK's `package.json`).
2. Update `TAG` in `scripts/fetch-docs.mjs`, then `pnpm install`, `pnpm run fetch-docs` and `pnpm run verify`.
3. Re-check the reviewed lists in `scripts/run-examples.mjs` (`SKIP_IDS`, `REVIEWED`) and `scripts/typecheck-examples.mjs` (`PRELUDE_CONTEXT_IDS`), and whether the runtime still ignores `COPILOT_PROVIDER_*` in SDK sessions.
4. Diff `results/*.json` against the previous run.
