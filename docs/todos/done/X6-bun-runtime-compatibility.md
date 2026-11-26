# X6: Measure whether the repository's code runs under Bun

| Field | Value |
| --- | --- |
| ID | `X6` |
| Status | `done` |
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
- [`docs/plans/reviews/fact-check-ci.md`](../../plans/reviews/fact-check-ci.md) (new log), for §3h's three new factual claims (Bun's publish date, ADR 0033's targets, the portable-agents recommendation).

## Outcome

- **Bun stays unsupported, and the gap isn't small.** No code change makes anything run under it; this todo is purely the measurement [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) records, with `.bun-version` pinning the exact build tested (`1.4.4`, published 2026-10-22).
- **A first pass measured Node twice and reported everything clean.** `bun x tsc`/`bun x vitest run` run a tool through its own `#!/usr/bin/env node` shebang, which Bun follows under Node unless given `--bun`. The high code review caught this; §3h's numbers are the corrected, `--bun`-forced run.
- **No package is clean under real Bun.** `gateway` (4 of 496 fail), `sdk` (28 of 735 fail), `agent-safety` (28 of 445 fail), `harness` (34 of 1,847 fail, plus a jump from 104 to 160 skipped), `protocol` (1 of 54 fail), `cli` (5 of 83 fail). `evals` (0 of 2 fail) and `apps/manual` (1 of 818 fail) are close to clean. Six of eight `verify/*` harnesses run clean, each confirmed by typecheck and a matching example count; `cloudflare-agents` is the largest single gap (below); `copilot-sdk` refuses the same way under both runtimes.
- **Every one of the 15 `scripts/ci/*.test.mjs` files was run and compared against Node, not just the 6 that surface a gap below.** Two more failed under Bun at first but turned out to be pre-existing, unrelated to the runtime: `packages-pack` (a local corepack/network issue, same under Node) and `sites-workflows` (the same 3 of 188 tests fail under Node too, because its tested script calls GNU `date -d`, which this machine's BSD `date` doesn't support). The rest ran clean under both.
- **Nine real gaps, full detail in §3h.** The two biggest by test count: Miniflare (Cloudflare's local Workers simulator) doesn't work under Bun, breaking `verify/cloudflare-agents` and most of `agent-safety`'s Cloudflare-backed tests; and Bun has no `module.registerHooks`, breaking every `book-examples.test.ts` that goes through `scripts/transcripts/source-condition.mjs`. The other seven: `@earendil-works/pi-schema` doesn't resolve under Bun's `source`-condition handling; `tsx`'s loader doesn't register; a subprocess spawned with an allowlisted environment can't find `node` on `PATH`; `node:assert.throws(fn, "")` is rejected (which also surfaced a pre-existing bug in that test, unrelated to Bun: it was never checking the thrown error at all); a directory listing's order differs (a fragile test assertion, not a real behavior bug); a `String.raw` fixture gets mangled by Bun's own transpiler, in test source, not product code; and `scripts/ci/live-run.test.mjs`'s 5 confirmed Bun-only failures plus a separate, pre-existing hang under Node that the first pass mistook for "too slow to compare."
- **~26 of `harness`'s failures are not individually root-caused.** The scope ran out before finishing them; some are likely instances of the two biggest gaps, some may be new.
- Three proposals for the owner, none applied: keep Bun unsupported, since the gaps are large enough that supporting it is a real project, not a quick fix; if pursued, split by gap, not as one todo; a Bun CI job isn't realistic until most of the above lands.

## Risks and open questions

- **~26 of `harness`'s failures are not individually root-caused**, only grouped by test file. Someone who wants Bun support would need to dig further, and may find more than nine gaps once they do.
- **The Node baseline is Node 24.19.0, this machine's version, not `.nvmrc`'s pinned 22.** A different Node minor could in principle behave differently; not checked.
- **Who decides.** The owner decides whether any found gap is worth its own fix-it todo, and whether Bun support is worth pursuing further than this measurement.
- **This todo skipped the `ready/` board state, against `TEMPLATE.md`'s instructions and the sibling todos' pattern.** A medium-effort review flagged this as a hard standards violation: `docs/todos/TEMPLATE.md` says to copy a new todo into `ready/` first, and X1, X2 and X5 all did; X6 was written and claimed in the same commit, in `ongoing/`. This is left as the honest record rather than reversed, since rewriting history to insert a `ready/` state after the fact would misrepresent when the work actually started. Later todos should go through `ready/` first.

## Definition of done

- [x] Claimed: the first commit created this file directly in `ongoing/` (Status `ongoing`), not moved from `ready/` — the todo was written and claimed in the same commit, so there was no separate `ready/` state to move from
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
