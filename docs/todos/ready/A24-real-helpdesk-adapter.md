# A24: Real helpdesk adapter and approval surface (AD14, owner supplies)

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A24` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 5](../../plans/build-agent.md#45-stage-5-builds-the-rollout-machinery-that-shadow-canary-and-release-will-need) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A22](A22-shadow-metrics.md), [N20](../ongoing/N20-credential-proxy.md) |
| Size | M |

## Goal

Implement the `Helpdesk` interface against the owner's helpdesk through the harness's credential proxy, and connect the approval surface that authenticates approvers, so shadow can start on real tickets.

## Context

- [AD14](../../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted): the boundary and what the owner supplies
- [AD3](../../plans/build-agent.md#ad3-a-role-based-quorum-per-tier-and-amount-band-bound-to-the-host-signed-pause-and-expiring-on-age-or-policy-change-accepted-with-sdk-d5-and-hd5): the approver directory
- [N20](../ongoing/N20-credential-proxy.md): the credential proxy
- [ADR 0031](../../decisions/0031-helpdesk-interface.md)

## Scope

**In scope**

- **The owner supplies:** which helpdesk; a sandbox account with test tickets; an API credential with the narrowest scopes for the reads and writes in §3.2; the approval surface and how it authenticates approvers; the approver roles
- `src/helpdesk/adapters/<name>.ts` calling `fetch` through a credential route, with no vendor SDK
- Contract tests that run the adapter against a recorded mock of the helpdesk API
- An opt-in live check against the sandbox account, outside `pnpm test`

**Out of scope** (and which todo covers it)

- Running shadow on production tickets (later phase)

## Tasks

- [ ] Map the helpdesk's fields onto `TriageFields` and record anything unmapped.
- [ ] Assert that no credential appears in any entry or span.

## Acceptance criteria

- [ ] The adapter passes the same contract suite as `fakeHelpdesk`
- [ ] No credential reaches the log or spans in the capstone run
- [ ] The opt-in live check runs against the sandbox account
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/helpdesk/adapter-contract.test.ts`, run for the fake and the adapter.

## Docs to update

The README's "Helpdesk" section; ADR 0031's status. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Blocked until the owner names the helpdesk and supplies access.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
