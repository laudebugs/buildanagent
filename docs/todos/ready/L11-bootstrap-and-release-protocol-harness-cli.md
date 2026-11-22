# L11: Bootstrap the protocol, harness and CLI, and publish them together through trusted publishing

| Field | Value |
| --- | --- |
| ID | `L11` |
| Status | `ready` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L9](../done/L9-publish-protocol-harness-cli-decision.md), [L10](L10-make-protocol-harness-cli-publishable.md), [N29](N29-stdio-transport.md), [N30](N30-cli.md) |
| Size | M |

## Goal

Make the three packages public, switch the release to all five, and publish the first alpha of the protocol, harness and CLI together through `release.yml`, once N30 has given the CLI a working binary ([PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). N30 depends on N28, not on N29, but the CLI's `rpc` command uses N29's stdio transport and [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md) decision 1 requires both before the release, so this todo lists N29 itself.

## Context

- [L4a](../done/L4a-bootstrap-and-trusted-publishers.md) and [L4b](../done/L4b-release-0-1-0.md): how the gateway and SDK were bootstrapped and released
- [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19): the release workflow, its tests and the owner setup
- [PB4's owner checklist](../../plans/publish-and-docs.md#3-what-the-owner-sets-up) (item 4)
- npm's [`trust` docs](https://docs.npmjs.com/cli/v11/commands/npm-trust): a package must exist before a trusted publisher can be added

## Scope

**In scope**

- Remove `private: true` from the three packages, and make `release-plan.mjs` survive the merge. Dropping `private` makes the three count as versioned members: gateway and SDK sit at `0.1.0-alpha.N` while the three stay at `0.0.0`, and `planRelease` throws "the packages must share one version" (`scripts/ci/release-plan.mjs`, the `versions.size !== 1` check) before it reaches the pending-changeset skip or the 0.0.0 refusal. Once `RELEASE_ORDER` lists five packages, that would fail the `plan` job on every push to `main`, the L11 merge included. The fix this todo makes: move the same-version check below the "changesets pending" and "pre mode is exiting" skips, so it runs only when nothing is waiting to be versioned. The L11 merge carries a changeset, so its plan reports `publish=false` with the pending reason and the `version` job opens the Version packages pull request, where the fixed group brings all five to one version. Add tests: five packages at mixed versions with a pending changeset plan `publish=false` and don't throw; mixed versions with nothing pending still throw; and five packages at one version publish in dependency order.
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
- [ ] Extend `release-plan.mjs` and `release.test.mjs` to five packages in order, and move the same-version check below the pending skips.
- [ ] On a throwaway branch, run `pnpm changeset version` with the five-member fixed group and the three at 0.0.0 under pre mode, and record whether all five reach one `0.1.0-alpha.N` (Changesets' handling of members absent from `pre.json` is unverified). If they don't, say how the three reach the group's version before the release and change the plan to match.
- [ ] Write the `release.yml` document, and check it with the existing release tests pointed at the new file.
- [ ] Write the owner checklist into the pull request description (below).

## Owner checklist

The manager hands these to the owner, in order. The owner's merge of this pull request is the last step, because it carries the changeset, so the Version packages pull request opens and auto-merges right after it, and `release.yml` publishes on that merge. Anything that must exist before a publish has to exist before the merge.

1. Publish a placeholder of `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` from your machine with `--access public`, then deprecate each with "Placeholder only; install 0.1.0 or later." Any time before step 4. Do not add trusted publishers yet.
2. Choose how the harness gets `agent-safety` (publish it too, or vendor it), if not already chosen. If you publish it, it also needs a placeholder, a trusted publisher and a place in `RELEASE_ORDER` and the fixed group, so tell the manager before L11 starts.
3. Commit the new `release.yml` from the document, before merging L11's pull request. It is harmless on its own: nothing is pending, so the plan publishes nothing.
4. On npmjs.com, add a trusted publisher to each of the three packages: user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`, `npm publish` ticked under **Allowed actions**. Do it immediately before step 5: the 2-day expiry starts here ([npm docs](https://docs.npmjs.com/trusted-publishers)).
5. Merge L11's pull request. Its changeset makes `release.yml` open the Version packages pull request with auto-merge on, and once that merges, `release.yml` publishes all five, gateway first and CLI last, under `alpha`. To hold the release back, leave L11 unmerged.
6. Check that each new package page shows provenance. If a trusted publisher expired, add it again and re-run the release.

## Acceptance criteria

- [ ] The three `package.json` files have no `private` field, and on the L11 merge commit `release-plan.mjs plan` exits 0 and prints `publish=false` with the pending-changesets reason, instead of throwing on mixed versions
- [ ] `npm view` for each of the five packages shows the placeholders as PB4 expects, recorded in the pull request description
- [ ] `release-plan.mjs` and its tests handle five packages in dependency order
- [ ] `docs/plans/reviews/release-yml-for-five-packages.md` holds the whole file, and the release tests pass against it
- [ ] No file under `.github/` changed in the pull request
- [ ] No session or developer machine publishes the three; the first alpha is the owner's to confirm after the merge (checklist step 6), and the Outcome is updated afterwards with the `release.yml` run's link
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`scripts/ci/release.test.mjs` and the CI scripts' tests, against the new workflow text.

## Docs to update

CI plan §3f, the publish plan's todo table and PB4, `.changeset/README.md`, AGENTS.md's `release.yml` paragraph.

## Risks and open questions

- A trusted publisher added early expires after 2 days, so step 4 comes just before the merge. Merging before it exists makes the first publish fail, so the owner merges last.
- A fixed group moves all five packages with every release, including any with no change of its own.
- The pack job runs every package's tests, so a flaky test in one holds up all five.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
