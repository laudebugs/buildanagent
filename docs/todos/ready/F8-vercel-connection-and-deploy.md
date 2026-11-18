# F8: Vercel connection and deploy adapter

| Field | Value |
| --- | --- |
| ID | `F8` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md), [F4](F4-hidden-grader-evals.md) |
| Size | M |

## Goal

Let a user connect their Vercel account and deploy a gated agent into it (PF6).

## Context

- [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md).
- [Vercel integrations](https://vercel.com/docs/integrations/create-integration/submit-integration) and [access tokens](https://vercel.com/docs/accounts/access-tokens).

## Scope

**In scope**

- An integration with selected API scopes, and the project-scoped token path
- A deploy adapter that verifies the gate report

**Out of scope**

- BYOK (F9)

## Tasks

- [ ] Create the integration with only the scopes deploys need.
- [ ] Implement the project-scoped token path.
- [ ] Verify the gate report before every deploy.

## Acceptance criteria

- [ ] A deploy without a passing report is refused.
- [ ] Recorded deploys succeed offline.

## Tests

Tests against recorded Vercel API exchanges.

## Docs to update

Connection steps in the platform docs.

## Risks and open questions

Vercel AI Gateway's default BYOK fallback means tenant calls avoid it unless the fallback is off (ADR 0040).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
