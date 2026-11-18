# N42: Optional `rotate()` and `prune()`, and a secret-backed `KeyStore`

| Field | Value |
| --- | --- |
| ID | `N42` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N13](N13-signed-approvals.md) |
| Size | S |

## Goal

Let a read-only secret back the approval key ring, as ADR 0035 decides, so pauses survive on serverless hosts where the harness can read but not write its key.

## Context

- [ADR 0035](../../decisions/0035-read-only-key-store.md): the decision.
- [Harness plan, HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5): the current key ring.

## Scope

**In scope**

- `rotate()` and `prune()` optional on `KeyStore`
- `secretKeyStore({ read })` taking a function that returns the serialised ring
- A `keys rotate` CLI message pointing at platform tooling when the store is read-only

**Out of scope**

- Per-cloud secret readers (N46a, N47a, N48a)

## Tasks

- [ ] Make the two methods optional in harness §3.4
- [ ] Implement `secretKeyStore()`
- [ ] Make the CLI's `keys rotate` and `keys prune` fail with a typed error naming the platform tool when unsupported
- [ ] Add key-store cases to N45's collection

## Acceptance criteria

- [ ] A pause signed under a key from `secretKeyStore()` resumes in a second process
- [ ] `pnpm test` passes

## Tests

Resume test across two processes with a read-only store.

## Docs to update

Harness plan §3.4 (the optional methods).

## Risks and open questions

None open. The owner accepted ADR 0035 on 2026-11-18.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
