# N16: `srt` OS backend

| Field | Value |
| --- | --- |
| ID | `N16` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](N15-sandbox-interface.md) |
| Size | M |

## Goal

Wrap Anthropic's `srt` sandbox runtime as the OS-tier backend, translate our policy into its settings, and fail closed when it cannot start.

## Context

- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): `srt` defaults, network via proxy sockets, private-range refusal
- [sandbox-runtime repository](https://github.com/anthropic-experimental/sandbox-runtime)
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

- [ ] Pick an `srt` release at least a week old, record its version and license in the README.
- [ ] Detect a missing binary or unsupported platform and throw `SandboxUnavailableError`.
- [ ] Spawn `srt` with `spawnEnv()` plus only the settings-file path, never `...process.env` (AGENTS.md, "Running third-party code").

## Acceptance criteria

- [ ] On a host with `srt`, `pnpm --filter @agent-speak/harness test:sandbox` passes the conformance suite
- [ ] A write outside `writeRoots` returns a `SandboxDenial`, not an exception
- [ ] Without `srt`, provisioning throws `SandboxUnavailableError` and nothing runs
- [ ] The spawned `srt` process's environment holds only `spawnEnv()` names (a test records the spawn options)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/srt.test.ts` (opt-in).

## Docs to update

`packages/harness/README.md`: the `srt` version tested and its limits (shared kernel, no TLS inspection). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If no `srt` release meets the age rule, or its license blocks use, leave the backend unregistered and record the blocker for the owner.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
