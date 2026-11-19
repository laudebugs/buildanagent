# L2: Version both packages with Changesets in one fixed group

| Field | Value |
| --- | --- |
| ID | `L2` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L1](L1-build-dist-packages.md) |
| Size | S |

## Goal

Record every user-facing change as a changeset, version the gateway and SDK together, and write their changelogs ([PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md)
- [D8](../../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted): the 0.x rule
- Lamina PDF's `.changeset/config.json`

## Scope

**In scope**

- `@changesets/cli` pinned in the root (3.0.3, or the newest release at least a week old when the todo starts)
- `.changeset/config.json`: `fixed: [["@buildanagent/gateway", "@buildanagent/sdk"]]`, `access: "public"`, `baseBranch: "main"`, the apps and `verify/*` in `ignore`, and `privatePackages: { "version": false, "tag": false }`, so nothing versions the packages while they are private
- A `.changeset/README.md` with the 0.x rule: a breaking change is a `minor` bump whose summary starts "Breaking Changes"
- A CI step that fails a pull request changing `packages/*/src` without a changeset, written in L2 but switched on in L4, because the owner said "Changesets wait until we publish"

**Out of scope** (and which todo covers it)

- The release workflow (L3)

## Acceptance criteria

- [ ] `pnpm changeset` writes a changeset for both packages, and `pnpm changeset version` bumps both to the same version and writes both `CHANGELOG.md` files
- [ ] With the step switched on on a test branch, a pull request that edits `packages/gateway/src` without a changeset fails, and passes once one is added; on `main` the step stays off until L4
- [ ] `pnpm changeset version` on `main` before L4 leaves both packages at 0.0.0
- [ ] A pull request that edits only `docs/` needs no changeset
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The CI step's behaviour, recorded on a test branch in the pull request description.

## Docs to update

CONTRIBUTING.md (adding a changeset), AGENTS.md's Git section, CI plan §3, the plan's todo table.

## Risks and open questions

`changeset status` compares against `origin/main`; a shallow checkout needs enough history.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
