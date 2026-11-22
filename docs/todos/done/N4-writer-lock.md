# N4: Writer lock with a lease, and the crash test (HD2)

| Field | Value |
| --- | --- |
| ID | `N4` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N3](../done/N3-session-store.md) |
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
- `acquire(key)` takes the store's `SessionKey`, `{ userId, sessionId }`, so a lock can't reach another user's session (decided in N3). Name the lock file from both parts with `encodeName` in `packages/harness/src/session/store.ts`, as the JSONL store does
- Lease renewal, release, and stale detection (lapsed lease and dead pid on the same host)
- `buildanagent session unlock --force` as a library function the CLI calls later
- The crash test

**Out of scope** (and which todo covers it)

- CLI wiring (N30)

## Tasks

- [x] Create the lock with `open(path, "wx")`; write `{ pid, host, token, leaseUntil }`.
- [x] Check pid liveness with `process.kill(pid, 0)`.
- [x] In the crash test, spawn a child with `spawnEnv`-style minimal env that appends in a loop, `SIGKILL` it, and acquire from the parent.

## Acceptance criteria

- [x] A second `acquire` returns `"would_block"` within 50 ms
- [x] After `SIGKILL`, a new writer acquires within one lease (30 s, shortened in the test) and readers load every complete entry
- [x] A lock with a live pid is never reclaimed
- [x] A lock whose `host` differs is reclaimed only by the force path
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/lock.test.ts`, `lock-crash.test.ts`.

## Docs to update

`packages/harness/README.md`: the lock, and that network file systems are unsupported. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Pid reuse after a crash could keep a stale lock alive; the lease plus the token make that a delay, not a corruption.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The harness now has a file-backed writer lock in `packages/harness/src/session/file-lock.ts`, with the interface in `lock.ts`. The plan's §3.2 sketch holds with the differences below.

**Public API.**
- `@buildanagent/harness/session`: the `SessionLock` and `LockHandle` types.
- `@buildanagent/harness/session/jsonl`: `fileLock(options)`, `unlockSession(options, key)` and the types `FileLockOptions`, `LockRecord` and `RemovedLock`. The lock has the JSONL store's entry because both need Node's file system, so the portable entry stays free of them.

**Behavior.**
- `acquire(key)` takes the store's `SessionKey` and names the lock file `<dir>/<user>/<session>.lock` with `encodeName()`, so a lock can't reach another user's session.
- It creates the file with `open(path, "wx")`, writes `{ pid, host, token, leaseUntil }`, and returns `"would_block"` at once when the file exists and is not stale.
- A lock is stale when its lease has lapsed and its host is this host and its pid is gone (`process.kill(pid, 0)`; `EPERM` counts as alive). A lock from another host is never stale to `acquire()`.
- The holder renews on a timer that doesn't keep the process alive. The renewal writes a temp file and renames it over the lock.
- A takeover runs under a `<lock>.reclaim` guard created with the exclusive-create flag, which a process that died during a takeover leaves for at most ten seconds.
- `unlockSession()` removes a lock whatever its state and returns what it held.

**Decisions.**
- **`LockHandle` gains `held()`.** The plan's handle had only `token` and `release()`, but a writer that lost its lease needs a way to find out, and the renewal is where it learns.
- **A lock file with no readable record counts as stale after one lease.** A creator that died between creating the file and writing it leaves one, and a live creator is still writing a fresh one.
- **The clock, the process check, the host and the pid are options,** so the staleness cases run without waiting for a real lease. The crash test uses real time with a 1.5 second lease.
- **The renewal's token check and rename aren't one atomic step,** so a takeover in between can be overwritten once. The next renewal sees the token and gives up, and the stale writer's appends fail the store's compare-and-swap, so the log stays whole. A holder that lost its lease should use `expectedLastId` on every append.

**Left out.** CLI wiring (N30), and the off-host locks (N46a to N48a).

