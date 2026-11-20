# B20: Versioning policy, defaults hash, compiled docs, `llms.txt` and the export diffs

| Field | Value |
| --- | --- |
| ID | `B20` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B17](../done/B17-otel-observer.md), [B19](../done/B19-triage-capstone.md) |
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

- [x] Reuse the extraction and type-check approach of `verify/*/scripts/` for our own README code blocks.
- [x] Compute `defaultsHash` from a single defaults module; a test fails if a default changes without a changeset in the pull request.
- [x] Generate `llms.txt` from the READMEs and the exports list.

## Acceptance criteria

- [x] Every TypeScript block in both READMEs type-checks against the packages
- [x] Documenting a name the `.d.ts` doesn't export fails the export diff
- [x] Changing a default without a changeset fails a test
- [x] `run_start` carries a `defaultsHash` that changes when a default changes
- [x] `run_start.capabilities` equals the exported `CAPABILITIES`, and the SDK README lists every string in it (the export diff checks the list)
- [x] `llms.txt` exists for each package and lists every public export
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

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

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Done on 2026-11-20. The prose was drafted with `/anthropic-skills:writing`; its writing review ran on the pull request after the code reviews.

- **Defaults and their hash.** Every default value, built-in prompt and tool description lives in `packages/sdk/src/defaults.ts`, and the modules that use one read it from there. `DEFAULTS_HASH` is the canonical-JSON SHA-256 of that object plus the write-outcome sentences and payloads of every kind and retry rule, which stay in the vendored safety files. It is a literal, so `run_start` carries it without an async digest, and `test/defaults.test.ts` fails while it is stale. The gateway's own defaults, such as its retry policy, are left out: the fixed version group means `sdkVersion` already names the gateway release.
- **A changed default needs a release.** CI's changeset gate reads `DEFAULTS_HASH` on both sides of a pull request. When the hash differs, the pull request must add a changeset, not edit one, that gives a versioned package a `major`, `minor` or `patch` bump. Neither `pnpm changeset --empty` nor a `none` bump covers it. The gate also fails when it can't find the hash, or when the file that holds it is gone (`scripts/ci/changeset-gate.mjs`, `RELEASE_STAMPS`).
- **Capabilities.** `CAPABILITIES` lists thirteen `<behaviour>_v1` strings, including `turn_retries_v1` from B11b and `raw_events_v1` from B11c. `run_start.capabilities` carries the list, the SDK README lists each one, and a test fails when the list and the README disagree.
- **Docs checks.** `scripts/package-docs.mjs` holds the checks and each published package's `scripts/docs-check.mjs` configures them, run by `test/docs-check.test.ts`. They type-check every TypeScript block of the README against the packages, fail on a documented export name the emitted `.d.ts` lacks (names imported in a block, and prose spans shaped like `name()`, a name that starts with a capital or `UPPER_SNAKE_CASE`, with a per-package list of names that aren't ours), enforce the `experimental_` rule against `@experimental` tags, and compare the committed `llms.txt` with one rebuilt from the README and the declarations. The check found three broken README examples, which this todo fixed. No `ci.yml` change was needed, because `pnpm test` runs the checks.
- **`llms.txt`.** Each published package ships one, with relative links, so it names no branch and no version and needs no edit in a Version packages pull request.
- **Left for later.** The undocumented-export diff is L6's. A README block is type-checked but still not drawn from a tested file, which the guidelines' Known gaps row keeps open.

