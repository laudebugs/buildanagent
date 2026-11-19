# L4a: Make the packages public, bootstrap them on npm if needed, and add the trusted publishers

| Field | Value |
| --- | --- |
| ID | `L4a` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [B4](B4-gateway-runtime.md), [B8](B8-anthropic-adapter.md), [L3](L3-release-workflow.md) |
| Size | S |

## Goal

Get both packages ready for trusted publishing, so L4b can ship 0.1.0 within npm's 2-day window ([PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted), [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted): the first publish and the bootstrap path
- The owner's setup in [§3](../../plans/publish-and-docs.md#3-what-the-owner-sets-up)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): a new trusted publisher expires unless it publishes within 2 days

## Scope

**In scope**

- Remove `private: true` from both packages
- Check whether npm lets the owner add a trusted publisher before a package exists, and record the answer in the CI plan
- If it doesn't: the owner saves a one-time granular token as `NPM_BOOTSTRAP_TOKEN`, L3's `bootstrap` job publishes `0.0.0-bootstrap.0` of each package under the `bootstrap` dist-tag with provenance, and the placeholder is deprecated straight away with a message to wait for 0.1.0
- The owner adds a trusted publisher to each package (user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`)
- The pull request description records the date the trusted publishers were added, which starts L4b's 2-day window

**Out of scope** (and which todo covers it)

- Publishing 0.1.0, switching on the changeset gate, removing the bootstrap path (L4b)

## Acceptance criteria

- [ ] Both packages' `package.json` files have no `private` field
- [ ] npmjs.com shows a trusted publisher for both packages, naming `release.yml` and the `release` environment
- [ ] If the bootstrap ran: `npm view @buildanagent/gateway@0.0.0-bootstrap.0` shows the placeholder, deprecated, with provenance
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The npm checks above, recorded in the pull request description.

## Docs to update

CI plan (the answer about trusted publishers on new packages), the plan's todo table.

## Risks and open questions

The registry may point `latest` at the placeholder until 0.1.0 ships, so `npm install @buildanagent/sdk` could fetch it for up to 2 days; the deprecation message says to wait for 0.1.0.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
