# N16: `srt` OS backend

| Field | Value |
| --- | --- |
| ID | `N16` |
| Status | `done` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md) |
| Size | M |

## Goal

Wrap Anthropic's `srt` sandbox runtime as the OS-tier backend, translate our policy into its settings, and fail closed when it cannot start.

## Context

- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): `srt` defaults, network via proxy sockets, private-range refusal
- [sandbox-runtime repository](https://github.com/anthropics/sandbox-runtime): the npm package `@anthropic-ai/sandbox-runtime`, whose bin is `srt`. Its README calls it a "Beta Research Preview" whose APIs and configuration formats may change (as of November 2026)
- [HD4](../../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-accepted): the decision and its evidence

## Scope

**In scope**

- `srtSandbox({ binary })` in `./sandbox/srt`, spawning the `srt` binary with a generated settings file
- `readRoots`, `writeRoots` and the network allowlist mapped to `srt`'s settings, with `denyWrite` for the session's own log directory
- `stops: ["mistakes", "exfiltration"]`
- The conformance suite under `test:sandbox`

**Out of scope** (and which todo covers it)

- Credential injection (N20 supplies the proxy URL)

## Tasks

- [x] Pin `@anthropic-ai/sandbox-runtime` 0.0.82, the newest release at least a week old on 2026-11-18 (0.0.83 qualifies from 2026-11-20), and record its version, its Apache-2.0 license and its Beta Research Preview status in the README, with a note that the settings format is pre-1.0. *(Revised in plan review 2, 2026-11-19: the repository moved from `anthropic-experimental` to `anthropics`.)*
- [x] Detect a missing binary or unsupported platform and throw `SandboxUnavailableError`.
- [x] Spawn `srt` with `spawnEnv()` plus only the settings-file path, never `...process.env` (AGENTS.md, "Running third-party code").

## Acceptance criteria

- [x] On a host with `srt`, `pnpm --filter @buildanagent/harness test:sandbox` passes the conformance suite
- [x] A write outside `writeRoots` returns a `SandboxDenial`, not an exception
- [x] Without `srt`, provisioning throws `SandboxUnavailableError` and nothing runs
- [x] The spawned `srt` process's environment holds only `spawnEnv()` names (a test records the spawn options)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/srt.test.ts` (opt-in).

## Docs to update

`packages/harness/README.md`: the `srt` version tested and its limits (shared kernel, no TLS inspection). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If no `srt` release meets the age rule, or its license blocks use, leave the backend unregistered and record the blocker for the owner.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`srtSandbox()` in `packages/harness/src/sandbox/srt/` is the OS-tier backend: it claims `mistakes` and `exfiltration`, runs on Linux only, and passes the N15 conformance suite and its own escape cases against the real `srt`, with no case skipped.

- **The pin is 0.0.83.** The todo named 0.0.82 and allowed 0.0.83 from 2026-11-20; 0.0.83 was published on 2026-11-13, so it is the newest release that meets the age rule. The README records the version, the Apache-2.0 license and the Beta Research Preview status. Rows N16-1 to N16-3 in `docs/plans/reviews/fact-check-srt-backend.md` check them.
- **The policy becomes a deny-all read list.** `srt` denies every read and then allows the roots, the system folders and its own helper folders back, with every path literal. Two things only a real run showed: `srt` reads its seccomp helper from inside the sandbox, and it creates its proxy sockets in `TMPDIR`. The backend gives `srt` a private `TMPDIR` that the settings allow reading and `dispose()` removes.
- **It fails closed.** A missing `bwrap` or `socat`, a binary that isn't executable, another platform or a host where `srt` can't start a command throws `SandboxUnavailableError`, because `provision()` starts `srt` once with a command that does nothing. The tests also check that no private folder is left behind.
- **The environment is the caller's.** A test records the spawn: `srt` gets only a `PATH` and its own `TMPDIR`, and `env` inside sets the command's whole environment, so a loader variable never reaches `srt`'s own Node. `srt` adds proxy variables of its own, which `SRT_ADDED_ENVIRONMENT` lists and the conformance suite's new `addedEnvironment` option accepts.
- **File calls run in the host.** Two `srt` processes in one workspace disturbed each other when a file call and a command overlapped, because each makes and removes empty protected files there. The file calls check the real path, and check the opened file again through `/proc`. The README names that race.
- **A stopped command cleans up.** The shared process runner now sends a `SIGTERM`, waits up to two seconds, then kills the group, so `srt` removes its protected files. A `SIGKILL` alone left `.bashrc` and `.claude` in the workspace. `none` still kills at once, and it now uses the same runner.
- **The suite runs for real.** `pnpm --filter @buildanagent/harness test:sandbox` passed 25 of 25 three times on this host, with bubblewrap and socat installed. Weakening the settings made three tests fail each time, so the escape cases can fail.
