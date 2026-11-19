# 0047. Publish 0.1.0 of the gateway and SDK once a model call works, versioned by Changesets and published through npm trusted publishing

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, PB1 and PB2](../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted)

## Context

ADR 0008 kept both packages private until the owner chose to publish. On 2026-11-19 the owner reserved the `@buildanagent` scope on npm, said "We can start publishing as soon as we're ready to", and chose "0.1.0 once a model call works". Lamina PDF publishes with a fixed Changesets group and npm trusted publishing, which needs no stored npm token ([npm docs](https://docs.npmjs.com/trusted-publishers)).

## Decision

`@buildanagent/gateway` and `@buildanagent/sdk` publish 0.1.0 once todos B4 (`createModel()` and retries) and B8 (the Anthropic adapter) are done. Changesets versions them as one fixed group with public access, and writes each package's changelog. Only `release.yml` publishes, on a GitHub-hosted runner in the `release` environment, through npm trusted publishing with provenance. If npm needs a package to exist before a trusted publisher can be added, a manual `bootstrap` job in `release.yml` publishes a `0.0.0-bootstrap.0` placeholder once, with a temporary token and `--provenance`; 0.1.0 itself then goes through trusted publishing within the 2-day window npm allows, and the token, secret and job are removed. Changesets doesn't version the private packages, and its CI gate turns on with the 0.1.0 changeset. ADR 0008's 0.x rule applies from 0.1.0.

## Consequences

- Both packages drop `private: true` in todo L4.
- From the 0.1.0 release on, every pull request that changes a package's behaviour adds a changeset, and CI fails without one (todos L2 and L4).
- The owner configures a trusted publisher per package on npmjs.com, and approves releases in the `release` environment.
