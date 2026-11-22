# L11: Verify the placeholders, and publish the protocol, harness, CLI and agent-safety together through trusted publishing

| Field | Value |
| --- | --- |
| ID | `L11` |
| Status | `ready` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L9](../done/L9-publish-protocol-harness-cli-decision.md), [L10](L10-make-protocol-harness-cli-publishable.md), [N29](N29-stdio-transport.md), [N30](N30-cli.md) |
| Size | M |

## Goal

Make the four packages public, switch the release to all six, and publish the first alpha of the protocol, harness, CLI and agent-safety together through `release.yml`, once N30 has given the CLI a working binary ([PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). N29 and N30 don't depend on each other (both depend on N28), but the CLI's `rpc` command uses N29's stdio transport and [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md) decision 1 requires both before the release, so this todo lists N29 itself.

## Context

- [L4a](../done/L4a-bootstrap-and-trusted-publishers.md) and [L4b](../done/L4b-release-0-1-0.md): how the gateway and SDK were bootstrapped and released
- [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19): the release workflow, its tests and the owner setup
- [PB4's owner checklist](../../plans/publish-and-docs.md#3-what-the-owner-sets-up) (item 4)
- npm's [`trust` docs](https://docs.npmjs.com/cli/v11/commands/npm-trust): a package must exist before a trusted publisher can be added

## Scope

**In scope**

- Remove `private: true` from the four packages (protocol, harness, CLI, agent-safety), and make `release-plan.mjs` survive the merge. Dropping `private` makes the four count as versioned members: gateway and SDK sit at `0.1.0-alpha.N` while the four stay at `0.0.0`, and `planRelease` throws "the packages must share one version" (`scripts/ci/release-plan.mjs`, the `versions.size !== 1` check) before it reaches the pending-changeset skip or the 0.0.0 refusal. Once `RELEASE_ORDER` lists six packages, that would fail the `plan` job on every push to `main`, the L11 merge included. The fix this todo makes:
  - Move the same-version check to after the "pre mode is exiting" (needs-version) skip and before the 0.0.0 refusal. The order becomes: private skip, pending-changesets skip, pre-mode-exit skip, same-version check, 0.0.0 refusal, pre-mode match.
  - Give the skip results a version that doesn't depend on the check. Today `const [version] = versions` feeds `base.version` and `base.tag` before any skip, so with mixed versions it has no single value. After the move, `base.version` and `base.tag` come from `RELEASE_ORDER[0]`'s version, the gateway's, as `notes` already reads it; the check then reads each package's version again and throws only when they differ.
  - The L11 merge carries a changeset, so its plan reports `publish=false` with the pending reason and the `version` job opens the Version packages pull request, where the fixed group should bring all six to one version (see the throwaway-branch task).
  - Tests: six packages at mixed versions with a pending changeset plan `publish=false` and don't throw; mixed versions with pre mode exiting and nothing else pending plan `publish=false` and don't throw; mixed versions with nothing pending still throw, and so do mixed 0.0.0 and alpha versions with nothing pending, on purpose, because a hand-edited version must stop the run; six packages at one version publish in dependency order; and `RELEASE_ORDER` equals the six names in L10's list of packages that will publish.
- Verify the placeholders with `npm view @buildanagent/<name> name versions dist-tags deprecated` for all six packages, and record the output in the pull request description. The owner published placeholders of the four new packages by hand, and `npm view` (about 15:00 UTC on 2026-11-22) showed all four (`protocol`, `harness`, `cli`, `agent-safety`) with `0.0.0-bootstrap.0` and `0.0.0-stage`, and `latest` and `bootstrap` on `0.0.0-bootstrap.0`. Neither version of the four was deprecated yet: deprecation is pending owner action (the owner has the `npm deprecate` commands), while the gateway's and SDK's placeholders are deprecated. The expected state, as for those two, is both versions deprecated with "Placeholder only; install 0.1.0 or later." This task verifies it; if a deprecation is still missing, the owner adds it (a write command, not ours to run).
- **The Version packages pull request text and the changeset gate.** `scripts/ci/version-pr.mjs` hard-codes the pull request body (`prBody`: "Merging this pull request publishes `@buildanagent/gateway` and `@buildanagent/sdk` ${version}…"). Derive the package names from `RELEASE_ORDER`, so the body names all six, and update `scripts/ci/version-pr.test.mjs` to match. Dropping `private` also makes `versionedPackageDirs` in `scripts/ci/changeset-gate.mjs` count the four, so a change to their `src/`, `package.json` or `tsconfig.build.json` needs a changeset from this todo on; add a gate test for that, and one that a changeset naming only a formerly private member is pending once `RELEASE_ORDER` lists it.
- Extend `scripts/ci/release-plan.mjs` (`RELEASE_ORDER`, the list of versioned packages) and its tests to the six packages in dependency order: gateway, SDK, agent-safety, protocol, harness, CLI. Check each package's `dependencies` and `peerDependencies` first, and reorder if the graph requires it.
- **The `release.yml` change as a document.** Sessions must not edit `.github/workflows/`. Write the complete new `release.yml`, whole file, to `docs/plans/reviews/release-yml-for-six-packages.md` as one code block, with a list of what changed from `main`'s file (the pack loop, the publish loop and the tarball checks go from `gateway sdk` to `gateway sdk agent-safety protocol harness cli`, and the release-notes join covers six changelogs). The manager hands it to the owner, who adds it to this pull request's branch.
- A note in `.changeset/README.md` and [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19) saying all six publish.
- A statement in the pull request description and in §3f that the first alpha of each package publishes only through `release.yml` on a push to `main`, never from a session or a developer's machine.

**Out of scope** (and which todo covers it)

- Making the packages buildable and documented (L10)
- Editing anything under `.github/` (the owner adds the document's file to this pull request's branch)
- Publishing, or any `npm` write command (the owner and `release.yml`)

## Tasks

- [ ] Check that N29 and N30 are merged and L10 is done (the owner's `agent-safety` choice is made: ADR 0058, decision 9).
- [ ] Verify the placeholders with `npm view @buildanagent/<name> name versions dist-tags deprecated` for all six packages, and record the output.
- [ ] Remove `private` from the four packages, with one changeset that names all six.
- [ ] Update `version-pr.mjs`'s body and its test, and add the changeset-gate tests for the four, as the scope above says.
- [ ] Extend `release-plan.mjs` and `release.test.mjs` to six packages in order, and move the same-version check as the scope above says.
- [ ] On a throwaway branch, run `pnpm changeset version` with the six-member fixed group and the four at 0.0.0 under pre mode, and record whether all six reach one `0.1.0-alpha.N` (Changesets' handling of members absent from `pre.json` is unverified, row L9-20). **Fallback if they don't:** set the four packages' `version` in their `package.json` to the gateway's current `0.1.0-alpha.N` in this pull request, so the six already share one version when the plan runs and the changeset then bumps them together. Update the plan and the checklist to match, and rerun the plan tests.
- [ ] Write the `release.yml` document, and check it with the existing release tests pointed at the new file.
- [ ] Write the owner checklist into the pull request description (below).

## Owner checklist

The manager hands these to the owner, in order. The owner's merge of this pull request is the last step, because it carries the changeset, so the Version packages pull request opens and auto-merges right after it, and `release.yml` publishes on that merge. Anything that must exist before a publish has to exist before the merge.

1. Deprecate the placeholders if you have not yet: `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety` exist, but on 2026-11-22 neither of their two versions carried the deprecation "Placeholder only; install 0.1.0 or later." This todo verifies it afterwards. Do not add trusted publishers yet.
2. The `agent-safety` choice is made (publish it), so it needs only the trusted publisher below and its place in `RELEASE_ORDER` and the fixed group, which this pull request adds.
3. Add the new `release.yml` from the document to this pull request's branch, so it lands in the same merge as L11, and don't commit it to `main` before. The new file loops over all six packages, while `main`'s `release-plan.mjs` still lists two and the four are private, so an ordinary gateway or SDK Version packages pull request that auto-merged in between would plan a publish whose pack and publish loops try to pack and test private packages. If you must commit it early, do it only while no alpha is pending and no changeset is open, and hold every other merge until L11 lands.
4. On npmjs.com, add a trusted publisher to each of the four packages: user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`, `npm publish` ticked under **Allowed actions**. Do it immediately before step 5: the 2-day expiry starts here ([npm docs](https://docs.npmjs.com/trusted-publishers)).
5. Merge L11's pull request. Its changeset makes `release.yml` open the Version packages pull request with auto-merge on, and once that merges, `release.yml` publishes all six, gateway first and CLI last, under `alpha`. To hold the release back, leave L11 unmerged.
6. Check that each new package page shows provenance. If a trusted publisher expired, add it again and re-run the release.

## Acceptance criteria

- [ ] The four `package.json` files have no `private` field, and on the L11 merge commit `release-plan.mjs plan` exits 0 and prints `publish=false` with the pending-changesets reason, instead of throwing on mixed versions
- [ ] `npm view` for each of the six packages shows the placeholders as PB4 expects, recorded in the pull request description
- [ ] The Version packages pull request body names all six packages, derived from `RELEASE_ORDER`, and the changeset gate counts the four
- [ ] `release-plan.mjs` and its tests handle six packages in dependency order, and cover the mixed-version cases above
- [ ] `docs/plans/reviews/release-yml-for-six-packages.md` holds the whole file, and the release tests pass against it
- [ ] No commit of ours changes a file under `.github/`; the owner adds `release.yml`
- [ ] No session or developer machine publishes the four; the first alpha is the owner's to confirm after the merge (checklist step 6), and the Outcome is updated afterwards with the `release.yml` run's link
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`scripts/ci/release.test.mjs` and the CI scripts' tests, against the new workflow text.

## Docs to update

CI plan §3f, the publish plan's todo table and PB4, `scripts/ci/version-pr.mjs` and its test, `.changeset/README.md`, AGENTS.md's `release.yml` paragraph.

## Risks and open questions

- A trusted publisher added early expires after 2 days, so step 4 comes just before the merge. Merging before it exists makes the first publish fail, so the owner merges last.
- A fixed group moves all six packages with every release, including any with no change of its own.
- The pack job runs every package's tests, so a flaky test in one holds up all six.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
