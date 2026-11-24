# N45: One conformance suite over the eight portable seams

| Field | Value |
| --- | --- |
| ID | `N45` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N41](N41-scheduler-wake.md), [N42](../done/N42-read-only-key-store.md), [N43](N43-remote-sandbox-egress-policy.md), [N44](N44-web-stream-websocket-transport.md), [E7](../done/E7-safety-portability.md) |
| Size | M |

## Goal

Collect every portability case into one suite that any target's implementations must pass, so "compatible with Cloudflare, AWS and Vercel" is a test rather than a claim (ADR 0033).

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the targets and the seven seams; [ADR 0043](../../decisions/0043-standalone-safety-core.md) adds `EffectStore` as the eighth.
- [Storage-and-wake note](../../research/deployment/storage-and-wake.md#three-rules-come-with-the-seams): the three rules the suite asserts.

## Scope

**In scope**

- One exported suite in `@buildanagent/harness/testing` over `SessionStore`, `SessionLock`, `Scheduler`, `KeyStore`, `SandboxClient`, `EgressPolicy`, the transport and `EffectStore`
- Egress cases for every backend: a request to a host outside `EgressPolicy.allow`, to a loopback address, and to `169.254.169.254` or another cloud metadata address all fail closed. They need no browser (curl in the sandbox is enough), and N47b and N48b run them, as does N46b once N50 settles its design
- Local implementations passing it

**Out of scope**

- Cloud implementations (N46–N48)

## Tasks

- [x] Gather the cases from N3, N4, N15 and N41–N44 into one suite
- [x] Add HD2's settling test with a lease-only staleness rule for off-host locks
- [x] Add the at-least-once wake rule
- [x] Import E2's `EffectStore` conformance cases for the write rule instead of restating it here (see the revision below)
- [x] Add the egress cases: a non-allowlisted host, loopback, and metadata addresses such as `169.254.169.254`
- [x] Run it in `pnpm test` against the local implementations

## Acceptance criteria

- [x] The suite runs offline in `pnpm test`
- [x] Every local implementation passes
- [x] The egress cases deny all three kinds of address against the local HD15 proxy, and the suite exports them for N46b, N47b and N48b

## Tests

The suite itself; each target todo imports it.

## Docs to update

Harness plan §5.2 (conformance suites).

## Risks and open questions

Some cloud behaviour (alarm timing) cannot be emulated exactly; those cases run only in opt-in live mode.

## Revision (2026-11-18, SDK gaps)

Gap 6 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) puts the safety package's stores under the same rule as the harness seams. Add:

- [x] The suite imports the `EffectStore` conformance cases from [E2](../done/E2-effect-identity-crash-rule.md) and runs them against every target's effect store ([E7](../done/E7-safety-portability.md)).
- [x] Two concurrent `begin` calls for one key on any target leave exactly one winner.

This revision makes `EffectStore` an eighth seam beside ADR 0033's seven, which [ADR 0043](../../decisions/0043-standalone-safety-core.md) records; the owner accepted it on 2026-11-18, so E7 is in **Depends on**. It also covers this todo's former "persisted idempotency-key rule" task, so the suite uses E2's cases instead of new ones.

History: plan review 2 (2026-11-19) pointed the write rule at E2's cases, named eight seams and added the remote egress cases (browser-use report, plan-change item 3).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- Added three Node-free conformance suites in `packages/harness/src/testing/` so workerd can run them:
  - `lock-conformance.ts`: `SessionLock` exclusivity, concurrent single-winner acquire, idempotent release, and both local (`lease_and_dead_pid`) and off-host (`lease_only`) lease takeover.
  - `egress-conformance.ts`: `compileEgressPolicy()` validation and `EGRESS_DENIED_TARGETS` covering non-allowlisted hosts, loopback addresses, and cloud metadata endpoints.
  - `transport-conformance.ts`: `initialize`, `session/create`, `turn/start` to `turn/settled`, `session/list`, and unknown-method JSON-RPC error recovery.
- Combined all eight portable seams in `portability-conformance.ts` (`PORTABILITY_SEAMS`, `portabilityConformanceCases()`, `runPortabilityConformance()`), reusing `effectStoreConformance()` from `@buildanagent/agent-safety/testing` (including the single-winner concurrent `begin` case).
- Exported every new suite and type from `@buildanagent/harness/testing` (`packages/harness/src/testing/index.ts`).
- Added `packages/harness/test/portability-conformance.test.ts` running all eight seams against local implementations, plus allowlisted egress and off-host `lease_only` lock checks.
- Updated `docs/plans/build-harness.md` §5.2, `docs/plans/build-coding-agent.md` §5.1, and `packages/harness/README.md`; regenerated `packages/harness/llms.txt`; and added a minor changeset.
