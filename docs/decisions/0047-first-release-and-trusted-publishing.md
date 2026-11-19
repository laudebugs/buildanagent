# 0047. Publish 0.1.0 of the gateway and SDK once a model call works, versioned by Changesets and published through npm trusted publishing

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, PB1 and PB2](../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted)
- **Note (2026-11-19):** npm did need the packages to exist first, and the owner ran the bootstrap by hand from their own machine, without provenance, instead of through a `bootstrap` job. So L4a now only makes the packages public, and L4b adds the trusted publishers. [PB2](../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted) records the details; the decision below stands, except that its bootstrap path ran by hand.
- **Note (2026-11-19, L4b):** the first release is 0.1.0-alpha.0, and alphas publish without a "Version packages" pull request or an approval. The owner said "let's make the releases automated too. Let's keep it alpha for now until we're ready to publish", then "let's make the publishes run on every change to the package". So the repo is in Changesets pre mode with the tag `alpha`, and `latest` stays on the placeholder. The owner also removed the `release` environment's approval rule, so every publish runs unattended. `release.yml`'s version job, which pushed version commits straight to `main`, is switched off for now. Asked whether the version step should instead be "a pr that will be autocompleted", the owner answered "yes", so a follow-up makes it open a "Version packages" pull request that GitHub auto-merges. [CI plan §3f](../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19) holds the current flow; the decision below stands for trusted publishing and the fixed group.

## Context

ADR 0008 kept both packages private until the owner chose to publish. On 2026-11-19 the owner reserved the `@buildanagent` scope on npm, said "We can start publishing as soon as we're ready to", and chose "0.1.0 once a model call works". For the first publish they answered "Yes, one-time token if needed". Lamina PDF publishes with a fixed Changesets group and npm trusted publishing, which needs no stored npm token ([npm docs](https://docs.npmjs.com/trusted-publishers)).

## Decision

`@buildanagent/gateway` and `@buildanagent/sdk` publish 0.1.0 once todos B4 (`createModel()` and retries) and B8 (the Anthropic adapter) are done. Changesets versions them as one fixed group with public access, and writes each package's changelog. Only `release.yml` publishes, on a GitHub-hosted runner in the `release` environment, through npm trusted publishing with provenance. If npm needs a package to exist before a trusted publisher can be added, a manual `bootstrap` job in `release.yml` publishes a `0.0.0-bootstrap.0` placeholder once, with a temporary token, `--provenance` and `id-token: write`. 0.1.0 itself then goes through trusted publishing within the 2-day window npm allows, and the token, secret and job are removed.

Changesets doesn't version the private packages, and its CI gate turns on with the 0.1.0 changeset. ADR 0008's 0.x rule applies from 0.1.0.

## Consequences

- Both packages drop `private: true` in todo L4a, which also bootstraps them and adds the trusted publishers; todo L4b publishes 0.1.0.
- From the 0.1.0 release on, every pull request that changes a package's behaviour adds a changeset, and CI fails without one (todos L2 and L4b).
- The owner configures a trusted publisher per package on npmjs.com, and approves releases in the `release` environment.
