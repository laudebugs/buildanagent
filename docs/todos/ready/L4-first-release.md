# L4: Release 0.1.0 of the gateway and SDK

| Field | Value |
| --- | --- |
| ID | `L4` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [B4](B4-gateway-runtime.md), [B8](B8-anthropic-adapter.md), [L3](L3-release-workflow.md) |
| Size | S |

## Goal

Ship the first public release, 0.1.0, once a model call works ([PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted), ADR 0047).

## Context

- [PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md)
- The owner's setup in [§3](../../plans/publish-and-docs.md#3-what-the-owner-sets-up)

## Scope

**In scope**

- Remove `private: true` from both packages
- A changeset for 0.1.0 summarising what the release offers: the transcript, `createModel()`, the Anthropic adapter, `ScriptedModel`
- The npm trusted-publisher setup with the owner. If npm requires an existing package first, the owner saves a one-time granular token as `NPM_BOOTSTRAP_TOKEN`, L3's `bootstrap` job publishes `0.0.0-bootstrap.0` of each package, and the owner adds the trusted publishers. `release.yml` then publishes 0.1.0 through trusted publishing within 2 days of that setup, before the trusted publishers expire
- Afterwards: the owner revokes the token and deletes the secret, the `bootstrap` job is removed from `release.yml`, and `0.0.0-bootstrap.0` is deprecated
- Switching on L2's changeset gate and the "Version packages" pull request, with the 0.1.0 changeset as the first
- Both READMEs gain install instructions

**Out of scope** (and which todo covers it)

- Further adapters (B9) and the loop (B10 onward)

## Acceptance criteria

- [ ] `npm view @buildanagent/gateway@0.1.0` and `npm view @buildanagent/sdk@0.1.0` return the release, and npmjs.com shows provenance for both
- [ ] A fresh project installs `@buildanagent/sdk@0.1.0` and makes one model call against a mock server through the Anthropic adapter, offline
- [ ] No npm token remains in the repository's or the owner's secrets after the release, and `release.yml` has no `bootstrap` job
- [ ] A changeset-free change to `packages/*/src` fails CI after the release
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The fresh-install smoke test, recorded in the pull request description.

## Docs to update

Both READMEs and CHANGELOGs, the roadmap, the plan's todo table.

## Risks and open questions

The first-publish path depends on npm's rules for new packages, which [risk 1](../../plans/publish-and-docs.md#5-risks) covers.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
