# 0050. Publish built dist/ files with types first, and keep a source export condition for the workspace

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, PB3](../plans/publish-and-docs.md#pb3-built-dist-packages-with-a-source-condition-for-the-workspace-accepted)

## Context

Our packages export `src/*.ts`, which suits private packages that Vitest and tsx read directly, but npm users need JavaScript and declarations. Lamina PDF's packages emit with `tsc` into `dist/` with `NodeNext` resolution and `.js` specifiers, and list `types` first in each export condition.

## Decision

Each published package builds `dist/` with `tsc` (`module` and `moduleResolution` `NodeNext`, declarations on), uses `.js` specifiers in relative imports, and declares `exports` with `types` first, `files: ["dist"]`, `sideEffects: false` and `engines.node`. A `source` condition in each export points at `src/*.ts`, and the workspace's Vitest (`resolve.conditions`) and TypeScript (`customConditions`) configs name it, so tests and type-checks need no build. The condition never ships: `publishConfig.exports` lists only `types` and `default`, which pnpm puts in the packed `package.json`. The build ignores it: each `tsconfig.build.json` sets `customConditions: []`, and packages build in dependency order.

## Consequences

- The TypeScript guideline's line that our private packages export their `src/` TypeScript until L1 changes to this rule (todo L1).
- A test packs each package and fails if the tarball holds `src/`, tests or anything outside `dist/`, `README.md`, `CHANGELOG.md` and the licence files, or if it lacks `LICENSE`, `LICENSE-APACHE` or `LICENSE-MIT`. A second test resolves every packed entry with a `source` condition set.
