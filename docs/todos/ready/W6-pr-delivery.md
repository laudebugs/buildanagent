# W6: Draft pull request delivery and review follow-ups

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W6` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W3](W3-github-app-identity.md), [W5](W5-control-plane-ingress.md), [E2](../done/E2-effect-identity-crash-rule.md) |
| Size | M |

## Goal

Deliver every task as a draft pull request from `agent/<task-id>`, and follow up on review comments, so the owner's merge is the commit point (ADR 0036).

## Context

- [Copilot diff review report](../../research/agent-ui/copilot-diff-review.md): the draft pull request as the approval point.
- [E2](../done/E2-effect-identity-crash-rule.md): `guardedWrite()` and `effectKey()`, which own write identity and the crash rule; this todo uses them and builds no key scheme of its own (owner, 2026-11-19: "E2 owns it; W6 uses it").
- [Server rollback report](../../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped): idempotency keys for the push and the API call.

## Scope

**In scope**

- Branch, commit and draft pull request with a summary and a session link
- Review-comment follow-ups through the webhook
- A base-branch conflict check before each follow-up
- Every push and GitHub API write through E2's `guardedWrite()`, keyed by `effectKey()`; "open pull request" declares the business key repository + branch, so a regenerated turn maps to the same pull request

**Out of scope**

- Auto-merge (never)

## Tasks

- [ ] Run each push and API write through `guardedWrite()`, with a `reconcile` hook that looks up the branch head or the open pull request by repository and branch
- [ ] Open the draft pull request
- [ ] Handle review comments as new turns

## Acceptance criteria

- [ ] A replayed wake opens one pull request
- [ ] Two tool calls with different call ids that both open a pull request for the same repository and branch produce one pull request (E2's business-key test, against the fake GitHub)
- [ ] A follow-up comment produces a new commit on the same branch

## Tests

Offline tests against a fake GitHub API.

## Docs to update

Plan §3.

## Risks and open questions

Base-branch conflicts emit no webhook, so the check must poll before each follow-up.

History: plan review 2 (2026-11-19) replaced this todo's own idempotency-key scheme with E2's `guardedWrite()` and added E2 to **Depends on**.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
