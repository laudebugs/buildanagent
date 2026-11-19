# 0050. Publish built dist/ files with types first, and keep a source export condition for the workspace

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, PB3](../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-accepted)

## Context

Our packages export `src/*.ts`, which suits private packages that Vitest and tsx read directly, but npm users need JavaScript and declarations. Lamina PDF's packages emit with `tsc` into `dist/` with `NodeNext` resolution and `.js` specifiers, and list `types` first in each export condition.

## Decision

Each published package builds `dist/` with `tsc` (`module` and `moduleResolution` `NodeNext`, declarations on), uses `.js` specifiers in relative imports, and sets `files: ["dist"]`, `sideEffects: false` and `engines.node`. In the workspace's `exports`, each entry lists `source` (pointing at `src/*.ts`), then `types`, then `default`: TypeScript and Node take the first condition that matches, so `source` must come first. The workspace's Vitest (`ssr.resolve.conditions`, with `source` before Vite's server defaults) and TypeScript (`customConditions`) configs name it, so tests and type-checks need no build. The condition never ships: `publishConfig.exports` lists only `types`, then `default`, which pnpm puts in the packed `package.json`. The build ignores it: each `tsconfig.build.json` sets `customConditions: []`, and packages build in dependency order.

## Consequences

- The TypeScript guideline's line that our private packages export their `src/` TypeScript until L1 changes to this rule (todo L1).
- A test packs each package and fails if the tarball holds anything outside `dist/`, `README.md`, `CHANGELOG.md` and the licence files, such as `src/` or tests. It also fails if the tarball lacks `LICENSE`, `LICENSE-APACHE` or `LICENSE-MIT`. A second test resolves every packed entry with a `source` condition set.
