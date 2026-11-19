# TypeScript: strict, portable, named and documented

These rules apply to every TypeScript file in `packages/`. The `verify/*` harnesses follow [AGENTS.md coding standards](../../AGENTS.md#coding-standards) instead, because they test other people's SDKs. The rules adapt Lamina PDF's `typescript.md` to two decisions of ours: tests run on `node:test` through tsx ([SDK plan §3.1](../plans/build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory)), and our private packages export their `src/` TypeScript directly until todo B20 decides how we publish.

## Compiler settings are strict, and only erasable syntax is allowed

- **MUST:** every package extends the root `tsconfig.base.json`, and `pnpm typecheck` passes for `src/` and `test/`.
- **MUST:** the base config turns on `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. A follow-up pull request turns on the flags the base config lacks today and fixes the code they flag.
- **MUST NOT:** use `enum`, `namespace` or constructor parameter properties, which `erasableSyntaxOnly` forbids. Use string-literal unions and `as const` objects.
- **MUST:** write type-only imports as `import type { … }`, as `verbatimModuleSyntax` requires.

## Shared packages are portable: no Node-only APIs in `src/`

Our SDK and harness must run on local Node, Cloudflare, AWS and Vercel ([ADR 0033](../decisions/0033-three-deployment-targets.md)), so their `src/` code uses only web-standard APIs.

- **MUST NOT:** import `node:*` modules or use `Buffer`, `process`, `__dirname` or `require` in a package's `src/`. Bytes are `Uint8Array`, text goes through `TextEncoder` and `TextDecoder`, and randomness and crypto go through `globalThis.crypto`.
- **MUST NOT:** use DOM-only globals (`window`, `document`, `localStorage`) in `src/`.
- **SHOULD:** take anything environment-specific (a transport, a store, a clock) as an option, so the caller supplies it.
- Test files and a package's `testing/setup` may use Node APIs, because they run only in our Node test runner. A portability test enforces the rule once the lint follow-up lands.

## Biome lints and formats, and caps each function's size

- **MUST:** Biome is the only linter and formatter, with the root `biome.json`'s `recommended` preset. `pnpm check` passes.
- **MUST:** turn a rule off inline only with `// biome-ignore lint/<group>/<rule>: <reason>`, and give the reason.
- **MUST:** a function has a cognitive complexity of at most 15 and at most 60 lines, and code throws only `Error` subclasses. Test files are exempt from the length cap, because one `test` callback can hold a whole scenario. The lint follow-up turns these into Biome errors.

## Names follow one convention per kind

| Thing | Convention |
| --- | --- |
| Files | `kebab-case.ts`; tests `kebab-case.test.ts` |
| Types, interfaces, classes | `PascalCase`, with acronyms as words (`ModelRef`, `JsonSchema`) |
| Functions, variables, methods | `camelCase` |
| True module-level constants | `UPPER_SNAKE_CASE` |

- **MUST:** export by name only. No `export default`.
- **MUST NOT:** use `any`. Use `unknown` and narrow it. Each non-null assertion (`!`) carries a comment saying why the value is present.

## Each package has one error class with a typed code

- **MUST:** a package defines one error class that extends `Error`, sets `name`, and carries a `readonly code` typed as a string-literal union. It exports an `isXError(e: unknown): e is XError` guard. The SDK plan's `SdkError` base with `isInstance` markers follows this rule.
- **MUST:** throw only `Error` subclasses, and pass `{ cause }` when wrapping another error.
- **MUST NOT:** swallow an error. A failed model call is data, not an exception: it ends its stream with an `error` terminal, and `complete()` returns that message.

## Public APIs are designed as types first, and every export is documented

- **SHOULD:** write a package's exported types first, review them in the pull request, then implement them. The exported types are the contract.
- **MUST:** `src/index.ts` and each subpath entry export their names one by one. No `export *` from internal modules, and no barrel files in subfolders. Larger areas get a subpath export (`@buildanagent/gateway/testing`).
- **MUST:** every exported symbol has a TSDoc comment. The SDK plan's D8 adds a CI check that fails on an undocumented export ([ADR 0008](../decisions/0008-versioning-and-doc-checks.md)).
- **SHOULD:** inputs and outputs use `readonly` properties, options arrive as one object, and an optional property means "omitted", which `exactOptionalPropertyTypes` enforces.
