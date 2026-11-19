# 0046. Run our packages' tests on Vitest, so the same suites can run inside workerd

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [SDK plan §3.1, Tooling](../plans/build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory), revised by this record

## Context

The SDK plan chose `node:test` through tsx so that no test framework was added. ADR 0033 then required every portable seam to pass one conformance suite on local Node, Cloudflare, AWS and Vercel. Cloudflare's supported way to run tests inside workerd is `@cloudflare/vitest-plugin`, which runs Vitest test files in the Workers runtime through Miniflare ([Cloudflare docs](https://developers.cloudflare.com/workers/testing/vitest-integration/), updated 2026-08-20; plugin 1.8.5 on npm as of 2026-11-19). With `node:test`, we would build and maintain our own workerd runner. Lamina PDF, whose practices the [guidelines](../guidelines/README.md) adopt, also tests on Vitest.

## Decision

Every package in `packages/` runs its tests with Vitest (`vitest run`), pinned in the root `package.json` (5.1.0, the newest release at least a week old as of 2026-11-19). Each package's `vitest.config.ts` lists the shared offline setup, `@buildanagent/gateway/testing/setup`, in `setupFiles`, so every test file runs behind the network guard, the provider-key check and `allowModelRequests(false)` without importing it. Test bodies keep `node:assert/strict`. The `verify/*` harnesses keep their own runners.

## Consequences

- The Cloudflare conformance tests (todos N45 and N46a) add `@cloudflare/vitest-plugin` and run the same suites inside workerd.
- Vitest adds Vite and its dependencies to the lockfile, so `pnpm audit` covers more packages.
- The SDK plan's Tooling paragraph, the harness and agent plans that copy it, the testing guideline and todo N1 now name Vitest.
