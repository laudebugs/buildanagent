# 0058. Publish the protocol, harness and CLI together as alphas, after N30, in one fixed group with the gateway and SDK

- **Status:** Accepted (owner, 2026-11-22; relayed by the manager session)
- **Date:** 2026-11-22
- **Amends:** [ADR 0047](0047-first-release-and-trusted-publishing.md), which covered only the gateway and SDK
- **Plan:** [publish-and-docs.md, PB4](../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted)

## Context

[ADR 0047](0047-first-release-and-trusted-publishing.md) published `@buildanagent/gateway` and `@buildanagent/sdk`, and the [publish plan](../plans/publish-and-docs.md#1-goal-and-non-goals) left the harness packages out: "They join the fixed version group when their plans ship them." On 2026-11-22 the owner decided to publish three more: `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli`. `@buildanagent/evals` stays private.

As of 2026-11-22 the three packages are `private: true` at version 0.0.0, and `npm view` returns E404 for each, so unlike the gateway and SDK they have no npm placeholder. The CLI's `src/index.ts` is a stub that exports only `PACKAGE_NAME`; todo N30 builds the real CLI. The protocol's server requests, cancellation and stdio transport are unbuilt (N28 and N29). `.changeset/config.json` holds one fixed group, `["@buildanagent/gateway", "@buildanagent/sdk"]`, and `release.yml` packs and publishes `gateway sdk` in a loop.

## Decision

1. **One release, after N30.** The protocol, harness and CLI publish together, in one release, and nothing publishes until N30 (the CLI) is merged, so the CLI has a working binary. N30 depends on N28, which builds the protocol's server requests, and the stdio transport (N29) lands beside them, so both land first. The owner chose this on 2026-11-22, replacing an earlier plan to publish the protocol first, then the harness, then the CLI. Inside the release, the publish job still goes in dependency order, protocol, then harness, then CLI, so each package's `workspace:*` pins name a version npm already holds.
2. **Version and dist-tag.** Each package publishes as a `0.1.0-alpha.N` under npm's `alpha` dist-tag, and `latest` stays untouched. For the new packages `latest` will point at whatever placeholder the owner publishes by hand (step 6), as it points at `0.0.0-bootstrap.0` for the gateway and SDK.
3. **One fixed group of five.** `.changeset/config.json` lists gateway, SDK, protocol, harness and CLI in one `fixed` group. Changesets' `fixed` option declares that "packages should be version-bumped and published together", and its guide says the group's members share one version "even if some had no changes". The cross-package pins are `workspace:*`, which pnpm replaces with the target package's current version when it packs, so every packed range names the version published beside it. A fixed group keeps those pins coherent and lets a user quote one version for the whole stack. The cost is that a change to any package bumps all five, so an unstable package still takes a version number and a changelog entry with the others.
4. **`private` drops late.** A package loses `private: true` only in the todo that bootstraps it (L11), after L10 has made it buildable, documented and checked. Until then its first alpha can't publish.
5. **The protocol imports no gateway or SDK code at run time.** It depends on both for types only. N26 checks the sources in the repo; the check on the published tarball is separate (L10), because only the tarball's JavaScript decides what a user's install loads.
6. **Placeholders by hand, trusted publishers late.** npm needs a package to exist before a trusted publisher can be added, so the owner publishes a placeholder of each package by hand, as on 2026-11-19, and can do it any time. A new trusted publisher expires unless it publishes within 2 days, so the owner adds the three only when the release is about to publish.
7. **The CLI has a binary.** It needs a `bin` entry and a shebang that survives the build, which L10 sets up and N30 fills in.
8. **First alphas only from CI.** The first alpha of each package publishes only through `release.yml`, on a push to `main`, never from a session or a developer's machine.

## Consequences

- **Todos.** L10 makes the three packages publishable while they stay private. L11 bootstraps them and changes `release.yml`; because sessions don't edit `.github/workflows`, L11 hands the owner the whole new file. L11 waits for N30.
- **Release code changes.** `release.yml` and `scripts/ci/release-plan.mjs` name only the gateway and SDK today, so L11 changes both for five packages in dependency order.
- **Open question for the owner.** The harness's `dependencies` list `@buildanagent/agent-safety`, which is private, so a published harness would point users at a package npm doesn't hold. The SDK met the same problem and carries vendored copies instead ([build-sdk plan](../plans/build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory)). Before the release the owner chooses between publishing `agent-safety` as a sixth member of the group and vendoring or inlining what the harness imports. A new ADR records the choice. L10's pack test fails any published package that depends on a private one, so the question can't be skipped.
- **Owner setup.** The owner publishes three placeholders whenever convenient, and adds the three trusted publishers only when the first alpha is about to publish, so the first publish lands within the 2 days ([plan §3](../plans/publish-and-docs.md#3-what-the-owner-sets-up)).
- **ADR 0047 stands** for trusted publishing, the `release` environment and the Changesets flow. This record widens the group it names and adds the readiness gates.
