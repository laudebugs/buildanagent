# X6: Measure whether the repository's code runs under Bun

| Field | Value |
| --- | --- |
| ID | `X6` |
| Status | `ongoing` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | None |
| Size | M (a few hours) |

## Goal

Answer the owner's question, does this repository support Bun, with evidence rather than a guess: run every package's typecheck and tests, a sample of `verify/*`, and the root `scripts/ci/*.test.mjs` suite under the Bun runtime instead of Node, and record exactly what passes and what doesn't, each cross-checked against the same command under Node so a pre-existing, environment-specific failure isn't mistaken for a Bun gap. This measures compatibility only; it does not add Bun as a package manager (AGENTS.md keeps pnpm only) or as a deployment target ([ADR 0033](../../decisions/0033-three-deployment-targets.md) fixes four targets and would need a new ADR to add a fifth).

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the four targets Bun is not one of, and why adding a fifth needs its own decision.
- [`runtime-portability.md`](../../research/deployment/notes/runtime-portability.md): the existing research on Bun's Node compatibility, subprocess API and Vercel's Bun function support, and the portable-agents report's recommendation to type the stdio transport for later Deno/Bun/Workers reuse.
- AGENTS.md, "Toolchain": the pnpm-only, Node-22 rule this todo does not change.
- N19 and N50: the same "measure, record, let the owner decide" pattern this todo follows.

## Scope

**In scope**

- Pin an exact Bun version in `.bun-version`, at least a week old, matching AGENTS.md's version-age rule.
- Run `bun x tsc` and `bun x vitest run` for every package under `packages/`.
- Run `bun x vitest run` for `apps/manual`.
- Run each `verify/<sdk>`'s `bun x tsc` and `bun scripts/run-examples.mjs examples`.
- Run every `scripts/ci/*.test.mjs` file under `bun test`.
- Cross-check every failure against the same command under Node on the same machine; record only what fails under Bun and passes under Node as a real gap.
- Record the findings in [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), with proposed next steps for the owner.

**Out of scope** (and which todo covers it)

- Fixing any of the gaps this measurement finds. Each becomes its own todo, if the owner wants Bun support badly enough to chase them.
- Bun as a deployment target or a package manager; both need their own decision first.
- `apps/docs` and `apps/site`'s own test suites, and a full Astro build under Bun for any app. `apps/manual`'s Vitest suite stood in as the one Astro-app sample.

## Tasks

- [x] Pin `.bun-version`.
- [x] Run every package's typecheck and test under Bun; compare against Node.
- [x] Run `apps/manual`'s test suite under Bun.
- [x] Run every `verify/*` harness's typecheck and examples under Bun.
- [x] Run every `scripts/ci/*.test.mjs` file under `bun test`; compare each failure against Node.
- [x] Write the findings into CI plan §3h.

## Acceptance criteria

- [x] CI plan §3h names every package, app sample and harness checked, with a pass/fail count for each.
- [x] Every reported gap is confirmed absent under Node on the same machine, or is explicitly marked unconfirmed with why.
- [x] `.bun-version` exists and names the exact version the measurement used.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` still pass; this todo changes no package code.

## Tests

None added; this todo is a measurement, not a code change. The existing test suites, run once under Bun and once under Node, are the evidence.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) (new section).
- The CI plan's §4 todo table.
- AGENTS.md's "Toolchain" bullet, naming `.bun-version` and that Bun stays unsupported.

## Risks and open questions

- **`scripts/ci/live-run.test.mjs`** failed 7 of its tests under Bun, but its own run is long enough (real timers, a cost-cap retry loop) that a clean Node comparison did not finish inside this measurement. Recorded as unconfirmed in §3h; re-run both before trusting the count.
- **The `fact-check-log.mjs` and `transcripts.mjs` findings are not root-caused**, only reproduced and isolated to one fixture or one subprocess each. Someone who wants Bun support would need to dig further.
- **Who decides.** The owner decides whether any found gap is worth its own fix-it todo, and whether Bun support is worth pursuing further than this measurement.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
