# L11: Bootstrap the protocol, harness and CLI, and publish them together through trusted publishing

| Field | Value |
| --- | --- |
| ID | `L11` |
| Status | `ready` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L9](../done/L9-publish-protocol-harness-cli-decision.md), [L10](L10-make-protocol-harness-cli-publishable.md), [N30](N30-cli.md) |
| Size | M |

## Goal

Make the three packages public, switch the release to all five, and publish the first alpha of the protocol, harness and CLI together through `release.yml`, once N30 has given the CLI a working binary ([PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). N30 depends on N28, and N29 lands beside it, so they land first.

## Context

- [L4a](../done/L4a-bootstrap-and-trusted-publishers.md) and [L4b](../done/L4b-release-0-1-0.md): how the gateway and SDK were bootstrapped and released
- [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19): the release workflow, its tests and the owner setup
- [PB4's owner checklist](../../plans/publish-and-docs.md#3-what-the-owner-sets-up) (item 4)
- npm's [`trust` docs](https://docs.npmjs.com/cli/v11/commands/npm-trust): a package must exist before a trusted publisher can be added

## Scope

**In scope**

- Remove `private: true` from the three packages. Merging that publishes nothing: `release-plan.mjs` refuses version 0.0.0.
- Confirm with `npm view` that each package holds only the owner's deprecated placeholders (versions, dist-tags and the deprecation message), and record the output in the pull request description. Both the gateway's and SDK's placeholders and the three new ones are checked.
- Extend `scripts/ci/release-plan.mjs` (`RELEASE_ORDER`, the list of versioned packages) and its tests to the five packages in dependency order: gateway, SDK, protocol, harness, CLI.
- **The `release.yml` change as a document.** Sessions must not edit `.github/workflows/`. Write the complete new `release.yml`, whole file, to `docs/plans/reviews/release-yml-for-five-packages.md` as one code block, with a list of what changed from `main`'s file (the pack loop, the publish loop and the tarball checks go from `gateway sdk` to `gateway sdk protocol harness cli`, and the release-notes join covers five changelogs). The manager hands it to the owner, who commits it.
- A note in `.changeset/README.md` and [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19) saying all five publish.
- A statement in the pull request description and in §3f that the first alpha of each package publishes only through `release.yml` on a push to `main`, never from a session or a developer's machine.

**Out of scope** (and which todo covers it)

- Making the packages buildable and documented (L10)
- Editing anything under `.github/` (the owner commits the document)
- Publishing, or any `npm` write command (the owner and `release.yml`)

## Tasks

- [ ] Check that N30 is merged, L10 is done and the owner has chosen how the harness gets `agent-safety` (PB4).
- [ ] Confirm the placeholders with `npm view <package> versions dist-tags deprecated --json` for all five packages.
- [ ] Remove `private` from the three packages, with one changeset that names all five.
- [ ] Extend `release-plan.mjs` and `release.test.mjs` to five packages in order.
- [ ] Write the `release.yml` document, and check it with the existing release tests pointed at the new file.
- [ ] Write the owner checklist into the pull request description (below).

## Owner checklist

The manager hands these to the owner, in order:

1. Publish a placeholder of `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` from your machine with `--access public`, then deprecate each with "Placeholder only; install 0.1.0 or later." Any time before step 4.
2. Choose how the harness gets `agent-safety` (publish it too, or vendor it), if not already chosen.
3. Merge L11's pull request, then commit the new `release.yml` from the document.
4. On npmjs.com, add a trusted publisher to each of the three packages: user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`, `npm publish` ticked under **Allowed actions**. Do it only now: the 2-day expiry starts here ([npm docs](https://docs.npmjs.com/trusted-publishers)).
5. Merge the Version packages pull request. `release.yml` publishes all five, gateway first and CLI last, under `alpha`.
6. Check that each new package page shows provenance. If a trusted publisher expired, add it again and re-run the release.

## Acceptance criteria

- [ ] The three `package.json` files have no `private` field, and `release-plan.mjs plan` still prints `publish=false` at 0.0.0
- [ ] `npm view` for each of the five packages shows the placeholders as PB4 expects, recorded in the pull request description
- [ ] `release-plan.mjs` and its tests handle five packages in dependency order
- [ ] `docs/plans/reviews/release-yml-for-five-packages.md` holds the whole file, and the release tests pass against it
- [ ] No file under `.github/` changed in the pull request
- [ ] The first alpha of the three publishes through `release.yml` on a push to `main`, and its run is linked in the Outcome
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`scripts/ci/release.test.mjs` and the CI scripts' tests, against the new workflow text.

## Docs to update

CI plan §3f, the publish plan's todo table and PB4, `.changeset/README.md`, AGENTS.md's `release.yml` paragraph.

## Risks and open questions

- A trusted publisher added early expires after 2 days, so step 4 comes last.
- A fixed group moves all five packages with every release, including any with no change of its own.
- The pack job runs every package's tests, so a flaky test in one holds up all five.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
