# 0014. Guard each session with an exclusive lock file and a renewed lease, on local disk only

- **Status:** Proposed (provisional until todo N4)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD2](../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional)

## Context

Harness decision 2 asks for the lock primitive and the stale-lock rule. Codex returns `WouldBlock` to a second writer; OpenHands warns that `flock` is unreliable on NFS; Node 22's `node:fs` has no `flock` call.

## Decision

`acquire` creates `<session>.lock` with the exclusive-create flag and records pid, host, a token and a 30-second lease renewed every 10 seconds. A second writer gets `"would_block"` at once. A lock is stale only when its lease has lapsed and, on the same host, its pid is gone; a lock from another host needs `session unlock --force`. Readers never lock and skip a torn last line. Network file systems are unsupported.

## Consequences

- Todo N4's crash test kills a writer with `SIGKILL` mid-append and requires recovery within one lease.
- A server deployment may later replace the file lock with an actor per session behind the same `SessionLock` interface.
