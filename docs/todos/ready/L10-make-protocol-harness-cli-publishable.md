# L10: Make the protocol, harness and CLI publishable while they stay private

| Field | Value |
| --- | --- |
| ID | `L10` |
| Status | `ready` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L9](../done/L9-publish-protocol-harness-cli-decision.md) |
| Size | L |

## Goal

Bring `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` up to the standard the gateway and SDK met in L1, L2 and B20, with `private: true` still set, so L11 only has to bootstrap and publish them ([PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). Split it into L10a, L10b and so on if one pull request grows too large; N30 may land before or after it, and the CLI parts that need N30's binary wait for it.

## Context

- [ADR 0050](../../decisions/0050-dist-build-with-source-condition.md) and [ADR 0051](../../decisions/0051-dist-build-corrections-from-l1.md): the `dist/` build, the `source` condition and `publishConfig.exports`
- [L1](../done/L1-build-dist-packages.md), [L2](../done/L2-changesets.md): how the gateway and SDK were set up
- `scripts/docs-check.mjs`-style checks in `scripts/package-docs.mjs`, which the gateway's and SDK's `test` already run ([AGENTS.md](../../../AGENTS.md#layout))
- `scripts/ci/packages-pack.test.mjs`: the pack test and its `--conditions=source` exception lists
- `scripts/ci/changeset-gate.mjs`: the changeset gate

## Scope

**In scope**

- **Build and manifest.** Each package's `tsconfig.build.json`, `dist/` build, `exports` (with the `source` condition), `publishConfig.exports`, `files`, `types`, `sideEffects` and `engines` follow ADRs 0050 and 0051. Most are in place already; check each and fix gaps, such as the harness's per-component subpaths.
- **Docs.** A package README that passes the shared docs checks (every TypeScript block type-checks, every documented export is in the declarations, `experimental_` matches `@experimental`) and a committed `llms.txt`, wired into each package's `test` through `scripts/docs-check.mjs`.
- **TSDoc.** A TSDoc comment on every export, and `pnpm check:api-docs` extended to the three packages.
- **Pack tests.** Extend `scripts/ci/packages-pack.test.mjs` to pack the three packages, with the same `--conditions=source` exception lists where a third-party entry fails under that condition. It also checks that the tarball holds only `dist/`, `README.md`, `CHANGELOG.md` and the licence files.
- **The protocol's tarball imports neither the gateway nor the SDK.** A test reads the packed protocol's JavaScript and fails if any file imports `@buildanagent/gateway` or `@buildanagent/sdk`, including through a re-export. The protocol depends on both for types only; N26 checks the sources, and this checks what ships.
- **No published package depends on a private one.** The pack test fails if a packed manifest's `dependencies` or `peerDependencies` name a private workspace package. This turns on the open question in [PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted): the harness lists `@buildanagent/agent-safety`. The owner's choice, recorded in a new ADR, must land before this check can pass.
- **The CLI's `bin` and shebang.** `bin` names `buildanagent`, points at a built file in `dist/`, and the file starts with `#!/usr/bin/env node`; a test packs the CLI, installs it into a temp project and runs the binary's `--help` with no network.
- **Changesets and the fixed group.** `.changeset/config.json` lists gateway, SDK, protocol, harness and CLI in one `fixed` group, and each package's `src/`, `package.json` or `tsconfig.build.json` change then needs a changeset under the CI gate. Changesets' handling of a private member of a fixed group is unverified (the packages are still private, and `privatePackages` sets `version: false`). Check it on a throwaway branch first. If Changesets rejects or skips private members, move the config change to L11, in the same commit that drops `private`, and say so in the pull request.
- `private: true` stays on all three.

**Out of scope** (and which todo covers it)

- Dropping `private`, placeholders, trusted publishers and `release.yml` (L11)
- The CLI's behaviour (N30), the protocol's server requests and stdio transport (N28, N29)
- Choosing how the harness gets `agent-safety`: the owner decides and a new ADR records it

## Tasks

- [ ] Compare each package's manifest and `tsconfig.build.json` with the gateway's and SDK's, and fix the gaps.
- [ ] Write each package's README, with tested examples from `examples/` where a block runs more than five lines ([examples.md](../../guidelines/examples.md)), and generate its `llms.txt`.
- [ ] Add TSDoc to every export, and extend `check:api-docs` to the three packages.
- [ ] Extend `packages-pack.test.mjs` for the three packages, and add the protocol-imports test, the private-dependency test and the CLI binary test.
- [ ] Add the three packages to the fixed group, or record why that moved to L11.
- [ ] Add a changeset for each package that users will see. Use `pnpm changeset --empty` for changes they won't.

## Acceptance criteria

- [ ] `pnpm build` writes `dist/` for all five packages that will publish, and `pnpm pack` for each yields only the files ADR 0050 allows
- [ ] Each README's TypeScript blocks type-check, and `scripts/docs-check.mjs` passes for all three
- [ ] `pnpm check:api-docs` fails on an undocumented export in any of the three packages
- [ ] The pack test fails when the packed protocol imports the gateway or SDK, and passes today
- [ ] The pack test fails when a published package depends on a private one, and passes once the owner's `agent-safety` choice has landed
- [ ] The packed CLI's binary starts with a shebang and prints help offline
- [ ] `private: true` is still set on all three, and `release-plan.mjs plan` still publishes nothing
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass offline from the repo root

## Tests

`scripts/ci/packages-pack.test.mjs`, each package's docs checks in its `test`, and `scripts/ci/changeset-gate.test.mjs` for the new group.

## Docs to update

The package READMEs, AGENTS.md's layout paragraph (which package is published), the [TypeScript guideline](../../guidelines/typescript.md) if its export rule mentions private packages, the plan's todo table.

## Risks and open questions

- The `agent-safety` dependency blocks the harness's pack test until the owner chooses (PB4).
- A fixed group with private members may not work in Changesets; the task above says how to check it.
- The harness has many subpath exports, so its pack test's resolution loop is long.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
