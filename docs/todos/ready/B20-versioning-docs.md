# B20: Versioning policy, defaults hash, compiled docs, `llms.txt` and the export diffs

| Field | Value |
| --- | --- |
| ID | `B20` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B17](B17-otel-observer.md), [B19](B19-triage-capstone.md) |
| Size | M |

## Goal

Make the SDK's behaviour traceable across releases and its docs impossible to drift: version defaults and prompts, stamp them on every run, and compile every documented example.

## Context

- [agent-SDK guide §10](../../guides/agent-sdk.md#10-versioning-must-cover-defaults-and-prompts-as-well-as-types-and-docs-must-compile-against-the-release-tag): four versioning rules, defaults and prompts, compiled docs
- [D8](../../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted)

## Scope

**In scope**

- The "Breaking Changes" rule for changesets, which write each package's `CHANGELOG.md` (todo L2)
- `defaultsHash`: a hash of every default value, built-in prompt and tool description, on `run_start`
- `capabilities` on `run_start`, filled from an exported `const CAPABILITIES`, with each string listed in the SDK README (harness need 11)
- A lint that public unstable names carry `experimental_`
- Docs built from the package source: README examples extracted and type-checked, `llms.txt` and a compact docs index
- The second export diff: a documented name missing from the `.d.ts` fails (the first, undocumented exports, is todo L6)

**Out of scope** (and which todo covers it)

- Publishing (todos L1–L3, L4a and L4b: the owner decided on 2026-11-19 to publish 0.1.0 once a model call works, ADR 0047)
- A docs website and the undocumented-export check (todos L5 and L6, ADR 0048)

## Tasks

- [ ] Reuse the extraction and type-check approach of `verify/*/scripts/` for our own README code blocks.
- [ ] Compute `defaultsHash` from a single defaults module; a test fails if a default changes without a changeset in the pull request.
- [ ] Generate `llms.txt` from the READMEs and the exports list.

## Acceptance criteria

- [ ] Every TypeScript block in both READMEs type-checks against the packages
- [ ] Documenting a name the `.d.ts` doesn't export fails the export diff
- [ ] Changing a default without a changeset fails a test
- [ ] `run_start` carries a `defaultsHash` that changes when a default changes
- [ ] `run_start.capabilities` equals the exported `CAPABILITIES`, and the SDK README lists every string in it (the export diff checks the list)
- [ ] `llms.txt` exists for each package and lists every public export
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/*/scripts/` check scripts, wired into each package's `test`.

## Docs to update

Both READMEs and CHANGELOGs; AGENTS.md if the commit gate changes. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Generated docs must come from the same commit as the package; never from a branch (guide §10).

## Revision (2026-11-19, publishing and docs)

The owner decided on 2026-11-19 to publish under `@buildanagent` and to build docs on Astro Starlight ([publish-and-docs.md](../../plans/publish-and-docs.md)). Three changes follow for B20:
- **The undocumented-export diff moves to L6.** TypeDoc's `notDocumented` validation, run over each package's `exports`, fails on an export without TSDoc. B20 keeps the other diff: documented names missing from the `.d.ts`.
- **The changelogs come from Changesets (L2).** B20's "Breaking Changes" rule stays, written into each changeset's summary instead of edited by hand.
- **Publishing and the docs website are no longer out of scope by the owner's choice.** They are Round L's todos. B20 still owns `defaultsHash`, `CAPABILITIES`, the `experimental_` lint, the README type-check and `llms.txt`.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
