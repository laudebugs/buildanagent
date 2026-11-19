# L1: Build both packages to `dist/`, with `types`-first exports and a `source` condition

| Field | Value |
| --- | --- |
| ID | `L1` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [Q1](Q1-strict-compiler-and-lint.md) |
| Size | M |

## Goal

Make `@buildanagent/gateway` and `@buildanagent/sdk` publishable: compiled JavaScript and declarations in `dist/`, while tests and type-checks in the repo keep reading `src/` with no build step ([PB3](../../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-accepted), ADR 0050).

## Context

- [PB3](../../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-accepted) and [ADR 0050](../../decisions/0050-dist-build-with-source-condition.md)
- [typescript.md](../../guidelines/typescript.md): modules and packaging
- Lamina PDF's `packages/sdk/package.json` (exports with `types` first, `files`, `sideEffects`, `engines`)

## Scope

**In scope**

- A `tsconfig.build.json` per package: `module` and `moduleResolution` `NodeNext`, `declaration`, `declarationMap`, `sourceMap`, `outDir: dist`, `src/` only, and `customConditions: []` so the build never follows `source`
- Relative imports rewritten from `.ts` to `.js` specifiers; `allowImportingTsExtensions` off for the build
- `exports` whose every entry, including `./testing` and `./testing/setup`, lists `source`, then `types`, then `default`. TypeScript and Node take the first condition that matches, so `source` must come before `types`
- `publishConfig.exports` that lists only `types`, then `default`, so the packed `package.json` has no `source` condition and keeps "types first"
- `files: ["dist"]`, `sideEffects: false`, `engines.node: ">=22"`, `repository`, `homepage`, `license`
- `customConditions: ["source"]` in `tsconfig.base.json`
- `ssr.resolve.conditions: ["source", "module", "node", "development|production"]` in each `vitest.config.ts`. Vitest 5.1.0 runs on Vite 8, which replaces its defaults with the list you give, and Node tests resolve through the SSR environment. The three entries after `source` are Vite 8's `defaultServerConditions`, spelled out because `vitest/config` doesn't re-export them and pnpm won't let a package import `vite` without declaring it
- A `build` script in each package, and a root `pnpm build` that runs `pnpm -r build`, which builds in dependency order
- `LICENSE`, `LICENSE-APACHE` and `LICENSE-MIT` copied into each package by a `prepack` script, and listed in `files`

**Out of scope** (and which todo covers it)

- Changesets and publishing (L2, L3)

## Acceptance criteria

- [ ] `pnpm build` writes `dist/*.js` and `dist/*.d.ts` for every entry of both packages
- [ ] The SDK's `dist/` holds only SDK files, and its `.d.ts` files import `@buildanagent/gateway`, never a path into the gateway's `src/`
- [ ] `pnpm typecheck` and `pnpm test` pass with no `dist/` present (`git clean -xdf packages` first), which proves `source` is reached before `types`
- [ ] A test asserts the Vitest configs' list after `source` equals Vite's `defaultServerConditions`, read from the `vite` that Vitest itself resolves, so a Vite upgrade that changes the defaults fails CI
- [ ] A test packs each package with `pnpm pack` and fails if the tarball holds anything but `package.json`, `dist/`, `README.md`, `CHANGELOG.md` and the licence files, or lacks `LICENSE`, `LICENSE-APACHE` or `LICENSE-MIT`
- [ ] The packed `package.json` has no `source` condition, and a Node script that sets `--conditions=source` still resolves every packed entry to `dist/`
- [ ] A Node script imports each published entry from the packed tarball installed in a temp directory, with no `source` condition, and the imports resolve to `dist/`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The pack test, under `packages/gateway/test/` or `scripts/ci/`.

## Docs to update

[typescript.md](../../guidelines/typescript.md) (replace the line that our private packages export `src/` until L1), AGENTS.md's `packages/` layout line, both package READMEs if install steps change, the plan's todo table.

## Risks and open questions

Vitest's resolver must honour `source` for workspace packages through `ssr.resolve.conditions`; if it doesn't, use a Vitest alias per package instead and record why.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
