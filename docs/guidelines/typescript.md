# TypeScript: strict, portable, named and documented

These rules apply to every TypeScript file in `packages/`. The `verify/*` harnesses follow [AGENTS.md coding standards](../../AGENTS.md#coding-standards) instead, because they test other people's SDKs. The rules adapt Lamina PDF's `typescript.md`, including its packaging rule: each package builds to `dist/` with `tsc`, and the workspace reads `src/` through a `source` export condition, so tests and type-checks need no build ([ADR 0050](../decisions/0050-dist-build-with-source-condition.md)). Tests run on Vitest, as Lamina's do ([ADR 0046](../decisions/0046-vitest-test-runner.md)).

## Compiler settings are strict, and only erasable syntax is allowed

- **MUST:** every package extends the root `tsconfig.packages.json`, and `pnpm typecheck` passes for `src/` and `test/`.
- **MUST:** the packages config turns on ten flags: `strict`, `noImplicitOverride` and `noFallthroughCasesInSwitch` from `tsconfig.base.json`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. The `verify/*` harnesses extend only the base config, because these rules cover `packages/` alone. Their own examples fail the stricter seven: as of November 2026, `verify/vercel-ai-sdk` has 18 errors.
- **MUST NOT:** use `enum`, `namespace` or constructor parameter properties, which `erasableSyntaxOnly` forbids. Use string-literal unions and `as const` objects.
- **MUST:** write type-only imports as `import type { … }`, as `verbatimModuleSyntax` requires.

## Packages build to `dist/`, and the workspace reads `src/` through `source`

npm users get JavaScript and declarations from `dist/`; the repo's tests and type-checks read `src/` directly ([ADR 0050](../decisions/0050-dist-build-with-source-condition.md)).

- **MUST:** relative imports use `.js` specifiers (`import { x } from "./x.js"`), which `NodeNext` requires in the emitted code. The packages config turns `allowImportingTsExtensions` off, so a `.ts` specifier fails `pnpm typecheck`. TypeScript, Vite and tsx all map a `.js` specifier to its `.ts` source.
- **MUST:** each package has a `tsconfig.build.json` that extends the packages config, emits `src/` only into `dist/` with `module` and `moduleResolution` `NodeNext`, declarations and source maps with `inlineSources`, and sets `customConditions: []`. It leaves `declarationMap` off, because a declaration map points at `src/` files the tarball doesn't ship ([ADR 0051](../decisions/0051-dist-build-corrections-from-l1.md)). Each `build` script runs `scripts/clean-dist.mjs` first, so files of deleted modules don't linger in `dist/`. `pnpm build` runs every package's `build` script in dependency order, so the SDK compiles against the gateway's `dist/*.d.ts`. To build one package, run `pnpm --filter "<package>..." build`, which builds its workspace dependencies first.
- **MUST:** every entry in `exports` lists `source` (the `src/*.ts` file), then `types`, then `default`. Node and TypeScript take the first condition that matches, so `source` must come first. `tsconfig.packages.json` sets `customConditions: ["source"]` (not `tsconfig.base.json`, which `verify/*` extends, so third-party packages that ship a `source` condition stay on their built files there), and each `vitest.config.ts` sets `ssr.resolve.conditions` to `source` followed by Vite's default server conditions.
- **MUST:** `publishConfig.exports` repeats each entry with only `types`, then `default`, and pnpm swaps it in when it packs, so the `source` condition never ships. The package also sets `files` (`dist` and the licence files; its `prepack` script runs `build`, then copies the licences from the repo root), `sideEffects`, `engines.node`, `repository`, `homepage` and `license`. `sideEffects` is `false`, except that the gateway lists `./src/testing/setup.ts` and `./dist/testing/setup.js`, which install the offline guards when imported.
- `scripts/ci/packages-pack.test.mjs` builds and packs each package, and fails if a tarball holds anything but `package.json`, `README.md`, `CHANGELOG.md`, the licences and `dist/`, ships a `source` condition, resolves an entry outside `dist/`, packs a `dist/*.js` file with no `src/*.ts` module, or packs a source map whose sources are neither in the tarball nor inlined.

## Shared packages are portable: no Node-only APIs in `src/`

Our SDK and harness must run on local Node, Cloudflare, AWS and Vercel ([ADR 0033](../decisions/0033-three-deployment-targets.md)), so their `src/` code uses only web-standard APIs.

- **MUST NOT:** import `node:*` modules or use `Buffer`, `process`, `__dirname` or `require` in a package's `src/`. Bytes are `Uint8Array`, text goes through `TextEncoder` and `TextDecoder`, and randomness and crypto go through `globalThis.crypto`.
- **MUST NOT:** use DOM-only globals (`window`, `document`, `localStorage`) in `src/`.
- **SHOULD:** take anything environment-specific (a transport, a store, a clock) as an option, so the caller supplies it.
- Test files may use Node APIs, and so may the offline guards in a package's `src/testing/` (`guards.ts` and `setup.ts`), because they guard our Node test process. The rest of a `testing` export, such as `ScriptedModel`, stays portable, because users run it on every target. `packages/gateway/test/portability.test.ts` enforces the rule for every package.

## Biome lints and formats, and caps each function's size

- **MUST:** Biome is the only linter and formatter, with the root `biome.json`'s `recommended` preset. `pnpm check` passes.
- **MUST:** turn a rule off inline only with `// biome-ignore lint/<group>/<rule>: <reason>`, and give the reason.
- **MUST:** a function has a cognitive complexity of at most 15 and at most 60 lines, and code throws only `Error` subclasses. Test files are exempt from the length cap, because one `test` callback can hold a whole scenario. Biome reports each of these as an error anywhere in `packages/`. It also rejects default exports there, except in `vitest.config.ts`. In `src/`, outside the offline guards, it rejects the DOM-only globals listed above and the Node globals `Buffer`, `process`, `require`, `__dirname` and `__filename`.

## Names follow one convention per kind

| Thing | Convention |
| --- | --- |
| Files | `kebab-case.ts`; tests `kebab-case.test.ts` |
| Types, interfaces, classes | `PascalCase`, with acronyms as words (`ModelRef`, `JsonSchema`) |
| Functions, variables, methods | `camelCase` |
| True module-level constants | `UPPER_SNAKE_CASE` |

- **MUST:** export by name only. No `export default`, except in tool config files that require one, such as `vitest.config.ts`.
- **MUST NOT:** use `any`. Use `unknown` and narrow it. Each non-null assertion (`!`) carries a comment saying why the value is present.

## Each package has one error class with a typed code

- **MUST:** a package defines one error class that extends `Error`, sets `name`, and carries a `readonly code` typed as a string-literal union. It exports an `isXError(e: unknown): e is XError` guard. The SDK plan's `SdkError` base with `isInstance` markers is where the SDK's class lives. As of November 2026 three earlier classes predate the rule; [Known gaps](README.md#known-gaps) lists them.
- **MUST:** throw only `Error` subclasses, and pass `{ cause }` when wrapping another error.
- **MUST NOT:** swallow an error. A failed model call is data, not an exception: it ends its stream with an `error` terminal, and `complete()` returns that message.

## Public APIs are designed as types first, and every export is documented

- **SHOULD:** write a package's exported types first, review them in the pull request, then implement them. The exported types are the contract.
- **MUST:** `src/index.ts` and each subpath entry export their names one by one. No `export *` from internal modules, and no barrel files in subfolders. Larger areas get a subpath export (`@buildanagent/gateway/testing`).
- **MUST:** every exported symbol has a TSDoc comment. Users read it in their editor, so it follows [docs-writing.md](docs-writing.md): no decision or todo ids. The SDK plan's D8 adds a CI check that fails on an undocumented export ([ADR 0008](../decisions/0008-versioning-and-doc-checks.md)).
- **SHOULD:** inputs and outputs use `readonly` properties, options arrive as one object, and an optional property means "omitted", which `exactOptionalPropertyTypes` enforces.
