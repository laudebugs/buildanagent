# L4a: Make the packages public and confirm their npm placeholders

| Field | Value |
| --- | --- |
| ID | `L4a` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [B4](../done/B4-gateway-runtime.md), [B8](../done/B8-anthropic-adapter.md), [L3](../ongoing/L3-release-workflow.md) |
| Size | S |

The filename predates the 2026-11-19 change, when the owner's hand-run bootstrap moved the trusted publishers to L4b; it stays so links keep working. L4a still waits for L3, because `release.yml` must exist before the packages go public.

## Goal

Make both packages publishable and confirm that npm still holds them as PB2 records, so L4b can add the trusted publishers and ship 0.1.0 the same day ([PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted), [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted): the placeholders the owner published on 2026-11-19
- The owner's setup in [§3](../../plans/publish-and-docs.md#3-what-the-owner-sets-up)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): a new trusted publisher expires unless it publishes within 2 days

## Scope

**In scope**

- Remove `private: true` from both packages
- Confirm with `npm view` that each package still has only its two deprecated placeholders and that `latest` points at `0.0.0-bootstrap.0`, and record the output in the pull request description
- Record in the CI plan that npm needs a package to exist before a trusted publisher can be added, citing npm's `trust` docs

**Out of scope** (and which todo covers it)

- Adding the trusted publishers, publishing 0.1.0 and switching on the changeset gate (L4b)

## Acceptance criteria

- [ ] Both packages' `package.json` files have no `private` field
- [ ] `npm view @buildanagent/gateway versions dist-tags deprecated` and the same for `@buildanagent/sdk` show `0.0.0-bootstrap.0` and `0.0.0-stage`, `latest` on `0.0.0-bootstrap.0`, and the deprecation message
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
