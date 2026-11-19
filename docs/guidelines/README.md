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
| `StreamContractError`, `ModelRequestsDisabledError` and `UnexpectedModelCallError` carry no `code` and no `isX()` guard | [typescript.md](typescript.md#each-package-has-one-error-class-with-a-typed-code) | [B11](../todos/ready/B11-loop-core.md), which adds `RunStoppedError` beside the SDK's `SdkError` (from B10); the gateway's classes follow in the same pull request |
| The SDK README's `ScriptedModel` block and the gateway README's `assertStreamContract()` block are not from tested example files | [docs-writing.md](docs-writing.md#show-code-only-from-tested-files) | [B19](../todos/ready/B19-triage-capstone.md), which adds the first `examples/` folder with the SDK capstone |
| The SDK carries byte-identical copies of `@buildanagent/agent-safety`'s `errors.ts`, `outcome.ts` and `render.ts` in `packages/sdk/src/vendor/agent-safety/`, because the published SDK can't depend on the private safety package. `test/vendored-safety.test.ts` fails if a copy drifts | [maintainability.md](maintainability.md#every-concept-has-one-home) | [F5](../todos/ready/F5-agent-safety-package.md), which publishes the safety package; the SDK then deletes the folder and imports the package's root export |
