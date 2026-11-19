# 0051. Ship the licences, keep the setup as a side effect, load it through a local file, and build cleanly on every pack

- **Status:** Proposed. It records corrections found while todo L1 implemented ADR 0050 and in the first code review of its pull request ([#45](https://github.com/laudebugs/buildanagent/pull/45)); the owner has not reviewed them yet.
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, PB3](../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-accepted)

## Context

[ADR 0050](0050-dist-build-with-source-condition.md) decides that each package builds `dist/` with `tsc`, publishes `types`-first exports, and keeps a `source` condition for the workspace. Building it in L1 and reviewing the pull request found five gaps. First, the `files` list `["dist"]` drops the licences, which ADR 0050's own pack test requires. Second, `sideEffects: false` lets a bundler drop a bare import of `@buildanagent/gateway/testing/setup`, which installs the offline guards. Third, Vitest 5.1.0 resolves a bare `setupFiles` entry with Node's default conditions when it loads the config, so the entry loads `dist/`, or fails before a build ([fact-check row 75](../plans/reviews/fact-check-publish-and-docs.md)). Fourth, the build's source and declaration maps pointed at `../src/*.ts`, which the tarball doesn't contain. Fifth, `tsc` left the `dist/` files of deleted modules in place, and `pnpm pack` neither built nor cleaned `dist/`, so a pack could ship stale files or no code at all.

## Decision

Everything in ADR 0050 stands except these points:

1. **Licences ship.** `files` lists `dist`, `LICENSE`, `LICENSE-APACHE` and `LICENSE-MIT`. Each package's `prepack` script copies the three files from the repo root (`scripts/copy-licenses.mjs`), and `.gitignore` ignores the copies.
2. **The gateway's setup is a side effect.** The gateway's `sideEffects` lists `./src/testing/setup.ts` and `./dist/testing/setup.js`, the two files its `./testing/setup` entry resolves to in the workspace and once published. The SDK keeps `sideEffects: false`.
3. **Vitest loads the setup through a local file.** Each package's `setupFiles` lists `./test/setup.ts`, which imports `@buildanagent/gateway/testing/setup`. Vite then resolves the import through `ssr.resolve.conditions`, so it reaches `src/` with no build.
4. **Source maps carry their sources, and declarations ship without maps.** Each `tsconfig.build.json` sets `sourceMap` and `inlineSources`, so every `.js.map` holds the TypeScript it maps. It leaves `declarationMap` off, because TypeScript 7.0.2 inlines no sources into declaration maps ([fact-check row 77](../plans/reviews/fact-check-publish-and-docs.md)). A declaration map only lets an editor jump from a `.d.ts` file to its source, so shipping one would mean shipping `src/` too, which the pack test forbids.
5. **Each build starts from an empty `dist/`, and each pack builds.** Each package's `build` script runs `scripts/clean-dist.mjs` before `tsc`, and its `prepack` script runs `build` before it copies the licences, so `pnpm pack` and `pnpm publish` never ship a missing or stale `dist/`.

L1 also tried TypeScript 7.0.2's `rewriteRelativeImportExtensions`, which would let relative imports keep `.ts` specifiers, and rejected it because it leaves `./x.ts` in the emitted `.d.ts` files. ADR 0050's `.js` specifiers stand.

## Consequences

- `scripts/ci/packages-pack.test.mjs` checks points 1, 2, 4 and 5. It fails if a tarball lacks a licence, if the gateway's `sideEffects` misses either setup file, if a packed `.map` names a source that is neither in the tarball nor inlined, or if a packed `dist/*.js` file has no matching `src/*.ts` module. It plants a stale `dist/` file and runs no build of its own before `pnpm pack`, so a build that stops cleaning `dist/`, or a `prepack` that stops building, fails it. Point 3 needs no test of its own: CI runs `pnpm test` before anything builds `dist/`, and with no `dist/` a bare `setupFiles` entry fails every test file (fact-check row 75).
- The [TypeScript guideline](../guidelines/typescript.md#packages-build-to-dist-and-the-workspace-reads-src-through-source), the [testing guideline](../guidelines/testing.md) and PB3 describe these rules.
- ADR 0050 stays Accepted, with a dated note pointing here, and is marked "superseded in part by 0051" only once the owner accepts this record. If the owner rejects a point here, a new record says what replaces it.
