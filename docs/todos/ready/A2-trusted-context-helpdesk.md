# A2: Trusted run context, intake, the `Helpdesk` interface and `fakeHelpdesk`

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A2` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 1](../../plans/build-agent.md#41-stage-1-builds-the-trusted-run-context-the-helpdesk-boundary-and-the-ten-tools) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A1](A1-triage-agent-scaffold.md) |
| Size | M |

## Goal

Build the two foundations every other todo depends on: the host-only `TrustedContext` that intake fills from an authenticated ticket, and the `Helpdesk` interface with an in-memory fake, so identity never comes from the model and no test touches a real system.

## Context

- [AD14](../../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-accepted): the helpdesk boundary
- [build-agent.md §3.2](../../plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts): `TrustedContext`, `intake()`, `Helpdesk`, `fakeHelpdesk()`
- [agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next): identity is the argument the model must never choose

## Scope

**In scope**

- `TrustedContext`, `RolloutStage`, `InboundTicket`, `IntakeResult` and `intake()`
- `Helpdesk` with every method in §3.2; `sendReply` takes no recipient
- `fakeHelpdesk(fixture)` with recorded writes, and a `HelpdeskFixture` format
- Intake handoffs for an unauthenticated ticket and an unknown requester

**Out of scope** (and which todo covers it)

- The kill-switch read at intake (A7)
- The shadow wrapper (A22)
- The real adapter (A24)

## Tasks

- [ ] Freeze `TrustedContext` objects so tools cannot mutate them.
- [ ] Load the requester's order ids at intake and nothing beyond the plan, status and open-ticket count.
- [ ] Write a fixture with two requesters whose orders overlap in id format, for the cross-customer tests.

## Acceptance criteria

- [ ] `intake()` returns `handoff` with `unauthenticated` when `authenticate` returns `null`
- [ ] A `TrustedContext` holds only the requester's own order ids
- [ ] `fakeHelpdesk` records every write with its arguments, and its reply record has no recipient field
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/trusted/intake.test.ts`, `test/helpdesk/fake.test.ts`.

## Docs to update

The package README's "Trusted run context" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

The real helpdesk may authenticate differently; A24 maps it onto `authenticate()`.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
