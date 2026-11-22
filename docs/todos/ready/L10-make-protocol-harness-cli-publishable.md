# L10: Make the protocol, harness, CLI and agent-safety publishable while they stay private

| Field | Value |
| --- | --- |
| ID | `L10` |
| Status | `ready` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L9](../done/L9-publish-protocol-harness-cli-decision.md), which records the owner's choice to publish `agent-safety` ([ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md), decision 9) |
| Size | L |

## Goal

Bring `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety` up to the standard the gateway and SDK met in L1, L2 and B20, with `private: true` still set, so L11 only has to verify their placeholders and publish them ([PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). Split it into L10a, L10b and so on if one pull request grows too large; N30 may land before or after it, and the CLI parts that need N30's binary wait for it.

## Context

- [ADR 0050](../../decisions/0050-dist-build-with-source-condition.md) and [ADR 0051](../../decisions/0051-dist-build-corrections-from-l1.md): the `dist/` build, the `source` condition and `publishConfig.exports`
- [L1](../done/L1-build-dist-packages.md), [L2](../done/L2-changesets.md): how the gateway and SDK were set up
- `scripts/docs-check.mjs`-style checks in `scripts/package-docs.mjs`, which the gateway's and SDK's `test` already run ([AGENTS.md](../../../AGENTS.md#layout))
- `scripts/ci/packages-pack.test.mjs`: the pack test, its `--conditions=source` exception lists and its `OPTIONAL_PEER_FAILURES` list, which already covers `agent-safety`'s `byok`, `cost` and `stores/dynamodb` entries
- `scripts/ci/changeset-gate.mjs`: the changeset gate

## Scope

**In scope**

- **Build and manifest.** Each package's `tsconfig.build.json`, `dist/` build, `exports` (with the `source` condition), `publishConfig.exports`, `files`, `types`, `sideEffects` and `engines` follow ADRs 0050 and 0051. Most are in place already (`agent-safety` has all of them but `llms.txt` in `files`); check each and fix gaps, such as the harness's per-component subpaths.
- **Docs.** For each of the four, a package README that passes the shared docs checks (every TypeScript block type-checks, every documented export is in the declarations, `experimental_` matches `@experimental`) and a committed `llms.txt`, wired into each package's `test` through `scripts/docs-check.mjs`.
- **TSDoc.** A TSDoc comment on every export, and `pnpm check:api-docs` extended to the four packages.
- **Pack tests.** Extend `scripts/ci/packages-pack.test.mjs` to pack the protocol, harness and CLI (it already packs `agent-safety`, with its optional-peer exceptions, which stay), with the same `--conditions=source` exception lists where a third-party entry fails under that condition. The test's `llms.txt` requirement today applies to packages that are not `private`; L10 makes it apply to the six packages that will publish, so a missing `llms.txt` fails now, not at L11. It also checks that the tarball holds only `dist/`, `package.json`, `README.md`, `CHANGELOG.md`, `llms.txt` and the licence files (the test's `TOP_LEVEL` set, which requires `llms.txt` of every public package), so each package's `files` lists `llms.txt` beside `dist` and the licences, as the SDK's does, and `agent-safety`'s `files` gains it.
- **The protocol's tarball imports neither the gateway nor the SDK.** A test reads the packed protocol's JavaScript and fails if any file imports `@buildanagent/gateway` or `@buildanagent/sdk`, including through a re-export. The protocol depends on both for types only; N26 checks the sources, and this checks what ships.
- **No package that will publish depends on one that won't.** The check doesn't read the `private` field, because all six are still private until L11. It holds a list of the six names that will publish (gateway, SDK, agent-safety, protocol, harness, CLI; L11 adds a test that the list equals `RELEASE_ORDER`) and fails if a packed manifest among them names, in `dependencies` or `peerDependencies`, any other workspace package, such as the private `@buildanagent/evals`. It therefore fires from the day L10 lands, and today it passes: the harness's `@buildanagent/agent-safety` is one of the six.
- **The CLI's `bin` and shebang.** `bin` names `buildanagent`, points at a built file in `dist/`, and the file starts with `#!/usr/bin/env node`; a test packs the CLI, installs it into a temp project and runs the binary's `--help` with no network.
- **Changesets and the fixed group.** `.changeset/config.json` lists gateway, SDK, agent-safety, protocol, harness and CLI in one `fixed` group.
  - **No changeset gate yet.** `versionedPackageDirs` in `scripts/ci/changeset-gate.mjs` skips every package with `private: true`, so a change to the four's `src/`, `package.json` or `tsconfig.build.json` needs no changeset until L11 drops `private`.
  - **Unverified.** Changesets' handling of a private member of a fixed group is untested (rows L9-10 and L9-20; the packages are still private, and `privatePackages` sets `version: false`).
  - **The check is a hard gate.** Before the `.changeset/config.json` change, run the test on a throwaway branch: put the six in the group, add a changeset naming the gateway, and run `pnpm changeset version` under pre mode. Record in the pull request description whether Changesets rejects, skips or bumps the private members. If it rejects or skips them, don't touch the config in L10. Move the config change to L11, in the same commit that drops `private`, and say so in the pull request.
- `private: true` stays on all four.

**Out of scope** (and which todo covers it)

- Dropping `private`, placeholders, trusted publishers and `release.yml` (L11)
- The CLI's behaviour (N30), the protocol's server requests and stdio transport (N28, N29)
- Choosing how the harness gets `agent-safety`: decided, publish it (ADR 0058, decision 9)

## Tasks

- [ ] Compare each of the four packages' manifest and `tsconfig.build.json` with the gateway's and SDK's, and fix the gaps.
- [ ] Write each package's README, with tested examples from `examples/` where a block runs more than five lines ([examples.md](../../guidelines/examples.md)), and generate its `llms.txt`.
- [ ] Add TSDoc to every export, and extend `check:api-docs` to the four packages.
- [ ] Extend `packages-pack.test.mjs` for the four packages, and add the protocol-imports test, the dependency-outside-the-six test and the CLI binary test.
- [ ] Run the throwaway-branch fixed-group test, and record its result.
- [ ] Add the four packages to the fixed group, only if that test passed; otherwise record why the change moved to L11.
- [ ] Check that `changeset-gate.test.mjs` and the release plan still pass with the new group. The gate needs no changeset for the four while they are private, so the changeset for their changes moves to L11 (`release-plan.mjs` `isPendingChangeset` only counts names in `RELEASE_ORDER`, so a changeset naming only private members is not pending until L11).

## Acceptance criteria

- [ ] `pnpm build` writes `dist/` for all six packages that will publish, and `pnpm pack` for each yields only the files ADR 0050 allows
- [ ] Each README's TypeScript blocks type-check, and `scripts/docs-check.mjs` passes for all four
- [ ] `pnpm check:api-docs` fails on an undocumented export in any of the four packages
- [ ] The pack test fails when the packed protocol imports the gateway or SDK, and passes today
- [ ] The pack test fails when one of the six packages that will publish depends on a workspace package outside the six, and passes today
- [ ] The packed CLI's binary starts with a shebang and prints help offline
- [ ] `private: true` is still set on all four, and `release-plan.mjs plan` still publishes nothing
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass offline from the repo root

## Tests

`scripts/ci/packages-pack.test.mjs` and each package's docs checks in its `test`. For the fixed group, L10 tests only that the config parses with the six names and that `scripts/ci/changeset-gate.test.mjs` still passes. Whether a change to the four needs a changeset is tested in L11, once `private` is gone.

## Docs to update

The package READMEs, AGENTS.md's layout paragraph (which packages are published; it calls `agent-safety` private until L11), the [TypeScript guideline](../../guidelines/typescript.md) if its export rule mentions private packages, the plan's todo table.

## Risks and open questions

- A fixed group with private members may not work in Changesets; the hard gate above says how to check it and what to do if it fails.
- `agent-safety` has optional peers, so its pack test keeps its `OPTIONAL_PEER_FAILURES` exceptions.
- The harness has many subpath exports, so its pack test's resolution loop is long.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
