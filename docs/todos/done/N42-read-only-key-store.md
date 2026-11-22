# N42: Optional `rotate()` and `prune()`, and a secret-backed `KeyStore`

| Field | Value |
| --- | --- |
| ID | `N42` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N13](../done/N13-signed-approvals.md) |
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

- [x] Make the two methods optional in harness §3.4 (they already were in `KeyStore`; §3.4 now records the rest)
- [x] Implement `secretKeyStore()`
- [x] Make the CLI's `keys rotate` and `keys prune` fail with a typed error naming the platform tool when unsupported (as library helpers, because the CLI package is still empty; see the outcome)
- [x] Add key-store cases to N45's collection

## Acceptance criteria

- [x] A pause signed under a key from `secretKeyStore()` resumes in a second process
- [x] `pnpm test` passes

## Tests

Resume test across two processes with a read-only store.

## Docs to update

Harness plan §3.4 (the optional methods).

## Risks and open questions

None open. The owner accepted ADR 0035 on 2026-11-18.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`secretKeyStore()`, `rotateKeys()`, `pruneKeys()` and `DEFAULT_PLATFORM_HINT` are in `packages/harness/src/session/secret-key-store.ts` and exported from `@buildanagent/harness/session`. The plan's §3.4 and its status line record them, and the plan tables link this todo.

- **The optional methods were already optional.** `KeyStore` in `@buildanagent/agent-safety` had `rotate?()` and `prune?()` before this todo, so no type changed.
- **`secretKeyStore({ read })` reads on every load.** `read()` returns the secret's text, and `load()` parses it with `parseKeyRing()` and checks it through `hmacSigner()`. It keeps no copy, so a ring the platform rotated takes effect at the next load. Any failure is a `HarnessError`, code `invalid_key_store`, whose message holds no secret text and whose cause names key ids only. The file imports no Node module, so N46a, N47a and N48a only supply `read`.
- **The CLI's messages are library helpers for now.** `packages/cli` is still an empty scaffold, so `rotateKeys(store)` and `pruneKeys(store, inUse)` carry the behaviour the CLI's `keys rotate` and `keys prune` will call. On a store without the method they throw the new code `key_store_read_only`, whose message names the platform's secret tooling: by default "such as wrangler secret put, aws secretsmanager put-secret-value or vercel env", or the caller's `platformHint`.
- **Conformance.** `keyStoreConformanceCases()` and `runKeyStoreConformance()` are in `@buildanagent/harness/testing`; N45 collects them. `fileKeyStore()` passes every case, and `secretKeyStore()` passes the three load cases and skips rotate and prune with a reason.
- **Two processes.** `test/permissions/secret-second-process.test.ts` pauses a refund under a ring read from a secret, then resolves it in a child process with a cleared environment that reads the same secret: the call runs once. A child that reads a different secret runs nothing, and the call asks again.
