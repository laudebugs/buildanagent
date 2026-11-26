# X11: Let `protocol`'s allowlisted-environment subprocess find `node` under Bun

| Field | Value |
| --- | --- |
| ID | `X11` |
| Status | `ready` |
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

- [ ] Read `protocol/test/package.test.ts`'s `execFileSync` call and its environment object.
- [ ] Reproduce the failure under Bun and confirm the allowlisted `PATH`'s exact contents at failure time.
- [ ] Fix the `PATH` construction so a working `node` is always reachable, under either runtime, within AGENTS.md's allowlist rule.
- [ ] Run the test under both `node --test`/`vitest run` and `bun --bun x vitest run` in `packages/protocol`.

## Acceptance criteria

- [ ] `protocol/test/package.test.ts` passes under both Node and Bun.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally under Node.
- [ ] The fix still spawns with an allowlisted environment, not `process.env`, per AGENTS.md.

## Tests

The existing `package.test.ts` is the evidence; no new tests, just a second run under Bun.

## Docs to update

- [CI plan §3h](../../plans/ci.md#3h-bun-runtime-compatibility-measured-x6-added-2026-11-26), gap 5.

## Risks and open questions

- None expected; this is a small, mechanical fix once the exact `PATH` gap is confirmed.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
