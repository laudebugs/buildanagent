# F7: Cloudflare connection and deploy adapter

| Field | Value |
| --- | --- |
| ID | `F7` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md), [F4](F4-hidden-grader-evals.md) |
| Size | M |

## Goal

Let a user connect their Cloudflare account and deploy a gated agent into it (PF6).

## Context

- [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md).
- [Cloudflare OAuth](https://developers.cloudflare.com/fundamentals/oauth/), [account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/) and [token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/).

## Scope

**In scope**

- OAuth connection, and the account-token path with a template URL
- A deploy adapter that verifies the gate report, then uploads the Worker and its Durable Object bindings
- Deploying the platform's own control plane

**Out of scope**

- BYOK setup (F9)

## Tasks

- [ ] Register the OAuth client and implement the flow.
- [ ] Write the least-permission token template, starting from `Workers Scripts Edit` and `AI Gateway Edit` and adding only what a recorded deploy proves it needs.
- [ ] Store connection credentials encrypted under the tenant key (F1).
- [ ] Verify the gate report before every deploy.

## Acceptance criteria

- [ ] A deploy without a passing report for its commit is refused.
- [ ] Recorded deploys succeed offline.

## Tests

Tests against recorded Cloudflare API exchanges.

## Docs to update

Connection steps in the platform docs.

## Risks and open questions

OAuth scopes for Workers deploys need confirming when the client is registered.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
