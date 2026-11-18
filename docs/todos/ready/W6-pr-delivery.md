# W6: Draft pull request delivery and review follow-ups

| Field | Value |
| --- | --- |
| ID | `W6` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W3](W3-github-app-identity.md), [W5](W5-control-plane-ingress.md) |
| Size | M |

## Goal

Deliver every task as a draft pull request from `agent/<task-id>`, and follow up on review comments, so the owner's merge is the commit point (ADR 0036).

## Context

- [Copilot diff review report](../../research/agent-ui/copilot-diff-review.md): the draft pull request as the approval point.
- [Server rollback report](../../research/reversible-actions/server-rollback.md#tool-call-ids-make-good-idempotency-keys-only-after-they-are-persisted-and-scoped): idempotency keys for the push and the API call.

## Scope

**In scope**

- Branch, commit and draft pull request with a summary and a session link
- Review-comment follow-ups through the webhook
- A base-branch conflict check before each follow-up

**Out of scope**

- Auto-merge (never)

## Tasks

- [ ] Persist an idempotency key before each push and API call
- [ ] Open the draft pull request
- [ ] Handle review comments as new turns

## Acceptance criteria

- [ ] A replayed wake opens one pull request
- [ ] A follow-up comment produces a new commit on the same branch

## Tests

Offline tests against a fake GitHub API.

## Docs to update

Plan §3.

## Risks and open questions

Base-branch conflicts emit no webhook, so the check must poll before each follow-up.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
