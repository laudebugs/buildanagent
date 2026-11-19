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
