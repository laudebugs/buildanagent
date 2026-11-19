# F1: `@buildanagent/platform` package, the tenant model and per-tenant key encryption

| Field | Value |
| --- | --- |
| ID | `F1` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [B1](../done/B1-sdk-workspace-scaffold.md) |
| Size | M |

## Goal

Create the platform package and its tenant model: tenants, users, per-tenant data keys, and encryption for every stored credential. Every later Round F todo stores data under a tenant, so this comes first.

## Context

- [PF1](../../plans/build-agent-platform.md#pf1-other-users-from-the-start-one-tenant-per-user-accepted) and [ADR 0037](../../decisions/0037-multi-user-agent-platform.md): one tenant per user, the unit of isolation.
- [PF6](../../plans/build-agent-platform.md#pf6-users-connect-their-own-clouds-with-scoped-expiring-credentials-accepted-adr-0040): which credentials the tenant key protects.

## Scope

**In scope**

- `packages/platform` with tenant and user records
- A per-tenant data key, wrapped by a platform key held in the control plane's secret store
- Encrypt and decrypt helpers that refuse a mismatched tenant

**Out of scope**

- Sign-in (F2)
- Cloud connections (F7, F8, F17)

## Tasks

- [ ] Scaffold `packages/platform` in the workspace from B1, with exact pins.
- [ ] Define `Tenant`, `User` and `TenantKey` types and a storage interface with a memory implementation.
- [ ] Implement envelope encryption with Web Crypto: a random AES-GCM data key per tenant, wrapped by the platform key.
- [ ] Make every decrypt take the caller's tenant id and fail when it differs from the record's.

## Acceptance criteria

- [ ] Decrypting tenant A's record with tenant B's context fails with a typed error.
- [ ] No plaintext credential is written to storage in any test.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

Unit tests in `packages/platform` for key wrapping, tenant mismatch and storage round trips.

## Docs to update

The package README; the plan's §5.1 table.

## Risks and open questions

Where the platform key lives on Cloudflare (Worker secret or Secrets Store) is settled in F7, which deploys the control plane.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
