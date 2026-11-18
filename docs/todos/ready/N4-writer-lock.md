# N4: Writer lock with a lease, and the crash test (HD2)

| Field | Value |
| --- | --- |
| ID | `N4` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N3](N3-session-store.md) |
| Size | M |

## Goal

Enforce one writer per session with a lock file that fails fast, survives a crash through its lease, and is proven by a test that kills a writer mid-append.

## Context

- [HD2](../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional): the decision and its evidence
- [ADR 0014](../../decisions/0014-session-writer-lock.md): the decision records
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): one writer, fail fast; `flock` unsafe on NFS

## Scope

**In scope**

- `fileLock({ dir, leaseMs, renewMs })` implementing `SessionLock`
- Lease renewal, release, and stale detection (lapsed lease and dead pid on the same host)
- `agent-speak session unlock --force` as a library function the CLI calls later
- The crash test

**Out of scope** (and which todo covers it)

- CLI wiring (N30)

## Tasks

- [ ] Create the lock with `open(path, "wx")`; write `{ pid, host, token, leaseUntil }`.
- [ ] Check pid liveness with `process.kill(pid, 0)`.
- [ ] In the crash test, spawn a child with `spawnEnv`-style minimal env that appends in a loop, `SIGKILL` it, and acquire from the parent.

## Acceptance criteria

- [ ] A second `acquire` returns `"would_block"` within 50 ms
- [ ] After `SIGKILL`, a new writer acquires within one lease (30 s, shortened in the test) and readers load every complete entry
- [ ] A lock with a live pid is never reclaimed
- [ ] A lock whose `host` differs is reclaimed only by the force path
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/lock.test.ts`, `lock-crash.test.ts`.

## Docs to update

`packages/harness/README.md`: the lock, and that network file systems are unsupported. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Pid reuse after a crash could keep a stale lock alive; the lease plus the token make that a delay, not a corruption.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
