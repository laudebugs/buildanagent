# N17: Docker backend

| Field | Value |
| --- | --- |
| ID | `N17` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md) |
| Size | M |

## Goal

Run tools in a locked-down container as the container-tier backend for headless runs and eval trials, failing closed when Docker is unavailable.

## Context

- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): Docker with `--cap-drop ALL --read-only --network none`
- [HD4](../../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-accepted): the decision and its evidence
- [HD8](../../plans/build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended): resource guarantees

## Scope

**In scope**

- `dockerSandbox({ image, cpus, memoryMb })` in `./sandbox/docker`
- Flags `--cap-drop ALL --read-only --network none`, a writable workspace mount only for `writeRoots`, `--pids-limit`, `--cpus` and `--memory`
- A proxy socket mount when the policy allows any host (N20)
- The conformance suite under `test:sandbox`

**Out of scope** (and which todo covers it)

- Choosing the image for evals (N37)

## Tasks

- [ ] Spawn `docker` with `spawnEnv` plus `DOCKER_HOST` when set; never pass the parent environment.
- [ ] Pin the test image by digest.

## Acceptance criteria

- [ ] On a host with Docker, the conformance suite passes under `test:sandbox`
- [ ] `--network none` blocks a `curl` to an allowlisted name unless the proxy socket is mounted
- [ ] Without Docker, provisioning throws `SandboxUnavailableError`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/docker.test.ts` (opt-in).

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Rootless and rootful Docker differ in mounts; test both if available and record which passed.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
