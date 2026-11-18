# B20: Versioning policy, defaults hash, compiled docs, `llms.txt` and the export diffs

| Field | Value |
| --- | --- |
| ID | `B20` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-the-shipping-surface) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B17](B17-otel-observer.md), [B19](B19-triage-capstone.md) |
| Size | M |

## Goal

Make the SDK's behaviour traceable across releases and its docs impossible to drift: version defaults and prompts, stamp them on every run, and compile every documented example.

## Context

- [agent-SDK guide §10](../../guides/agent-sdk.md#10-versioning-must-cover-defaults-and-prompts-as-well-as-types-and-docs-must-compile-against-the-release-tag): four versioning rules, defaults and prompts, compiled docs
- [D8](../../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-owner-to-confirm)

## Scope

**In scope**

- `CHANGELOG.md` per package with a "Breaking Changes" section rule
- `defaultsHash`: a hash of every default value, built-in prompt and tool description, on `run_start`
- `capabilities` on `run_start`
- A lint that public unstable names carry `experimental_`
- Docs built from the package source: README examples extracted and type-checked, `llms.txt` and a compact docs index
- The two export diffs: undocumented exports fail, and documented names missing from the `.d.ts` fail

**Out of scope** (and which todo covers it)

- Publishing (owner, D8)
- A docs website

## Tasks

- [ ] Reuse the extraction and type-check approach of `verify/*/scripts/` for our own README code blocks.
- [ ] Compute `defaultsHash` from a single defaults module; a test fails if a default changes without the changelog changing.
- [ ] Generate `llms.txt` from the READMEs and the exports list.

## Acceptance criteria

- [ ] Every TypeScript block in both READMEs type-checks against the packages
- [ ] Removing a docs entry for an export fails the export diff; documenting a missing name fails the other diff
- [ ] Changing a default without a changelog entry fails a test
- [ ] `run_start` carries a `defaultsHash` that changes when a default changes
- [ ] `llms.txt` exists for each package and lists every public export
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/*/scripts/` check scripts, wired into each package's `test`.

## Docs to update

Both READMEs and CHANGELOGs; AGENTS.md if the commit gate changes. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Generated docs must come from the same commit as the package; never from a branch (guide §10).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
