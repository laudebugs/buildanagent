# F16: M8 end to end: describe, build, gate and deploy to Cloudflare and Vercel

| Field | Value |
| --- | --- |
| ID | `F16` |
| Status | `ready` |
| Plan | [Build agent platform §5.2](../../plans/build-agent-platform.md#52-stage-f-b-connects-the-engine-and-ships-m8) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F15](F15-security-review.md), [F7](F7-cloudflare-connection-and-deploy.md), [F8](F8-vercel-connection-and-deploy.md), [F2](F2-github-sign-in.md) |
| Size | M |

## Goal

Prove M8 end to end with two fake tenants: describe an agent, build it, gate it and deploy it to each target.

## Context

- [Build agent platform §6](../../plans/build-agent-platform.md#6-every-test-runs-offline-and-the-end-to-end-test-proves-no-tenant-credential-reaches-a-sandbox).

## Scope

**In scope**

- The four assertions of §6
- A recorded run for each target

**Out of scope**

- Live cloud runs (opt-in only)

## Tasks

- [ ] Write the two-tenant end-to-end test.
- [ ] Assert no tenant credential reaches a sandbox, no cross-tenant read, no deploy without a report, and no BYOK fallback.

## Acceptance criteria

- [ ] All four assertions pass for both targets.

## Tests

The end-to-end test in CI.

## Docs to update

The roadmap's M8 row.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
