# N17: Docker backend

| Field | Value |
| --- | --- |
| ID | `N17` |
| Status | `done` |
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

- [x] Spawn `docker` with `spawnEnv` plus `DOCKER_HOST` when set; never pass the parent environment.
- [x] Pin the test image by digest.

## Acceptance criteria

- [x] On a host with Docker, the conformance suite passes under `test:sandbox`
- [x] `--network none` blocks a `curl` to an allowlisted name unless the proxy socket is mounted
- [x] Without Docker, provisioning throws `SandboxUnavailableError`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/docker.test.ts` (opt-in).

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Rootless and rootful Docker differ in mounts; test both if available and record which passed.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`dockerSandbox()` in `packages/harness/src/sandbox/docker/` is the container-tier backend: it claims `mistakes` and `exfiltration`, runs on Linux only, and passes the N15 conformance suite and its own lock-down cases against a real daemon, with no case skipped.

- **Each command gets its own locked-down container.** The flags are `--cap-drop ALL`, `--read-only`, `--network none`, `--security-opt no-new-privileges`, `--ipc none`, `--pids-limit`, `--cpus` and `--memory` with no swap, and a 64 MiB `/tmp`. A test reads the settings back from the daemon's `inspect` of a running container, so it checks what the daemon applied and not what we sent. Rows N17-1 to N17-3 in `docs/plans/reviews/fact-check-docker-backend.md` check the flags.
- **Only the policy's roots are mounted.** Write roots are writable and the rest are read-only, so a path outside the roots does not exist in the container. A `denyWrite` folder inside a write root is made if missing and mounted read-only, and the protected files `srt` guards are mounted read-only when they exist. A root that resolves to `/` or holds the Docker socket is refused.
- **The network is closed unless a proxy socket is mounted.** A test stands in for N20's proxy with a Unix socket: the allowed host answers through it, the blocked one is refused, and with no socket even the allowed host is out of reach. One limit: the test host has no bridge network, so a network that is not `none` can't be told apart by a connection. The `inspect` test closes that gap, and it fails when `--network none` is changed to `bridge`.
- **It fails closed.** A missing `docker`, a daemon that doesn't answer or an image that isn't on the host throws `SandboxUnavailableError`. Provisioning never pulls.
- **The docker client's environment is clean.** A fake client records it: a `PATH`, a private empty `HOME` and `DOCKER_HOST`, and no host variable. The todo named `spawnEnv()` plus `DOCKER_HOST`; the client needs no `LANG` or credential, so it gets less.
- **A stopped command leaves no container.** `docker run` killed half way through creating a container left one behind in the `Created` state. A container is therefore created first and started after, `docker kill` ends it by name, and `dispose()` waits for any creation in flight and sweeps by label. After the change, three runs left none.
- **The suite runs for real.** `pnpm --filter @buildanagent/harness test:sandbox` passed 29 of 29 for the Docker file after the review fixes (27 of 27 three times before them) on this host: Docker 29.10.0, a rootful daemon started in the session with the `vfs` storage driver and cgroup v1. Rootless Docker was not available, so it is untested and the README says so. The test image is `mirror.gcr.io/library/node` pinned by digest, because Docker Hub refused unauthenticated pulls from this host.
- **The file calls are shared with `srt`.** `src/sandbox/host-files.ts` holds the real-path and `/proc` checks, and the `srt` backend now uses it too.
