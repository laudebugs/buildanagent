# N45: One conformance suite over the eight portable seams

| Field | Value |
| --- | --- |
| ID | `N45` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N41](N41-scheduler-wake.md), [N42](N42-read-only-key-store.md), [N43](N43-remote-sandbox-egress-policy.md), [N44](N44-web-stream-websocket-transport.md), [E7](E7-safety-portability.md) |
| Size | M |

## Goal

Collect every portability case into one suite that any target's implementations must pass, so "compatible with Cloudflare, AWS and Vercel" is a test rather than a claim (ADR 0033).

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the targets and the seven seams; [ADR 0043](../../decisions/0043-standalone-safety-core.md) adds `EffectStore` as the eighth.
- [Storage-and-wake note](../../research/deployment/storage-and-wake.md#three-rules-come-with-the-seams): the three rules the suite asserts.

## Scope

**In scope**

- One exported suite in `@buildanagent/harness/testing` over `SessionStore`, `SessionLock`, `Scheduler`, `KeyStore`, `SandboxClient`, `EgressPolicy`, the transport and `EffectStore`
- Egress cases for every backend: a request to a host outside `EgressPolicy.allow`, to a loopback address, and to `169.254.169.254` or another cloud metadata address all fail closed. They need no browser (curl in the sandbox is enough), and N47b and N48b run them, as does N46b once S10 settles its design
- Local implementations passing it

**Out of scope**

- Cloud implementations (N46–N48)

## Tasks

- [ ] Gather the cases from N3, N4, N15 and N41–N44 into one suite
- [ ] Add HD2's settling test with a lease-only staleness rule for off-host locks
- [ ] Add the at-least-once wake rule
- [ ] Import E2's `EffectStore` conformance cases for the write rule instead of restating it here (see the revision below)
- [ ] Add the egress cases: non-allowlisted host, loopback, and `169.254.169.254` and other metadata addresses
- [ ] Run it in `pnpm test` against the local implementations

## Acceptance criteria

- [ ] The suite runs offline in `pnpm test`
- [ ] Every local implementation passes
- [ ] The egress cases deny all three kinds of address against the local HD15 proxy, and the suite exports them for N46b, N47b and N48b

## Tests

The suite itself; each target todo imports it.

## Docs to update

Harness plan §5.2 (conformance suites).

## Risks and open questions

Some cloud behaviour (alarm timing) cannot be emulated exactly; those cases run only in opt-in live mode.

## Revision (2026-11-18, SDK gaps)

Gap 6 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) puts the safety package's stores under the same rule as the harness seams. Add:

- [ ] The suite imports the `EffectStore` conformance cases from [E2](E2-effect-identity-crash-rule.md) and runs them against every target's effect store ([E7](E7-safety-portability.md)).
- [ ] Two concurrent `begin` calls for one key on any target leave exactly one winner.

This revision makes `EffectStore` an eighth seam beside ADR 0033's seven, which [ADR 0043](../../decisions/0043-standalone-safety-core.md) records; the owner accepted it on 2026-11-18, so E7 is in **Depends on**. It also covers this todo's former "persisted idempotency-key rule" task, so the suite uses E2's cases instead of new ones.

History: plan review 2 (2026-11-19) pointed the write rule at E2's cases, named eight seams and added the remote egress cases (browser-use report, plan-change item 3).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
