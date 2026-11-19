# F2: GitHub sign-in and sessions

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F2` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md) |
| Size | S |

## Goal

Let users sign in with GitHub and create their tenant on first sign-in (PF12).

## Context

- [PF12](../../plans/build-agent-platform.md#pf12-sign-in-with-github-proposed): GitHub as the first sign-in method.
- [GitHub, authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps): the web flow.

## Scope

**In scope**

- The OAuth web flow, session cookies and sign-out
- Tenant creation on first sign-in

**Out of scope**

- Teams and roles (later record)

## Tasks

- [ ] Implement the OAuth web flow with `state` checking.
- [ ] Issue an HTTP-only, secure session cookie bound to the tenant.
- [ ] Create the tenant on first sign-in and record the event in the audit log interface (F14 implements it).

## Acceptance criteria

- [ ] A callback with a wrong `state` is refused.
- [ ] A second sign-in reuses the same tenant.

## Tests

Tests against a recorded GitHub OAuth exchange.

## Docs to update

The platform README.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
