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

Make `@buildanagent/gateway` and `@buildanagent/sdk` publishable: compiled JavaScript and declarations in `dist/`, while tests and type-checks in the repo keep reading `src/` with no build step ([PB3](../../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-proposed), ADR 0050).

## Context

- [PB3](../../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-proposed) and [ADR 0050](../../decisions/0050-dist-build-with-source-condition.md)
- [typescript.md](../../guidelines/typescript.md): modules and packaging
- Lamina PDF's `packages/sdk/package.json` (exports with `types` first, `files`, `sideEffects`, `engines`)

## Scope

**In scope**

- A `tsconfig.build.json` per package: `module` and `moduleResolution` `NodeNext`, `declaration`, `declarationMap`, `sourceMap`, `outDir: dist`, `src/` only
- Relative imports rewritten from `.ts` to `.js` specifiers; `allowImportingTsExtensions` off for the build
- `exports` with `source`, `types` and `default` conditions for every entry, including `./testing` and `./testing/setup`
- `files: ["dist"]`, `sideEffects: false`, `engines.node: ">=22"`, `repository`, `homepage`, `license`
- `customConditions: ["source"]` in `tsconfig.base.json` and `resolve.conditions` in each `vitest.config.ts`
- A `build` script in each package and a root `pnpm build`

**Out of scope** (and which todo covers it)

- Changesets and publishing (L2, L3)

## Acceptance criteria

- [ ] `pnpm build` writes `dist/*.js` and `dist/*.d.ts` for every entry of both packages
- [ ] `pnpm typecheck` and `pnpm test` pass with no `dist/` present (`git clean -xdf packages` first)
- [ ] A test packs each package with `pnpm pack` and fails if the tarball holds anything but `package.json`, `dist/`, `README.md`, `CHANGELOG.md` and the licence files
- [ ] A Node script imports each published entry from the packed tarball installed in a temp directory, with no `source` condition, and the imports resolve to `dist/`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The pack test, under `packages/gateway/test/` or `scripts/ci/`.

## Docs to update

[typescript.md](../../guidelines/typescript.md) (replace the "export `src/` until B20" line), AGENTS.md's `packages/` layout line, both package READMEs if install steps change, the plan's todo table.

## Risks and open questions

Vitest's resolver must honour `source` for workspace packages; if it doesn't, use a Vitest alias per package instead and record why.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
