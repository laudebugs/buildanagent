# L12g1: Make the CLI report the harness's real version

| Field | Value |
| --- | --- |
| ID | `L12g1` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (found while writing the L12g protocol and CLI pages) |
| Round / milestone | Round L (publish and docs, added 2026-11-26) |
| Depends on | [L12g](../done/L12g-docs-protocol-cli-pages.md) |
| Size | S (one sitting) |

## Goal

Make `buildanagent rpc` answer `initialize` with the harness's real version, and make each session header the CLI writes record it. Today `serverInfo.version` reads `0.0.0` and so does every `harnessVersion` in a session header, because the CLI never passes `harnessVersion` to the harness, which then falls back to `"0.0.0"`.

## Context

- `packages/harness/src/create-harness.ts` (`harnessVersion: options.harnessVersion ?? "0.0.0"`) and `packages/cli/src/host.ts`, where the CLI builds its harness without the option.
- `packages/cli/transcripts/rpc-initialize.txt`: the committed transcript shows `"version":"0.0.0"`. The docs page works around the gap by describing the answer without that number.

## Scope

**In scope**

- Pass the harness package's version from the CLI, through a public export of the harness or its package manifest, whichever the maintainability checks allow.
- A test that `initialize` and a new session header carry that version.
- A transcript that shows a placeholder for the version, as `rpc-initialize.txt` does for `sdkVersion`, and a changeset.

**Out of scope**

- Any change to the protocol's `InitializeResult` shape.

## Tasks

- [ ] Choose how the CLI learns the harness version without a relative import between packages.
- [ ] Pass it, add the tests and rewrite the transcript.

## Acceptance criteria

- [ ] `rpc` answers `initialize` with a `serverInfo.version` equal to the harness package's version
- [ ] A session the CLI creates records the same `harnessVersion`
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the package checks pass

## Tests

`packages/cli/test/transcripts.test.ts` and a new test in `packages/cli/test/`.

## Docs to update

The transcript and the changeset.

## Risks and open questions

- A version in a transcript fails the transcript test on every release unless the test replaces it, so the test must.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed
