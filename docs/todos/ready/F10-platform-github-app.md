# F10: The public GitHub App and per-tenant installations

| Field | Value |
| --- | --- |
| ID | `F10` |
| Status | `ready` |
| Plan | [Build agent platform §5.2](../../plans/build-agent-platform.md#52-stage-f-b-connects-the-engine-and-ships-m8) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [W3](W3-github-app-identity.md), [F1](F1-platform-tenancy.md) |
| Size | M |

## Goal

Register the platform's public GitHub App and bind each installation to one tenant (PF8).

## Context

- [ADR 0041](../../decisions/0041-platform-github-app.md) and [ADR 0034](../../decisions/0034-github-app-identity.md).
- [GitHub, App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private).

## Scope

**In scope**

- App registration as public
- Installation records per tenant
- The tenant check before minting a token

**Out of scope**

- Token minting and the git route, reused from W3

## Tasks

- [ ] Register the App and its webhook.
- [ ] Record each installation against the installing user's tenant.
- [ ] Refuse to mint a token for an installation outside the task's tenant.

## Acceptance criteria

- [ ] A task cannot mint a token for another tenant's installation.

## Tests

Tests against recorded installation webhooks.

## Docs to update

Platform docs for installing the App.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
