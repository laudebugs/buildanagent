# X11: Let `protocol`'s allowlisted-environment subprocess find `node` under Bun

| Field | Value |
| --- | --- |
| ID | `X11` |
| Status | `done` |
| Plan | [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26) |
| Round / milestone | Round X (CI) |
| Depends on | X6 |
| Size | S (one sitting) |

## Goal

[X6](../done/X6-bun-runtime-compatibility.md) measured that `protocol/test/package.test.ts` spawns `tsc` through `execFileSync` with the allowlisted environment AGENTS.md's "Running third-party code" rule asks for, and under Bun the spawned shell reports `exec: node: not found`, because `tsc`'s own `#!/usr/bin/env node` shebang has nothing to run: the allowlisted `PATH` doesn't include wherever Bun's host machine keeps `node`. This todo fixes the test's allowlisted environment so it works under either runtime, without widening AGENTS.md's allowlist rule itself.

## Context

- [CI §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 5: the measured failure.
- `protocol/test/package.test.ts`: the exact `execFileSync` call and the environment object it builds.
- AGENTS.md, "Running third-party code": the rule this fix must stay inside (spawn with an allowlisted environment — PATH, a temp HOME, TMPDIR, LANG plus what's needed — never full `process.env`).

## Scope

**In scope**

- Find exactly what `PATH` the test currently allowlists, and why it resolves `node` when the outer process is Node but not when it's Bun (likely: the allowlisted `PATH` is built from a fixed list of directories rather than from `process.execPath`'s own directory).
- Fix the test to include whatever directory actually holds a working `node` binary regardless of which runtime launched the test (for example, deriving a directory from `process.execPath` when running under Node, or keeping a known-good system path), without allowlisting the full `process.env`.
- Confirm the test passes under both Node and Bun.

**Out of scope** (and which todo covers it)

- Any other X6 gap (X7–X10, X12–X15).
- Changing AGENTS.md's allowlist rule itself; this fixes the test's environment construction, not the policy.

## Tasks

- [x] Read `protocol/test/package.test.ts`'s `execFileSync` call and its environment object.
- [x] Reproduce the failure under Bun and confirm the allowlisted `PATH`'s exact contents at failure time.
- [x] Fix the `PATH` construction so a working `node` is always reachable, under either runtime, within AGENTS.md's allowlist rule.
- [x] Run the test under both `node --test`/`vitest run` and `bun --bun x vitest run` in `packages/protocol`.

## Acceptance criteria

- [x] `protocol/test/package.test.ts` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.
- [x] The fix still spawns with an allowlisted environment, not `process.env`, per AGENTS.md.

## Tests

The existing `package.test.ts` is the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 5.

## Risks and open questions

- None expected; this is a small, mechanical fix once the exact `PATH` gap is confirmed.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`protocol/test/package.test.ts` now passes under both runtimes. Under `bun --bun`, the `node` it finds is Bun's own shim, so `tsc` runs on Bun, not on Node.

- **Cause.** Gap 5 and this todo's Goal blamed `tsc`'s own `#!/usr/bin/env node` shebang. That was wrong. `node_modules/.bin/tsc` is pnpm's `#!/bin/sh` wrapper, and its line 20, `exec node  "$basedir/../typescript/bin/tsc" "$@"`, looks `node` up on `PATH`. The test put `dirname(process.execPath)` on `PATH`, and under Bun that folder is `~/.bun/bin`, which holds `bun` and no `node`. (`bun -e 'console.log(process.execPath)'` printed `/Users/<user>/.bun/bin/bun` on the measuring machine; the exact path is install-specific.) The Goal stays as written; CI plan §3h gap 5 is corrected in place, and fact-check row X11-1 records the correction.
- **Fix.** A new `nodeDir()` keeps `dirname(process.execPath)` under Node. Under Bun (`process.versions.bun` set) it returns the first folder on the inherited `PATH` that holds an executable `node`, a regular file the user may run, and it throws "no executable node found on PATH" if none does. Under `bun --bun x vitest run` that folder is Bun's shim folder, a per-run `/private/tmp/bun-node-<hash>` whose `node` resolves to `~/.bun/bin/bun`, so `tsc` runs on Bun. That fits X6's method, which runs the installed code on Bun in Node's place, and the test checks only the imports `tsc` emits. Only that one folder joins the allowlist, so AGENTS.md's "Running third-party code" rule is unchanged and `process.env` never reaches `tsc`.
- **Allowlisted `PATH`.** Under `bun --bun x vitest run`, the first entry of the inherited `PATH` is the `bun-node-*` shim folder; the real Node comes later. The allowlisted `PATH` is that folder, `/usr/bin` and `/bin`.
- **Runs (2026-11-26, Bun 1.4.4).** Before the fix, `bun --bun x vitest run test/package.test.ts` gave 1 failed and 1 passed. After it, that test passes 2/2 under Node and 2/2 in two runs under Bun, and `pnpm --filter @buildanagent/protocol test` passes 57/57 in 8 files under Node. `tsc -p packages/protocol --noEmit`, `pnpm check:deps`, `check:duplicates`, `check:unused` and `check:ids` pass.
- **Docs.** CI plan §3h gap 5 gives the right cause and says how X11 fixed it, and the plan's links and table row now point to `done/`. Fact-check rows X11-1 to X11-7 are in `docs/plans/reviews/fact-check-ci.md`.
- **Checks.** `pnpm check`, `pnpm typecheck`, `pnpm check:links` and `pnpm fact-check-logs` pass locally. The root `pnpm test` stops at `verify/copilot-sdk` on macOS, which lacks `unshare`, so the acceptance and definition-of-done boxes that name it stay unticked and CI's `checks` job confirms it.

The code-review and writing-review boxes stay unticked until those reviews run on the pull request.
