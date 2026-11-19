# Guidelines: the rules our own code follows

These guidelines hold the coding and documentation rules for `packages/` in one place, so a change to a rule is a change to one file. They adapt the practices of the owner's [Lamina PDF](https://github.com/laudebugs/laminapdf) repository (its `docs/guidelines/`, read at commit `7b4b37b`, November 2026) to this repo's decisions. Where a guideline and a plan or ADR disagree, the ADR wins until a new ADR changes it.

| Guideline | Read it before you |
| --- | --- |
| [typescript.md](typescript.md) | write or review TypeScript in `packages/`: compiler settings, modules, portability, lint, naming, errors and API design |
| [maintainability.md](maintainability.md) | add a helper, a type or a file: one home per concept, size limits, public surface, comments |
| [testing.md](testing.md) | write a test: what runs offline, which seam to use, what a test must prove |
| [docs-writing.md](docs-writing.md) | write a page a user of our packages reads, such as a package README: a story, plain English, no internal ids |
| [examples.md](examples.md) | write an example a reader will copy: public imports only, no test scaffolding, always tested |

**MUST** and **SHOULD** mark rules. Text without either is advice.

## Known gaps

Some code and docs on `main` predate these rules. Each gap below has a todo that closes it, so a reviewer can tell an old gap from a new violation:

| Gap | Rule | Closed by |
| --- | --- | --- |
| `tsconfig.base.json` lacks seven of the ten required flags | [typescript.md](typescript.md#compiler-settings-are-strict-and-only-erasable-syntax-is-allowed) | [Q1](../todos/ongoing/Q1-strict-compiler-and-lint.md) |
| Biome doesn't yet enforce the complexity and length caps, `useThrowOnlyError` or a portability check; `assertStreamContract()` and `ScriptedModel`'s stream method are near or past the caps | [typescript.md](typescript.md#biome-lints-and-formats-and-caps-each-functions-size) | [Q1](../todos/ongoing/Q1-strict-compiler-and-lint.md), which also splits those two functions |
| `StreamContractError`, `ModelRequestsDisabledError` and `UnexpectedModelCallError` carry no `code` and no `isX()` guard | [typescript.md](typescript.md#each-package-has-one-error-class-with-a-typed-code) | [B11](../todos/ready/B11-loop-core.md), which adds the SDK's `errors.ts` and its `SdkError` base; the gateway's classes follow in the same pull request |
| The SDK README's `ScriptedModel` block and the gateway README's `assertStreamContract()` block are not from tested example files | [docs-writing.md](docs-writing.md#show-code-only-from-tested-files) | [B19](../todos/ready/B19-triage-capstone.md), which adds the first `examples/` folder with the SDK capstone |
