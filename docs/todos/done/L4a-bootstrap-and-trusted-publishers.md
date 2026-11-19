# L4a: Make the packages public and confirm their npm placeholders

| Field | Value |
| --- | --- |
| ID | `L4a` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [B4](../done/B4-gateway-runtime.md), [B8](../done/B8-anthropic-adapter.md), [L3](../done/L3-release-workflow.md) |
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

- Remove `private: true` from both packages. Merging that publishes nothing: `release.yml`'s plan refuses version 0.0.0, which the workspace has never released ([CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19))
- Confirm with `npm view` that each package still has only its two deprecated placeholders and that `latest` points at `0.0.0-bootstrap.0`, and record the output in the pull request description
- Record in the CI plan that npm needs a package to exist before a trusted publisher can be added, citing npm's `trust` docs

**Out of scope** (and which todo covers it)

- Adding the trusted publishers, publishing 0.1.0 and switching on the changeset gate (L4b)

## Acceptance criteria

- [x] Both packages' `package.json` files have no `private` field
- [x] `npm view @buildanagent/gateway versions dist-tags deprecated` and the same for `@buildanagent/sdk` show `0.0.0-bootstrap.0` and `0.0.0-stage`, `latest` on `0.0.0-bootstrap.0`, and the deprecation message
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The npm checks above, recorded in the pull request description.

## Docs to update

CI plan (the answer about trusted publishers on new packages), the plan's todo table.

## Risks and open questions

The registry may point `latest` at the placeholder until 0.1.0 ships, so `npm install @buildanagent/sdk` could fetch it for up to 2 days; the deprecation message says to wait for 0.1.0.

## Outcome

Both packages are public, and merging this change publishes nothing. On the checkout, `release-plan.mjs plan` prints `publish=false` with the reason "the packages are still at 0.0.0, which is never released".

- **What keyed off `private`.** Five things, each checked after the change:
  - The release plan's `private` check no longer fires, and its 0.0.0 rule stops the run. Two new tests in `scripts/ci/release.test.mjs` read the checkout's own `package.json` files. One fails at any version if either sets `private` or loses its publish guard. The other runs the plan, fails if it would publish or ask the registry at 0.0.0, and skips once the packages leave 0.0.0.
  - `ci.yml`'s `changesets` job stays `if: false`. Locally, this change fails `pnpm changeset status --since=origin/main`, because it edits each `package.json`. With this change as the base, a docs-only commit passes and a `src/` edit without a changeset fails. The job also fails any pull request that runs `pnpm changeset version`, L4b's own as planned and every "Version packages" one, so [L4b](../ready/L4b-release-0-1-0.md#risks-and-open-questions) must settle that before it switches the job on.
  - `privatePackages` in `.changeset/config.json` today affects only the `verify/` harnesses, which `ignore` also lists. Once the plans add private apps and packages, it skips those too.
  - The pack test in `scripts/ci/packages-pack.test.mjs` passes unchanged with pnpm 10.34.9.
  - `private` also made `npm publish` refuse to run in a package folder. The first code review added a `prepublishOnly` guard, `scripts/refuse-local-publish.mjs`, so a publish from a developer's machine still fails; `release.yml` publishes tarballs, which run no lifecycle scripts.
- **The npm placeholders.** `npm view <package> versions dist-tags deprecated --json`, on 2026-11-19, gave the same answer for `@buildanagent/gateway` and `@buildanagent/sdk`: versions `0.0.0-bootstrap.0` and `0.0.0-stage`; dist-tags `latest` and `bootstrap` both on `0.0.0-bootstrap.0`; deprecated "Placeholder only; install 0.1.0 or later." That matches [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted).
- **Docs.** [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19) records npm's prerequisite that a package exist before a trusted publisher can be added, and the first dry run on `main`. It also records the publish guard, and §3e records the gate's conflict with `pnpm changeset version`. §3e, the `.changeset` README, `CONTRIBUTING.md`, the SDK plan and the `ci.yml` comment no longer say the packages are private. [L4b](../ready/L4b-release-0-1-0.md#risks-and-open-questions) records the gate's conflict as a risk. The fact-check log gains rows 127–139, and [L3](L3-release-workflow.md) records its dry run on `main`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
